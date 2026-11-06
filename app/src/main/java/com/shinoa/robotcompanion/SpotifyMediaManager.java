package com.shinoa.robotcompanion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.view.KeyEvent;

public class SpotifyMediaManager {
    private static SpotifyMediaManager instance;
    private BroadcastReceiver receiver;
    private MusicStateListener stateListener;
    private boolean isRegistered = false;

    private String currentTitle = "";
    private String currentArtist = "";
    private double currentDurationSec = 0;
    private double currentPositionSec = 0;
    private boolean isPlaying = false;

    private final android.os.Handler watchdogHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Context appContext;
    private int inactiveAudioSeconds = 0;

    private final Runnable audioWatchdogRunnable = new Runnable() {
        @Override
        public void run() {
            if (appContext != null) {
                AudioManager am = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
                boolean isMusicActive = (am != null && am.isMusicActive());

                if (!isMusicActive) {
                    inactiveAudioSeconds++;
                    if (isPlaying) {
                        // Musik terdeteksi berhenti berbunyi di level audio OS
                        isPlaying = false;
                        dispatchState();
                    } else if (inactiveAudioSeconds >= 3 && !currentTitle.isEmpty()) {
                        // Spotify ditutup / musik di-stop total selama 3 detik
                        currentTitle = "";
                        currentArtist = "";
                        currentPositionSec = 0;
                        currentDurationSec = 0;
                        isPlaying = false;
                        dispatchState();
                    }
                } else {
                    inactiveAudioSeconds = 0;
                }
            }
            watchdogHandler.postDelayed(this, 1000);
        }
    };

    public interface MusicStateListener {
        void onMusicStateChanged(String title, String artist, double posSec, double durSec, boolean isPlaying);
    }

    public static synchronized SpotifyMediaManager getInstance() {
        if (instance == null) {
            instance = new SpotifyMediaManager();
        }
        return instance;
    }

    public void register(Context context, MusicStateListener listener) {
        this.appContext = context.getApplicationContext();
        this.stateListener = listener;

        if (!isRegistered) {
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    if (intent == null || intent.getAction() == null) return;
                    String action = intent.getAction();

                    if ("com.spotify.music.metadatachanged".equals(action)) {
                        String track = intent.getStringExtra("track");
                        String artist = intent.getStringExtra("artist");
                        int lengthMs = intent.getIntExtra("length", 0);
                        int posMs = intent.getIntExtra("playbackPosition", -1);

                        if (track != null) currentTitle = track;
                        if (artist != null) currentArtist = artist;
                        if (lengthMs > 0) currentDurationSec = lengthMs / 1000.0;
                        if (posMs >= 0) currentPositionSec = posMs / 1000.0;
                        inactiveAudioSeconds = 0;

                        dispatchState();
                    } else if ("com.spotify.music.playbackstatechanged".equals(action)) {
                        boolean playing = intent.getBooleanExtra("playing", false);
                        isPlaying = playing;
                        inactiveAudioSeconds = 0;

                        // JANGAN reset currentPositionSec ke 0 saat pause kecuali ada data valid > 0
                        if (intent.hasExtra("playbackPosition")) {
                            int posMs = intent.getIntExtra("playbackPosition", -1);
                            if (posMs > 0) {
                                currentPositionSec = posMs / 1000.0;
                            }
                        }

                        dispatchState();
                    } else if ("com.spotify.music.queuechanged".equals(action)) {
                        dispatchState();
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction("com.spotify.music.metadatachanged");
            filter.addAction("com.spotify.music.playbackstatechanged");
            filter.addAction("com.spotify.music.queuechanged");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                appContext.registerReceiver(receiver, filter);
            }
            isRegistered = true;

            // Mulai watchdog audio OS
            watchdogHandler.removeCallbacks(audioWatchdogRunnable);
            watchdogHandler.postDelayed(audioWatchdogRunnable, 1000);
        }

        dispatchState();
    }

    public void unregister(Context context) {
        watchdogHandler.removeCallbacks(audioWatchdogRunnable);
        if (isRegistered && receiver != null) {
            try {
                context.getApplicationContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {}
            isRegistered = false;
            receiver = null;
        }
    }

    public void dispatchState() {
        if (stateListener != null) {
            stateListener.onMusicStateChanged(currentTitle, currentArtist, currentPositionSec, currentDurationSec, isPlaying);
        }
    }

    public static void playPause(Context context) {
        sendMediaKeyEvent(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
    }

    public static void skipNext(Context context) {
        sendMediaKeyEvent(context, KeyEvent.KEYCODE_MEDIA_NEXT);
    }

    public static void skipPrev(Context context) {
        sendMediaKeyEvent(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS);
    }

    private static void sendMediaKeyEvent(Context context, int keyCode) {
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            long eventTime = SystemClock.uptimeMillis();
            am.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_DOWN, keyCode, 0));
            am.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_UP, keyCode, 0));
        }
    }

    public static void openSpotify(Context context) {
        try {
            Intent intent = context.getPackageManager().getLaunchIntentForPackage("com.spotify.music");
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } else {
                Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://open.spotify.com"));
                webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(webIntent);
            }
        } catch (Exception ignored) {}
    }
}
