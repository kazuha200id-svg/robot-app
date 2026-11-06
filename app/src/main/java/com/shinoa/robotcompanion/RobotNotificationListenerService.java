package com.shinoa.robotcompanion;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.telecom.TelecomManager;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Layanan resmi Android NotificationListenerService untuk menangkap panggilan telepon
 * dan pesan chat (WhatsApp, SMS, dll) secara instan (realtime) dan meneruskannya ke Robot Desk via BLE.
 */
public class RobotNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "RobotNotifListener";
    private static RobotNotificationListenerService instance;

    public static final String PREF_NOTIF = "robot_desk_notif_prefs";
    public static final String KEY_MASTER_ENABLED = "notif_master_enabled";
    public static final String KEY_FILTER_CALLS = "notif_filter_calls";
    public static final String KEY_FILTER_WA_PERSONAL = "notif_filter_wa_personal";
    public static final String KEY_FILTER_WA_GROUPS = "notif_filter_wa_groups";
    public static final String KEY_FILTER_SMS = "notif_filter_sms";
    public static final String KEY_FILTER_OTHERS = "notif_filter_others";

    // Cache panggilan aktif saat ini untuk dieksekusi gestur Tap (Jawab) atau Tahan (Tolak)
    private static PendingIntent currentCallAnswerIntent = null;
    private static PendingIntent currentCallRejectIntent = null;
    private static String activeCallKey = null;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.d(TAG, "RobotNotificationListenerService aktif.");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        Log.d(TAG, "RobotNotificationListenerService dihentikan.");
    }

    public static RobotNotificationListenerService getInstance() {
        return instance;
    }

    public static boolean isNotificationAccessGranted(Context context) {
        if (context == null) return false;
        String pkgName = context.getPackageName();
        String flat = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            String[] names = flat.split(":");
            for (String name : names) {
                ComponentName cn = ComponentName.unflattenFromString(name);
                if (cn != null && TextUtils.equals(pkgName, cn.getPackageName())) {
                    return true;
                }
            }
        }
        return false;
    }

    public static void openNotificationAccessSettings(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuka settings notification listener", e);
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;

        SharedPreferences prefs = getSharedPreferences(PREF_NOTIF, Context.MODE_PRIVATE);
        boolean masterEnabled = prefs.getBoolean(KEY_MASTER_ENABLED, true);
        if (!masterEnabled) return;

        String pkg = sbn.getPackageName();
        Notification n = sbn.getNotification();
        Bundle extras = n.extras;
        if (extras == null) return;

        // Abaikan notifikasi sistem robot sendiri dan media playback
        if (getPackageName().equals(pkg)) return;
        if ("com.spotify.music".equals(pkg)) return; // Spotify dikelola oleh lyric sync engine
        if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0 && Notification.CATEGORY_PROGRESS.equals(n.category)) return;

        String category = n.category;
        boolean isCall = Notification.CATEGORY_CALL.equals(category)
                || extras.containsKey("android.callType")
                || (n.actions != null && hasCallActions(n.actions));

        // Format waktu jam (misal "14:25")
        String timeStr = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());

        // 1. EVALUASI PANGGILAN MASUK (TELEPON WA / SELULER)
        if (isCall) {
            boolean allowCalls = prefs.getBoolean(KEY_FILTER_CALLS, true);
            if (!allowCalls) return;

            String caller = extras.getString(Notification.EXTRA_TITLE);
            if (TextUtils.isEmpty(caller)) {
                CharSequence cs = extras.getCharSequence(Notification.EXTRA_TITLE);
                caller = cs != null ? cs.toString() : "Panggilan Masuk";
            }

            CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
            String text = textCs != null ? textCs.toString() : "Panggilan suara masuk...";

            // Simpan aksi jawab dan tolak dari notifikasi
            extractCallActions(n);
            activeCallKey = sbn.getKey();

            String appCode = resolveAppCode(pkg, true);
            sendCallToBle(appCode, caller, text, timeStr);
            return;
        }

        // 2. EVALUASI PESAN CHAT (WHATSAPP, SMS, DLL)
        String appCode = resolveAppCode(pkg, false);
        if (appCode == null) {
            // Bukan aplikasi yang difilter / diizinkan
            return;
        }

        // Periksa filter WhatsApp (Pribadi vs Grup)
        if ("wa".equals(appCode)) {
            boolean isGroup = extras.getBoolean("android.isGroupConversation", false);
            if (isGroup) {
                boolean allowGroups = prefs.getBoolean(KEY_FILTER_WA_GROUPS, false);
                if (!allowGroups) return;
            } else {
                boolean allowPersonal = prefs.getBoolean(KEY_FILTER_WA_PERSONAL, true);
                if (!allowPersonal) return;
            }
        } else if ("sms".equals(appCode)) {
            boolean allowSms = prefs.getBoolean(KEY_FILTER_SMS, true);
            if (!allowSms) return;
        } else {
            boolean allowOthers = prefs.getBoolean(KEY_FILTER_OTHERS, false);
            if (!allowOthers) return;
        }

        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        if (TextUtils.isEmpty(textCs)) {
            textCs = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        }

        String sender = titleCs != null ? titleCs.toString() : "Pesan Baru";
        String message = textCs != null ? textCs.toString() : "";

        // Abaikan pesan kosong atau ringkasan grup kosong
        if (TextUtils.isEmpty(message)) return;

        sendMessageToBle(appCode, sender, message, timeStr);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn == null) return;
        if (activeCallKey != null && activeCallKey.equals(sbn.getKey())) {
            activeCallKey = null;
            currentCallAnswerIntent = null;
            currentCallRejectIntent = null;
            sendCallEndToBle();
        }
    }

    private boolean hasCallActions(Notification.Action[] actions) {
        if (actions == null) return false;
        for (Notification.Action act : actions) {
            if (act == null || act.title == null) continue;
            String t = act.title.toString().toLowerCase();
            if (t.contains("jawab") || t.contains("answer") || t.contains("terima")
                    || t.contains("tolak") || t.contains("decline") || t.contains("reject")) {
                return true;
            }
        }
        return false;
    }

    private void extractCallActions(Notification n) {
        if (n == null || n.actions == null) return;
        for (Notification.Action act : n.actions) {
            if (act == null || act.title == null) continue;
            String t = act.title.toString().toLowerCase();
            if (t.contains("jawab") || t.contains("answer") || t.contains("terima") || t.contains("accept")) {
                currentCallAnswerIntent = act.actionIntent;
            } else if (t.contains("tolak") || t.contains("decline") || t.contains("reject") || t.contains("dismiss")) {
                currentCallRejectIntent = act.actionIntent;
            }
        }
    }

    private String resolveAppCode(String pkg, boolean isCall) {
        if (pkg == null) return null;
        String p = pkg.toLowerCase();

        if (p.contains("whatsapp")) return "wa";
        if (p.contains("dialer") || p.contains("telecom") || p.contains("phone")) return "call";
        if (p.contains("messaging") || p.contains("mms") || p.contains("sms")) return "sms";
        if (p.contains("gmail") || p.contains("email")) return "gmail";
        if (p.contains("telegram")) return "tg";
        if (p.contains("instagram")) return "ig";

        return isCall ? "call" : "app";
    }

    // ========================================================
    // AKSI TELEPON DARI GESTUR ROBOT (TAP, 2X, TAHAN)
    // ========================================================

    public static void answerCall(Context context) {
        Log.d(TAG, "Mengeksekusi JAWAB panggilan...");
        // 1. Eksekusi aksi bawaan notifikasi (misal WhatsApp Call)
        if (currentCallAnswerIntent != null) {
            try {
                currentCallAnswerIntent.send();
                currentCallAnswerIntent = null;
                return;
            } catch (Exception e) {
                Log.e(TAG, "Gagal execute answer intent: " + e.getMessage());
            }
        }

        // 2. Eksekusi telepon seluler biasa via TelecomManager
        if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                TelecomManager tm = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.acceptRingingCall();
                }
            } catch (Exception e) {
                Log.e(TAG, "Gagal acceptRingingCall: " + e.getMessage());
            }
        }
    }

    public static void rejectCall(Context context) {
        Log.d(TAG, "Mengeksekusi TOLAK panggilan...");
        // 1. Eksekusi aksi tolak bawaan notifikasi (misal WhatsApp Call)
        if (currentCallRejectIntent != null) {
            try {
                currentCallRejectIntent.send();
                currentCallRejectIntent = null;
                return;
            } catch (Exception e) {
                Log.e(TAG, "Gagal execute reject intent: " + e.getMessage());
            }
        }

        // 2. Eksekusi tolak telepon seluler via TelecomManager
        if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                TelecomManager tm = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    tm.endCall();
                }
            } catch (Exception e) {
                Log.e(TAG, "Gagal endCall: " + e.getMessage());
            }
        }
    }

    public static void muteCall(Context context) {
        Log.d(TAG, "Mengeksekusi MUTE dering panggilan...");
        if (context != null) {
            try {
                AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_MUTE, 0);
                }
            } catch (Exception e) {
                Log.e(TAG, "Gagal mute ring: " + e.getMessage());
            }
        }
    }

    // ========================================================
    // TRANSMISI BLE KE ESP32
    // ========================================================

    private void sendCallToBle(String app, String from, String num, String timeStr) {
        try {
            JSONObject json = new JSONObject();
            json.put("c", "notif");
            json.put("t", "call");
            json.put("app", app);
            json.put("from", from);
            json.put("num", num);
            json.put("time", timeStr);

            BleManager ble = BleManager.getInstance(this);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuat JSON notif call: " + e.getMessage());
        }
    }

    private void sendMessageToBle(String app, String from, String msg, String timeStr) {
        try {
            JSONObject json = new JSONObject();
            json.put("c", "notif");
            json.put("t", "msg");
            json.put("app", app);
            json.put("from", from);
            json.put("msg", msg);
            json.put("time", timeStr);

            BleManager ble = BleManager.getInstance(this);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuat JSON notif msg: " + e.getMessage());
        }
    }

    private void sendCallEndToBle() {
        try {
            JSONObject json = new JSONObject();
            json.put("c", "notif");
            json.put("t", "call_end");

            BleManager ble = BleManager.getInstance(this);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal kirim call_end: " + e.getMessage());
        }
    }

    // ========================================================
    // HELPER SIMULASI UJI DARI APLIKASI
    // ========================================================

    public static void testNotification(Context context, String type) {
        if (context == null) return;
        String timeStr = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());

        try {
            JSONObject json = new JSONObject();
            json.put("c", "notif");
            if ("call".equalsIgnoreCase(type)) {
                json.put("t", "call");
                json.put("app", "wa");
                json.put("from", "IBU");
                json.put("num", "0812-3456-7890");
                json.put("time", timeStr);
            } else {
                json.put("t", "msg");
                json.put("app", "wa");
                json.put("from", "Dian Ayu");
                json.put("msg", "Halo, dokumen yang tadi sudah dikirim ke email ya, tolong dicek, makasih!");
                json.put("time", timeStr);
            }

            BleManager ble = BleManager.getInstance(context);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception ignored) {}
    }
}
