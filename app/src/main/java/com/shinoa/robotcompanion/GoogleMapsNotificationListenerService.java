package com.shinoa.robotcompanion;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Service resmi Android untuk menyadap dan membaca notifikasi navigasi Turn-by-Turn
 * dari Google Maps (com.google.android.apps.maps) secara realtime di latar belakang.
 */
public class GoogleMapsNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "GoogleMapsNavListener";
    private static final String MAPS_PACKAGE = "com.google.android.apps.maps";

    private static GoogleMapsNotificationListenerService instance = null;
    private static NavUpdateListener navUpdateListener = null;

    private static boolean isNavigating = false;
    private static String lastSentDist = "";
    private static String lastSentInst = "";
    private static String lastSentStreet = "";
    private static String lastSentAction = "";
    private static String lastSentRem = "";
    private static String lastSentTime = "";

    public interface NavUpdateListener {
        void onNavUpdate(String act, String dist, String inst, String street, String rem, String timeStr);
        void onNavStopped();
    }

    public static void setNavUpdateListener(NavUpdateListener listener) {
        navUpdateListener = listener;
    }

    public static boolean isNotificationAccessGranted(Context context) {
        if (context == null) return false;
        Set<String> packageNames = NotificationManagerCompat.getEnabledListenerPackages(context);
        return packageNames.contains(context.getPackageName());
    }

    public static boolean isNavigating() {
        return isNavigating;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.i(TAG, "GoogleMapsNotificationListenerService aktif");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        if (isNavigating) {
            handleNavigationStopped();
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !MAPS_PACKAGE.equals(sbn.getPackageName())) return;

        Notification notification = sbn.getNotification();
        if (notification == null || notification.extras == null) return;

        Bundle extras = notification.extras;
        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence subTextCs = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

        String title = titleCs != null ? titleCs.toString().trim() : "";
        String text = textCs != null ? textCs.toString().trim() : "";
        String subText = subTextCs != null ? subTextCs.toString().trim() : "";

        // Verifikasi bahwa notifikasi ini memang notifikasi navigasi aktif Google Maps
        // (Bukan notifikasi ulasan tempat, riwayat, atau promo)
        if (TextUtils.isEmpty(title) && TextUtils.isEmpty(text)) return;

        // Abaikan notifikasi promosi / riwayat Maps
        String combined = (title + " " + text + " " + subText).toLowerCase();
        if (combined.contains("ulasan") || combined.contains("review") || combined.contains("linimasa") || combined.contains("timeline")) {
            return;
        }

        parseAndDispatchMapsNotification(title, text, subText);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn == null || !MAPS_PACKAGE.equals(sbn.getPackageName())) return;

        if (isNavigating) {
            Log.i(TAG, "Notifikasi Google Maps dihentikan / selesai");
            handleNavigationStopped();
        }
    }

    /**
     * Mem-parsing teks notifikasi Google Maps untuk mengekstrak belokan, meteran, nama jalan, dan sisa jarak
     */
    private void parseAndDispatchMapsNotification(String title, String text, String subText) {
        String distStr = "180 m";
        String instStr = "Lurus Terus";
        String streetStr = "Jalan Utama";
        String remStr = "3.4 km";
        String timeStr = "15m";
        String actStr = "straight";

        // 1. Ekstrak Jarak Belokan dari Title atau Text (Contoh: "180 m", "1,2 km", "500 m")
        Pattern distPattern = Pattern.compile("(\\d+(?:[.,]\\d+)?\\s*(?:m|km|meter|kilometer))", Pattern.CASE_INSENSITIVE);
        Matcher distMatcher = distPattern.matcher(title);
        if (distMatcher.find()) {
            distStr = distMatcher.group(1).trim();
        } else {
            distMatcher = distPattern.matcher(text);
            if (distMatcher.find()) {
                distStr = distMatcher.group(1).trim();
            }
        }

        // Standarisasi satuan meter / km
        distStr = distStr.replace("kilometer", "km").replace("meter", "m");

        // 2. Ekstrak Instruksi Belokan & Tentukan Aksi Panah OLED
        String lowerTitle = title.toLowerCase();
        String lowerText = text.toLowerCase();
        String fullInfo = lowerTitle + " " + lowerText;

        if (fullInfo.contains("putar balik") || fullInfo.contains("u-turn") || fullInfo.contains("balik arah")) {
            actStr = "uturn";
            instStr = "Putar Balik";
        } else if (fullInfo.contains("bundaran") || fullInfo.contains("roundabout")) {
            actStr = "roundabout";
            instStr = "Bundaran";
        } else if (fullInfo.contains("tiba") || fullInfo.contains("tujuan") || fullInfo.contains("sampai") || fullInfo.contains("arrive")) {
            actStr = "arrive";
            instStr = "Tiba di Tujuan";
        } else if (fullInfo.contains("sedikit ke kanan") || fullInfo.contains("slight right") || fullInfo.contains("serong kanan")) {
            actStr = "slight_right";
            instStr = "Serong Kanan";
        } else if (fullInfo.contains("sedikit ke kiri") || fullInfo.contains("slight left") || fullInfo.contains("serong kiri")) {
            actStr = "slight_left";
            instStr = "Serong Kiri";
        } else if (fullInfo.contains("kanan") || fullInfo.contains("right")) {
            actStr = "right";
            instStr = "Belok Kanan";
        } else if (fullInfo.contains("kiri") || fullInfo.contains("left")) {
            actStr = "left";
            instStr = "Belok Kiri";
        } else {
            actStr = "straight";
            instStr = "Lurus Terus";
        }

        // 3. Ekstrak Nama Jalan
        if (!TextUtils.isEmpty(text) && !text.equals(distStr)) {
            // Bersihkan teks seperti "ke Jl. Sudirman" -> "Jl. Sudirman"
            String cleanedStreet = text;
            if (cleanedStreet.toLowerCase().startsWith("ke ")) {
                cleanedStreet = cleanedStreet.substring(3).trim();
            } else if (cleanedStreet.toLowerCase().startsWith("menuju ")) {
                cleanedStreet = cleanedStreet.substring(7).trim();
            } else if (cleanedStreet.toLowerCase().startsWith("onto ")) {
                cleanedStreet = cleanedStreet.substring(5).trim();
            }
            if (cleanedStreet.length() > 0) {
                streetStr = cleanedStreet;
            }
        } else if (!TextUtils.isEmpty(title) && !title.equals(distStr)) {
            streetStr = title;
        }

        // 4. Ekstrak Sisa Jarak & Estimasi Waktu (ETA) dari SubText (Contoh: "3,4 km • 15 mnt" atau "18:45 • 3.4 km")
        if (!TextUtils.isEmpty(subText)) {
            String[] parts = subText.split("•|\\-|\\|");
            for (String part : parts) {
                String p = part.trim();
                if (p.toLowerCase().contains("km") || p.toLowerCase().contains(" m")) {
                    remStr = p;
                } else if (p.toLowerCase().contains("mnt") || p.toLowerCase().contains("min") || p.toLowerCase().contains("jam") || p.toLowerCase().contains("j")) {
                    timeStr = p.replace("mnt", "m").replace("menit", "m").replace(" ", "");
                }
            }
        }

        isNavigating = true;

        // Cek apakah data berubah sebelum transmisi BLE agar hemat transmisi
        boolean changed = !actStr.equals(lastSentAction) ||
                          !distStr.equals(lastSentDist) ||
                          !instStr.equals(lastSentInst) ||
                          !streetStr.equals(lastSentStreet) ||
                          !remStr.equals(lastSentRem);

        if (changed) {
            lastSentAction = actStr;
            lastSentDist = distStr;
            lastSentInst = instStr;
            lastSentStreet = streetStr;
            lastSentRem = remStr;
            lastSentTime = timeStr;

            sendNavigationBleCommand(actStr, distStr, instStr, streetStr, remStr, timeStr);

            if (navUpdateListener != null) {
                navUpdateListener.onNavUpdate(actStr, distStr, instStr, streetStr, remStr, timeStr);
            }
        }
    }

    private void handleNavigationStopped() {
        isNavigating = false;
        lastSentAction = "";
        lastSentDist = "";
        lastSentInst = "";
        lastSentStreet = "";
        lastSentRem = "";
        lastSentTime = "";

        // Kirim status standby / stop ke robot
        try {
            JSONObject json = new JSONObject();
            json.put("c", "nav");
            json.put("act", "standby");
            BleManager ble = BleManager.getInstance(this);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal mengirim status stop nav ke BLE: " + e.getMessage());
        }

        if (navUpdateListener != null) {
            navUpdateListener.onNavStopped();
        }
    }

    private void sendNavigationBleCommand(String act, String dist, String inst, String street, String rem, String timeStr) {
        try {
            JSONObject json = new JSONObject();
            json.put("c", "nav");
            json.put("act", act);
            json.put("dist", dist);
            json.put("inst", inst);
            json.put("street", street);
            json.put("rem", rem);
            json.put("time", timeStr);
            json.put("spd", MainActivity.getCurrentGpsSpeed());

            BleManager ble = BleManager.getInstance(this);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal mengirim data navigasi ke BLE: " + e.getMessage());
        }
    }
}
