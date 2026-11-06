package com.shinoa.robotcompanion;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Mesin sinkronisasi lirik Spotify tingkat sistem (Native Java).
 * Beroperasi di Foreground Service sehingga tetap aktif 100% di latar belakang,
 * tanpa memerlukan izin berbahaya (Notification Listener) dan tidak pernah
 * di-freeze oleh sistem Android saat aplikasi di-minimize atau layar HP dimatikan.
 */
public class SpotifyLyricSyncEngine {
    private static final String TAG = "SpotifyLyricSync";
    private static SpotifyLyricSyncEngine instance;

    public static class LyricLine {
        public final double timeSec;
        public final String text;

        public LyricLine(double timeSec, String text) {
            this.timeSec = timeSec;
            this.text = text;
        }
    }

    @FunctionalInterface
    public interface SyncListener {
        void onMusicStateChanged(String title, String artist, double posSec, double durSec, boolean isPlaying, String activeLyric);
        default void onLyricsLoaded(String title, String artist, List<LyricLine> lyrics) {}
    }

    private Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService netExecutor = Executors.newSingleThreadExecutor();
    private ScheduledExecutorService tickerExecutor;
    private ScheduledFuture<?> tickerFuture;

    private PowerManager.WakeLock wakeLock;

    // Status Lagu Aktif
    private volatile String currentTitle = "";
    private volatile String currentArtist = "";
    private volatile double currentDurationSec = 0;
    private volatile double currentPositionSec = 0;
    private volatile boolean isPlaying = false;
    private volatile long lastUpdateTimestamp = 0; // SystemClock.elapsedRealtime()

    // Lirik
    private final List<LyricLine> currentLyrics = new ArrayList<>();
    private final Map<String, List<LyricLine>> lyricMemoryCache = new ConcurrentHashMap<>();
    private int currentFetchId = 0;

    // Penjaga deduplikasi pengiriman BLE
    private String lastSentLyric = "";
    private boolean lastSentPlaying = false;
    private int lastSentPos = -1;

    private SyncListener syncListener;

    public static synchronized SpotifyLyricSyncEngine getInstance() {
        if (instance == null) {
            instance = new SpotifyLyricSyncEngine();
        }
        return instance;
    }

    private SpotifyLyricSyncEngine() {}

    @SuppressLint("WakelockTimeout")
    public synchronized void start(Context context) {
        if (context == null) return;
        this.appContext = context.getApplicationContext();

        try {
            PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
            if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RobotDesk:LyricSyncWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "Gagal inisialisasi WakeLock: " + e.getMessage());
        }

        // Mulai timer ticker presisi tinggi (100ms)
        if (tickerExecutor == null || tickerExecutor.isShutdown()) {
            tickerExecutor = Executors.newSingleThreadScheduledExecutor();
            tickerFuture = tickerExecutor.scheduleWithFixedDelay(this::tickSyncLoop, 100, 100, TimeUnit.MILLISECONDS);
        }

        // Daftarkan listener ke SpotifyMediaManager
        SpotifyMediaManager.getInstance().register(appContext, this::onMusicStateChanged);
        Log.d(TAG, "SpotifyLyricSyncEngine berhasil dimulai.");
    }

    public synchronized void stop() {
        if (tickerFuture != null) {
            tickerFuture.cancel(true);
            tickerFuture = null;
        }
        if (tickerExecutor != null) {
            tickerExecutor.shutdownNow();
            tickerExecutor = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
        Log.d(TAG, "SpotifyLyricSyncEngine dihentikan.");
    }

    public void setSyncListener(SyncListener listener) {
        this.syncListener = listener;
        if (listener != null) {
            dispatchToListener(getActiveLyricAtTime(getCurrentPositionSec() + 0.15));
        }
    }

    /**
     * Menerima pembaruan metadata dan status putar dari Spotify Broadcast.
     */
    public synchronized void onMusicStateChanged(String title, String artist, double posSec, double durSec, boolean playing) {
        String safeTitle = (title != null) ? title.trim() : "";
        String safeArtist = (artist != null) ? artist.trim() : "";

        // Kasus: Musik berhenti total / Spotify ditutup
        if (safeTitle.isEmpty()) {
            currentTitle = "";
            currentArtist = "";
            currentDurationSec = 0;
            currentPositionSec = 0;
            isPlaying = false;
            lastUpdateTimestamp = SystemClock.elapsedRealtime();
            synchronized (currentLyrics) {
                currentLyrics.clear();
            }

            if (!"__STANDBY__".equals(lastSentLyric)) {
                sendBleSpotifyCommand("", "", "", 0, 0, false);
                lastSentLyric = "__STANDBY__";
                lastSentPlaying = false;
                lastSentPos = -1;
            }

            if (wakeLock != null && wakeLock.isHeld()) {
                try { wakeLock.release(); } catch (Exception ignored) {}
            }

            dispatchToListener("");
            return;
        }

        boolean trackChanged = !safeTitle.equalsIgnoreCase(currentTitle) || !safeArtist.equalsIgnoreCase(currentArtist);

        if (trackChanged) {
            currentTitle = safeTitle;
            currentArtist = safeArtist;
            currentDurationSec = durSec;
            currentPositionSec = posSec;
            isPlaying = playing;
            lastUpdateTimestamp = SystemClock.elapsedRealtime();
            lastSentLyric = "__RESET__";
            lastSentPos = -1;

            fetchLyricsAsync(safeTitle, safeArtist, durSec);
        } else {
            // Lagu yang sama: update status play / pause / seek
            boolean prevPlaying = isPlaying;
            isPlaying = playing;
            if (durSec > 0) currentDurationSec = durSec;

            if (!prevPlaying && playing) {
                // RESUME
                if (posSec > 0) currentPositionSec = posSec;
                lastUpdateTimestamp = SystemClock.elapsedRealtime();
            } else if (prevPlaying && !playing) {
                // PAUSE: Bekukan posisi detik
                double elapsed = (lastUpdateTimestamp > 0) ? (SystemClock.elapsedRealtime() - lastUpdateTimestamp) / 1000.0 : 0;
                currentPositionSec = Math.min(currentPositionSec + elapsed, currentDurationSec > 0 ? currentDurationSec : 9999.0);
                lastUpdateTimestamp = SystemClock.elapsedRealtime();
            } else if (posSec > 0) {
                currentPositionSec = posSec;
                lastUpdateTimestamp = SystemClock.elapsedRealtime();
            }
        }

        // Kelola WakeLock agar CPU tidak sleep saat musik aktif di latar belakang
        if (isPlaying) {
            if (wakeLock != null && !wakeLock.isHeld()) {
                try { wakeLock.acquire(30 * 60 * 1000L); /* 30 menit max */ } catch (Exception ignored) {}
            }
        } else {
            if (wakeLock != null && wakeLock.isHeld()) {
                try { wakeLock.release(); } catch (Exception ignored) {}
            }
        }

        dispatchRealtimeLyricSync(true);
    }

    /**
     * Loop realtime 100ms untuk mengevaluasi detik lagu dan mengirim baris lirik baru via BLE.
     */
    private void tickSyncLoop() {
        try {
            if (!isPlaying || currentTitle.isEmpty()) {
                return;
            }
            dispatchRealtimeLyricSync(false);
        } catch (Exception e) {
            Log.e(TAG, "Error in tickSyncLoop: " + e.getMessage());
        }
    }

    private void dispatchRealtimeLyricSync(boolean forcePriority) {
        if (currentTitle.isEmpty()) return;

        double curPos = getCurrentPositionSec();
        double evalPos = curPos + 0.15; // Kompensasi lookahead 150ms agar pas dengan vokal
        String activeLyric = getActiveLyricAtTime(evalPos);
        int intPos = (int) Math.floor(curPos);
        int intDur = (int) Math.floor(currentDurationSec);

        // Kirim HANYA jika baris lirik berubah atau status play/pause berubah atau dipaksa
        if (forcePriority || !activeLyric.equals(lastSentLyric) || (isPlaying != lastSentPlaying)) {
            sendBleSpotifyCommand(currentTitle, currentArtist, activeLyric, intPos, intDur, isPlaying);
            lastSentLyric = activeLyric;
            lastSentPlaying = isPlaying;
            lastSentPos = intPos;

            dispatchToListener(activeLyric);
        }
    }

    public double getCurrentPositionSec() {
        if (!isPlaying || lastUpdateTimestamp <= 0) {
            return currentPositionSec;
        }
        double elapsed = (SystemClock.elapsedRealtime() - lastUpdateTimestamp) / 1000.0;
        return Math.min(currentPositionSec + elapsed, currentDurationSec > 0 ? currentDurationSec : 9999.0);
    }

    private String getActiveLyricAtTime(double sec) {
        synchronized (currentLyrics) {
            if (currentLyrics.isEmpty()) return "";
            String active = "";
            for (LyricLine line : currentLyrics) {
                if (line.timeSec <= sec) {
                    active = line.text;
                } else {
                    break;
                }
            }
            return active;
        }
    }

    private void sendBleSpotifyCommand(String title, String artist, String lyric, int pos, int dur, boolean play) {
        if (appContext == null) return;
        try {
            JSONObject json = new JSONObject();
            json.put("c", "spotify");
            json.put("t", title);
            json.put("a", artist);
            json.put("l", lyric);
            json.put("p", pos);
            json.put("d", dur);
            json.put("play", play);

            BleManager ble = BleManager.getInstance(appContext);
            if (ble != null && ble.isConnected()) {
                ble.sendCommand(json.toString());
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuat/mengirim JSON BLE: " + e.getMessage());
        }
    }

    private void dispatchToListener(String activeLyric) {
        if (syncListener != null) {
            double curPos = getCurrentPositionSec();
            mainHandler.post(() -> {
                if (syncListener != null) {
                    syncListener.onMusicStateChanged(currentTitle, currentArtist, curPos, currentDurationSec, isPlaying, activeLyric);
                }
            });
        }
    }

    // ========================================================
    // UNDUH & PARSING LIRIK (LRCLIB REST API)
    // ========================================================

    private void fetchLyricsAsync(String title, String artist, double durationSec) {
        final String cleanTitle = title.replaceAll("\\(.*?\\)|\\[.*?\\]", "").trim();
        final String cleanArtist = artist.replaceAll("\\(.*?\\)|\\[.*?\\]", "").trim();
        final String trackKey = (cleanTitle + "::" + cleanArtist).toLowerCase();

        // 1. Cek cache memori instan (0 ms)
        List<LyricLine> cached = lyricMemoryCache.get(trackKey);
        if (cached != null && !cached.isEmpty()) {
            synchronized (currentLyrics) {
                currentLyrics.clear();
                currentLyrics.addAll(cached);
            }
            dispatchRealtimeLyricSync(true);
            if (syncListener != null) {
                mainHandler.post(() -> {
                    if (syncListener != null) syncListener.onLyricsLoaded(currentTitle, currentArtist, cached);
                });
            }
            return;
        }

        final int requestId = ++currentFetchId;
        synchronized (currentLyrics) {
            currentLyrics.clear();
        }

        netExecutor.execute(() -> {
            if (requestId != currentFetchId) return;

            int roundDur = (int) Math.round(durationSec);
            String lrcContent = null;
            boolean isPlain = false;

            // Percobaan 1: Menggunakan /api/get (jika ada durasi lagu)
            if (roundDur > 10) {
                try {
                    String getUrl = "https://lrclib.net/api/get?track_name=" + URLEncoder.encode(cleanTitle, "UTF-8")
                            + "&artist_name=" + URLEncoder.encode(cleanArtist, "UTF-8")
                            + "&duration=" + roundDur;
                    String resp = executeHttpGet(getUrl);
                    if (resp != null) {
                        JSONObject obj = new JSONObject(resp);
                        String synced = obj.optString("syncedLyrics", "");
                        if (!synced.trim().isEmpty()) {
                            lrcContent = synced;
                        } else {
                            String plain = obj.optString("plainLyrics", "");
                            if (!plain.trim().isEmpty()) {
                                lrcContent = plain;
                                isPlain = true;
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            // Percobaan 2: Fallback ke /api/search jika get gagal atau lirik belum dapat
            if (lrcContent == null && requestId == currentFetchId) {
                try {
                    String searchUrl = "https://lrclib.net/api/search?track_name=" + URLEncoder.encode(cleanTitle, "UTF-8")
                            + "&artist_name=" + URLEncoder.encode(cleanArtist, "UTF-8");
                    String resp = executeHttpGet(searchUrl);
                    if (resp != null) {
                        JSONArray array = new JSONArray(resp);
                        // Prioritaskan syncedLyrics
                        for (int i = 0; i < array.length(); i++) {
                            JSONObject item = array.getJSONObject(i);
                            String synced = item.optString("syncedLyrics", "");
                            if (!synced.trim().isEmpty()) {
                                lrcContent = synced;
                                isPlain = false;
                                break;
                            }
                        }
                        // Jika tidak ada synced, ambil plainLyrics
                        if (lrcContent == null) {
                            for (int i = 0; i < array.length(); i++) {
                                JSONObject item = array.getJSONObject(i);
                                String plain = item.optString("plainLyrics", "");
                                if (!plain.trim().isEmpty()) {
                                    lrcContent = plain;
                                    isPlain = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            if (requestId != currentFetchId || lrcContent == null) return;

            List<LyricLine> parsed = parseLrc(lrcContent, isPlain);
            if (!parsed.isEmpty()) {
                lyricMemoryCache.put(trackKey, parsed);
                synchronized (currentLyrics) {
                    currentLyrics.clear();
                    currentLyrics.addAll(parsed);
                }
                dispatchRealtimeLyricSync(true);
                if (syncListener != null) {
                    mainHandler.post(() -> {
                        if (syncListener != null) syncListener.onLyricsLoaded(currentTitle, currentArtist, parsed);
                    });
                }
                Log.d(TAG, "Lirik berhasil dimuat untuk: " + cleanTitle + " (" + parsed.size() + " baris)");
            }
        });
    }

    private List<LyricLine> parseLrc(String lrcText, boolean isPlain) {
        List<LyricLine> list = new ArrayList<>();
        if (lrcText == null || lrcText.trim().isEmpty()) return list;

        if (isPlain) {
            String[] lines = lrcText.split("\n");
            double t = 0.0;
            for (String line : lines) {
                String trimmed = line.trim();
                if (!trimmed.isEmpty()) {
                    list.add(new LyricLine(t, trimmed));
                    t += 4.0;
                }
            }
            return list;
        }

        Pattern pattern = Pattern.compile("\\[(\\d{2}):(\\d{2}(?:\\.\\d{1,3})?)\\](.*)");
        String[] lines = lrcText.split("\n");

        for (String raw : lines) {
            String trimmed = raw.trim();
            Matcher matcher = pattern.matcher(trimmed);
            if (matcher.find()) {
                try {
                    int min = Integer.parseInt(matcher.group(1));
                    double sec = Double.parseDouble(matcher.group(2));
                    double totalSec = (min * 60.0) + sec;
                    String text = matcher.group(3).trim();
                    list.add(new LyricLine(totalSec, text));
                } catch (Exception ignored) {}
            }
        }

        Collections.sort(list, Comparator.comparingDouble(a -> a.timeSec));
        return list;
    }

    private String executeHttpGet(String urlString) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("User-Agent", "RobotDeskApp/1.0");

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                InputStream is = conn.getInputStream();
                InputStreamReader reader = new InputStreamReader(is, StandardCharsets.UTF_8);
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[4096];
                int len;
                while ((len = reader.read(buf, 0, buf.length)) != -1) {
                    sb.append(buf, 0, len);
                }
                reader.close();
                return sb.toString();
            }
        } catch (Exception e) {
            Log.w(TAG, "HTTP GET failed for " + urlString + ": " + e.getMessage());
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
        }
        return null;
    }
}
