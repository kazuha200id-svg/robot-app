package com.shinoa.robotcompanion;

import android.companion.AssociationInfo;
import android.companion.CompanionDeviceService;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

/**
 * Layanan resmi Android Companion Device Service.
 * Sistem Android otomatis meningkatkan prioritas latar belakang aplikasi
 * saat perangkat robot terdeteksi atau terhubung, sehingga proses sinkronisasi
 * lirik Spotify tidak pernah dihentikan oleh OS.
 */
@RequiresApi(api = Build.VERSION_CODES.S)
public class RobotCompanionDeviceService extends CompanionDeviceService {
    private static final String TAG = "CompanionDeviceService";

    @Override
    public void onDeviceAppeared(@NonNull String address) {
        super.onDeviceAppeared(address);
        Log.d(TAG, "Perangkat robot terdeteksi (API 31): " + address);
        RobotCompanionService.start(this);
    }

    @Override
    public void onDeviceDisappeared(@NonNull String address) {
        super.onDeviceDisappeared(address);
        Log.d(TAG, "Perangkat robot terputus (API 31): " + address);
    }

    @Override
    public void onDeviceAppeared(@NonNull AssociationInfo associationInfo) {
        super.onDeviceAppeared(associationInfo);
        Log.d(TAG, "Perangkat robot terdeteksi (API 33+): " + associationInfo.getId());
        RobotCompanionService.start(this);
    }

    @Override
    public void onDeviceDisappeared(@NonNull AssociationInfo associationInfo) {
        super.onDeviceDisappeared(associationInfo);
        Log.d(TAG, "Perangkat robot terputus (API 33+): " + associationInfo.getId());
    }
}
