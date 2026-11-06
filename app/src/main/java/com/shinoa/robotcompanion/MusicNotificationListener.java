package com.shinoa.robotcompanion;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.text.TextUtils;
import android.util.Log;

import java.util.List;

public class MusicNotificationListener extends NotificationListenerService {
    private static final String TAG = "MusicListener";
    private static MusicNotificationListener instance;

    private MediaSessionManager mediaSessionManager;
    private MediaController activeController;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MusicStateListener stateListener;

    public interface MusicStateListener {
        void onMusicStateChanged(String title, String artist, long posSec, long durSec, boolean isPlaying);
    }

    private final MediaController.Callback mediaCallback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            super.onPlaybackStateChanged(state);
            dispatchCurrentMusicState();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            super.onMetadataChanged(metadata);
            dispatchCurrentMusicState();
        }
    };

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChangedListener =
            new MediaSessionManager.OnActiveSessionsChangedListener() {
                @Override
                public void onActiveSessionsChanged(List<MediaController> controllers) {
                    selectBestController(controllers);
                }
            };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        mediaSessionManager = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        instance = this;
        Log.d(TAG, "NotificationListener Connected!");
        try {
            ComponentName componentName = new ComponentName(this, MusicNotificationListener.class);
            mediaSessionManager.addOnActiveSessionsChangedListener(sessionsChangedListener, componentName);
            selectBestController(mediaSessionManager.getActiveSessions(componentName));
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException saat mengakses MediaSession", e);
        }
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        if (activeController != null) {
            activeController.unregisterCallback(mediaCallback);
            activeController = null;
        }
        if (instance == this) {
            instance = null;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            if (mediaSessionManager != null && sessionsChangedListener != null) {
                mediaSessionManager.removeOnActiveSessionsChangedListener(sessionsChangedListener);
            }
        } catch (Exception ignored) {}
        if (activeController != null) {
            activeController.unregisterCallback(mediaCallback);
            activeController = null;
        }
        if (instance == this) {
            instance = null;
        }
    }

    private void selectBestController(List<MediaController> controllers) {
        if (controllers == null || controllers.isEmpty()) {
            if (activeController != null) {
                activeController.unregisterCallback(mediaCallback);
                activeController = null;
            }
            dispatchCurrentMusicState();
            return;
        }

        MediaController best = null;
        // Prioritaskan pemutar yang sedang aktif memutar lagu
        for (MediaController c : controllers) {
            PlaybackState st = c.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) {
                best = c;
                break;
            }
        }

        // Jika tidak ada yang sedang playing, cari Spotify atau gunakan controller pertama
        if (best == null) {
            for (MediaController c : controllers) {
                if (c.getPackageName().toLowerCase().contains("spotify")) {
                    best = c;
                    break;
                }
            }
        }

        if (best == null) {
            best = controllers.get(0);
        }

        if (activeController != best) {
            if (activeController != null) {
                activeController.unregisterCallback(mediaCallback);
            }
            activeController = best;
            activeController.registerCallback(mediaCallback, mainHandler);
        }

        dispatchCurrentMusicState();
    }

    public void dispatchCurrentMusicState() {
        if (activeController == null) {
            notifyState("", "", 0, 0, false);
            return;
        }

        MediaMetadata metadata = activeController.getMetadata();
        PlaybackState state = activeController.getPlaybackState();

        String title = "";
        String artist = "";
        long durationMs = 0;
        long positionMs = 0;
        boolean isPlaying = false;

        if (metadata != null) {
            title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE);
            if (TextUtils.isEmpty(title)) {
                title = metadata.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
            }
            artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST);
            if (TextUtils.isEmpty(artist)) {
                artist = metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
            }
            durationMs = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION);
        }

        if (state != null) {
            isPlaying = (state.getState() == PlaybackState.STATE_PLAYING);
            positionMs = state.getPosition();
        }

        if (title == null) title = "";
        if (artist == null) artist = "";

        notifyState(title, artist, positionMs / 1000, durationMs / 1000, isPlaying);
    }

    private void notifyState(String title, String artist, long posSec, long durSec, boolean isPlaying) {
        if (stateListener != null) {
            mainHandler.post(() -> stateListener.onMusicStateChanged(title, artist, posSec, durSec, isPlaying));
        }
    }

    public static MusicNotificationListener getInstance() {
        return instance;
    }

    public void setStateListener(MusicStateListener listener) {
        this.stateListener = listener;
        dispatchCurrentMusicState();
    }

    public static boolean isNotificationAccessGranted(Context context) {
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
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Gagal membuka settings notification listener", e);
        }
    }

    public static void playPause() {
        if (instance != null && instance.activeController != null) {
            PlaybackState state = instance.activeController.getPlaybackState();
            if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                instance.activeController.getTransportControls().pause();
            } else {
                instance.activeController.getTransportControls().play();
            }
        }
    }

    public static void skipNext() {
        if (instance != null && instance.activeController != null) {
            instance.activeController.getTransportControls().skipToNext();
        }
    }

    public static void skipPrev() {
        if (instance != null && instance.activeController != null) {
            instance.activeController.getTransportControls().skipToPrevious();
        }
    }
}
