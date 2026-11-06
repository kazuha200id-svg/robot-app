package com.shinoa.robotcompanion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Static Broadcast Receiver di AndroidManifest.xml
 * Memastikan pembaruan metadata dan status lagu dari Spotify tetap tertangkap
 * dan diteruskan ke RobotCompanionService / SpotifyLyricSyncEngine.
 */
public class SpotifyBroadcastReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        RobotCompanionService.start(context);
        SpotifyMediaManager.getInstance().handleIntent(intent);
    }
}
