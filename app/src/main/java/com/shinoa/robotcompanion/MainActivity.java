package com.shinoa.robotcompanion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.Uri;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity implements BleManager.BleListener {
    private static final int REQ_NEARBY = 101;
    private static final int REQ_LOCATION = 102;
    private static final int REQ_NAV_LOCATION = 103;

    private WebView webView;
    private BleManager bleManager;
    private Vibrator vibrator;
    private boolean receiverRegistered = false;
    private boolean hasInitialScanStarted = false;
    private boolean isWaitingNativePermission = false;
    private boolean hasDeniedNearby = false;
    private boolean hasDeniedLocation = false;
    private Dialog activeDialog = null;

    private boolean isNavFeatureActive = false;
    private boolean isWaitingNavPermissions = false;
    private boolean isWaitingGpsSettings = false;
    private String pendingShareText = null;

    private LocationListener gpsLocationListener = null;

    private final android.os.Handler backgroundTicker = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable backgroundTickRunnable = new Runnable() {
        @Override
        public void run() {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onBackgroundTick) window.onBackgroundTick();", null);
            }
            backgroundTicker.postDelayed(this, 150);
        }
    };

    private final BroadcastReceiver btStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                if (state == BluetoothAdapter.STATE_ON) {
                    runOnUiThread(() -> {
                        webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(true);", null);
                        if (bleManager != null) {
                            if (bleManager.hasSavedDevice()) {
                                bleManager.connectToSavedDevice();
                            } else if (!hasInitialScanStarted) {
                                hasInitialScanStarted = true;
                                bleManager.startScan();
                            }
                        }
                    });
                } else if (state == BluetoothAdapter.STATE_OFF) {
                    runOnUiThread(() -> {
                        webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(false);", null);
                        bleManager.disconnect();
                    });
                }
            }
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen dark look
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
        getWindow().setStatusBarColor(0xFF060B13);
        getWindow().setNavigationBarColor(0xFF060B13);

        webView = new WebView(this);
        setContentView(webView);

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        bleManager = BleManager.getInstance(this);
        bleManager.setListener(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                checkPermissionsAndProceed();
                if (pendingShareText != null) {
                    webView.evaluateJavascript("if (window.handleIncomingMapsShare) window.handleIncomingMapsShare('" + escapeJs(pendingShareText) + "');", null);
                }
            }
        });
        settings.setGeolocationEnabled(true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });
        webView.setBackgroundColor(0xFF060B13);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBLE");

        webView.loadUrl("file:///android_asset/index.html");

        IntentFilter filter = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        registerReceiver(btStateReceiver, filter);
        receiverRegistered = true;

        backgroundTicker.postDelayed(backgroundTickRunnable, 1000);

        // Jalankan Foreground Service resmi untuk menjaga koneksi BLE & Spotify di latar belakang
        RobotCompanionService.start(this);

        // Periksa apakah aplikasi dibuka dari "Bagikan" Google Maps
        handleIncomingShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShareIntent(intent);
    }

    private void handleIncomingShareIntent(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null && !sharedText.trim().isEmpty()) {
                pendingShareText = sharedText.trim();
                runOnUiThread(() -> {
                    if (webView != null) {
                        webView.evaluateJavascript("if (window.handleIncomingMapsShare) window.handleIncomingMapsShare('" + escapeJs(pendingShareText) + "');", null);
                    }
                });
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bleManager != null) {
            bleManager.setListener(this);
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript("if (window.onBLEStatus) window.onBLEStatus(" + bleManager.isConnected() + ", '" + (bleManager.isConnected() ? "Tersambung ke Robot" : "Terputus") + "');", null);
                }
            });
        }
        SpotifyLyricSyncEngine.getInstance().setSyncListener((title, artist, posSec, durSec, isPlaying, activeLyric) -> {
            runOnUiThread(() -> {
                if (webView != null) {
                    try {
                        org.json.JSONObject obj = new org.json.JSONObject();
                        obj.put("title", title);
                        obj.put("artist", artist);
                        obj.put("pos", posSec);
                        obj.put("dur", durSec);
                        obj.put("play", isPlaying);
                        obj.put("lyric", activeLyric);
                        webView.evaluateJavascript("if (window.onMusicStateChanged) window.onMusicStateChanged(" + obj.toString() + ");", null);
                    } catch (Exception ignored) {}
                }
            });
        });
        checkPermissionsAndProceed();

        // HANYA dipanggil jika pengguna baru saja kembali dari layar Pengaturan Lokasi HP
        if (isWaitingGpsSettings) {
            isWaitingGpsSettings = false;
            checkAndOpenNavigationFeature();
        }
    }

    private void checkPermissionsAndProceed() {
        if (isFinishing() || isDestroyed()) return;
        // JANGAN tampilkan apapun selama dialog izin bawaan Android sedang aktif di layar
        if (isWaitingNativePermission) return;

        // 1. Cek Perizinan Perangkat di Sekitar (Android 12+ / API 31+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean hasScan = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
            boolean hasConnect = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;

            if (!hasScan || !hasConnect) {
                if (hasDeniedNearby) {
                    // Hanya munculkan popup custom jika sudah pernah DITOLAK oleh pengguna
                    showPermissionPopup(
                        "Izin Perangkat di Sekitar",
                        "Aplikasi memerlukan izin perangkat di sekitar untuk mendeteksi dan menghubungkan Robot Desk.",
                        this::reRequestNearbyPermissions
                    );
                } else {
                    // Minta izin bawaan Android secara langsung tanpa popup custom di awal
                    isWaitingNativePermission = true;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT},
                            REQ_NEARBY);
                }
                return;
            } else {
                hasDeniedNearby = false;
            }
            // Di Android 12+, Bluetooth menggunakan 'neverForLocation' sehingga Lokasi dan GPS TIDAK DIPERLUKAN sama sekali!
        } else {
            // Khusus HP jadul (Android 11 ke bawah / API <= 30), sistem Android mewajibkan izin lokasi & GPS untuk BLE
            // 2. Cek Perizinan Lokasi
            boolean hasLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!hasLocation) {
                if (hasDeniedLocation) {
                    showPermissionPopup(
                        "Izin Lokasi",
                        "Aplikasi memerlukan izin lokasi untuk memindai sinyal Robot Desk di sekitar Anda.",
                        this::reRequestLocationPermissions
                    );
                } else {
                    isWaitingNativePermission = true;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                            REQ_LOCATION);
                }
                return;
            } else {
                hasDeniedLocation = false;
            }

            // 3. Cek Apakah Layanan Lokasi (GPS) Aktif (Hanya Android 11 ke bawah)
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            boolean isGpsEnabled = false;
            try {
                isGpsEnabled = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            } catch (Exception ignored) {}

            if (!isGpsEnabled) {
                showPermissionPopup(
                    "Aktifkan Lokasi",
                    "Layanan lokasi (GPS) pada HP Anda belum aktif. Harap aktifkan lokasi untuk memindai Robot Desk.",
                    () -> {
                        try {
                            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                            startActivity(intent);
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this, "Gagal membuka pengaturan lokasi", Toast.LENGTH_SHORT).show();
                        }
                    }
                );
                return;
            }
        }

        // Jika semua perizinan terpenuhi, tutup pop-up dialog yang aktif
        if (activeDialog != null && activeDialog.isShowing()) {
            activeDialog.dismiss();
            activeDialog = null;
        }

        // Cek status Bluetooth adapter dan kirim ke UI WebView
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        boolean isBtOn = adapter != null && adapter.isEnabled();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(" + isBtOn + ");", null);
            }
        });

        // Jalankan koneksi / pemindaian saat Bluetooth telah aktif
        if (isBtOn && !hasInitialScanStarted) {
            hasInitialScanStarted = true;
            runOnUiThread(() -> {
                if (bleManager != null) {
                    if (bleManager.hasSavedDevice()) {
                        bleManager.connectToSavedDevice();
                    } else {
                        bleManager.startScan();
                    }
                }
            });
        }
    }

    private int dp(float val) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, val, getResources().getDisplayMetrics());
    }

    private void showCustomCyberPopup(String title, String message, String allowText, Runnable onAllow, Runnable onCancel) {
        if (isFinishing() || isDestroyed()) return;
        if (activeDialog != null && activeDialog.isShowing()) {
            activeDialog.dismiss();
            activeDialog = null;
        }

        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);

        // Kontainer utama bertema Cyberpunk Dark & Neon Cyan
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(22), dp(22), dp(20));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#0A1222"));
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1.5f), Color.parseColor("#00F0FF"));
        root.setBackground(bg);

        // Judul dialog
        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.parseColor("#00F0FF"));
        titleView.setTextSize(17);
        titleView.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        titleView.setLetterSpacing(0.04f);
        root.addView(titleView);

        // Pesan dialog
        TextView msgView = new TextView(this);
        msgView.setText(message);
        msgView.setTextColor(Color.parseColor("#8EA9C7"));
        msgView.setTextSize(13.5f);
        msgView.setLineSpacing(dp(3), 1.0f);
        LinearLayout.LayoutParams msgParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        msgParams.topMargin = dp(10);
        msgParams.bottomMargin = dp(22);
        root.addView(msgView, msgParams);

        // Baris tombol aksi
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);

        // Tombol TUTUP (Sisi Kiri)
        Button btnClose = new Button(this);
        btnClose.setText("TUTUP");
        btnClose.setTextColor(Color.parseColor("#8EA9C7"));
        btnClose.setTextSize(13);
        btnClose.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        GradientDrawable closeBg = new GradientDrawable();
        closeBg.setColor(Color.parseColor("#101C33"));
        closeBg.setCornerRadius(dp(8));
        closeBg.setStroke(dp(1), Color.parseColor("#26456E"));
        btnClose.setBackground(closeBg);
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0, dp(42), 1f);
        closeParams.rightMargin = dp(10);
        btnClose.setOnClickListener(v -> {
            dialog.dismiss();
            activeDialog = null;
            if (onCancel != null) {
                onCancel.run();
            } else {
                finishAffinity();
            }
        });
        btnRow.addView(btnClose, closeParams);

        // Tombol IZINKAN (Sisi Kanan)
        Button btnAllow = new Button(this);
        btnAllow.setText(allowText != null ? allowText : "IZINKAN");
        btnAllow.setTextColor(Color.parseColor("#050A14"));
        btnAllow.setTextSize(13);
        btnAllow.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        GradientDrawable allowBg = new GradientDrawable();
        allowBg.setColor(Color.parseColor("#00F0FF"));
        allowBg.setCornerRadius(dp(8));
        btnAllow.setBackground(allowBg);
        LinearLayout.LayoutParams allowParams = new LinearLayout.LayoutParams(0, dp(42), 1f);
        btnAllow.setOnClickListener(v -> {
            dialog.dismiss();
            activeDialog = null;
            if (onAllow != null) onAllow.run();
        });
        btnRow.addView(btnAllow, allowParams);

        root.addView(btnRow);

        dialog.setContentView(root);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            dialog.getWindow().setLayout(
                    (int) (getResources().getDisplayMetrics().widthPixels * 0.88),
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
        }
        activeDialog = dialog;
        dialog.show();
    }

    private void showPermissionPopup(String title, String message, Runnable onAllow) {
        showCustomCyberPopup(title, message, "IZINKAN", onAllow, this::finishAffinity);
    }

    public void checkAndOpenNavigationFeature() {
        if (isFinishing() || isDestroyed()) return;

        // Cek Izin Lokasi Presisi Tinggi (GPS)
        boolean hasFineLoc = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFineLoc) {
            isWaitingNavPermissions = true;
            showCustomCyberPopup(
                "Izin Lokasi & GPS Kendaraan",
                "Aplikasi memerlukan akses GPS presisi tinggi untuk menghitung rute navigasi dan speedometer kecepatan laju kendaraan secara akurat di layar robot.",
                "IZINKAN",
                () -> {
                    isWaitingNativePermission = true;
                    ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQ_NAV_LOCATION);
                },
                this::cancelNavAndReturnToRobot
            );
            return;
        }

        // Cek Status Layanan GPS HP
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        boolean isGpsEnabled = false;
        try {
            isGpsEnabled = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (Exception ignored) {}

        if (!isGpsEnabled) {
            isWaitingNavPermissions = true;
            showCustomCyberPopup(
                "Aktifkan GPS HP",
                "Layanan lokasi/GPS di HP Anda sedang mati. Harap aktifkan GPS agar robot dapat membaca arah rute dan kecepatan kendaraan.",
                "IZINKAN",
                () -> {
                    try {
                        isWaitingGpsSettings = true;
                        isWaitingNavPermissions = false;
                        Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Buka Pengaturan > Lokasi secara manual", Toast.LENGTH_LONG).show();
                    }
                },
                this::cancelNavAndReturnToRobot
            );
            return;
        }

        // Semua izin aktif & GPS menyala!
        isWaitingNavPermissions = false;
        isWaitingGpsSettings = false;
        isNavFeatureActive = true;

        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onNavPermissionsGranted) window.onNavPermissionsGranted();", null);
                if (pendingShareText != null) {
                    webView.evaluateJavascript("if (window.handleIncomingMapsShare) window.handleIncomingMapsShare('" + escapeJs(pendingShareText) + "');", null);
                    pendingShareText = null;
                }
            }
        });
    }

    private void cancelNavAndReturnToRobot() {
        isWaitingNavPermissions = false;
        isWaitingGpsSettings = false;
        isNavFeatureActive = false;
        pendingShareText = null;
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.closeRobotFeatureDetail) window.closeRobotFeatureDetail();", null);
            }
        });
    }

    private static String escapeJs(String text) {
        if (text == null) return "";
        return text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", "");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        isWaitingNativePermission = false;

        boolean allGranted = grantResults.length > 0;
        for (int res : grantResults) {
            if (res != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (requestCode == REQ_NEARBY) {
            if (allGranted) {
                hasDeniedNearby = false;
                checkPermissionsAndProceed();
            } else {
                hasDeniedNearby = true;
                showPermissionPopup(
                    "Izin Perangkat di Sekitar",
                    "Aplikasi memerlukan izin perangkat di sekitar untuk mendeteksi dan menghubungkan Robot Desk.",
                    this::reRequestNearbyPermissions
                );
            }
        } else if (requestCode == REQ_LOCATION) {
            if (allGranted) {
                hasDeniedLocation = false;
                checkPermissionsAndProceed();
            } else {
                hasDeniedLocation = true;
                showPermissionPopup(
                    "Izin Lokasi",
                    "Aplikasi memerlukan izin lokasi untuk memindai sinyal Robot Desk di sekitar Anda.",
                    this::reRequestLocationPermissions
                );
            }
        } else if (requestCode == REQ_NAV_LOCATION) {
            if (allGranted) {
                checkAndOpenNavigationFeature();
            } else {
                cancelNavAndReturnToRobot();
            }
        }
    }

    private void reRequestNearbyPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean rationaleScan = ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.BLUETOOTH_SCAN);
            boolean rationaleConnect = ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.BLUETOOTH_CONNECT);

            if (rationaleScan || rationaleConnect) {
                isWaitingNativePermission = true;
                ActivityCompat.requestPermissions(MainActivity.this,
                        new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT},
                        REQ_NEARBY);
            } else {
                // Jika Android menolak memunculkan dialog native (karena ditolak berulang / diblokir sistem), buka Pengaturan Aplikasi
                openAppSettings("Harap aktifkan izin 'Perangkat di sekitar'");
            }
        }
    }

    private void reRequestLocationPermissions() {
        boolean rationale = ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION);
        if (rationale) {
            isWaitingNativePermission = true;
            ActivityCompat.requestPermissions(MainActivity.this,
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                    REQ_LOCATION);
        } else {
            // Jika Android menolak memunculkan dialog native (karena ditolak berulang / diblokir sistem), buka Pengaturan Aplikasi
            openAppSettings("Harap aktifkan izin 'Lokasi' pada aplikasi");
        }
    }

    private void openAppSettings(String message) {
        try {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getPackageName(), null);
            intent.setData(uri);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Buka Pengaturan -> Aplikasi -> Robot Desk -> Izin", Toast.LENGTH_LONG).show();
        }
    }


    public class WebAppInterface {
        @JavascriptInterface
        public boolean isBluetoothEnabled() {
            return bleManager.isBluetoothEnabled();
        }

        @JavascriptInterface
        public void enableBluetooth() {
            runOnUiThread(() -> {
                try {
                    Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                    startActivity(enableBtIntent);
                } catch (Exception e) {
                    try {
                        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                        if (adapter != null) adapter.enable();
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "Gagal mengaktifkan Bluetooth", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void startScan() {
            runOnUiThread(() -> {
                bleManager.startScan();
            });
        }

        @JavascriptInterface
        public void connect() {
            runOnUiThread(() -> {
                bleManager.connectToDiscoveredDevice();
            });
        }

        @JavascriptInterface
        public void disconnect() {
            runOnUiThread(() -> bleManager.disconnect());
        }

        @JavascriptInterface
        public String send(String jsonCommand) {
            return bleManager.sendCommand(jsonCommand);
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            if (vibrator != null && vibrator.hasVibrator()) {
                vibrator.vibrate(durationMs);
            }
        }

        @JavascriptInterface
        public boolean isScanning() {
            return bleManager != null && bleManager.isScanning();
        }

        @JavascriptInterface
        public boolean hasSavedDevice() {
            return bleManager != null && bleManager.hasSavedDevice();
        }

        @JavascriptInterface
        public String getSavedDeviceName() {
            return bleManager != null ? bleManager.getSavedDeviceName() : "Robot Desk";
        }

        @JavascriptInterface
        public String getSavedDeviceAddress() {
            return bleManager != null ? bleManager.getSavedDeviceAddress() : "";
        }

        @JavascriptInterface
        public void forgetDevice() {
            runOnUiThread(() -> {
                if (bleManager != null) {
                    bleManager.forgetDevice();
                    if (webView != null) {
                        webView.evaluateJavascript("if (window.onDeviceForgotten) window.onDeviceForgotten();", null);
                    }
                }
            });
        }

        @JavascriptInterface
        public void reconnect() {
            runOnUiThread(() -> {
                if (bleManager != null) {
                    if (bleManager.hasSavedDevice()) {
                        bleManager.connectToSavedDevice();
                    } else {
                        bleManager.startScan();
                    }
                }
            });
        }

        @JavascriptInterface
        public String httpGet(String urlString) {
            java.net.HttpURLConnection conn = null;
            try {
                java.net.URL url = new java.net.URL(urlString);
                conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("User-Agent", "RobotDeskApp/1.0");
                int responseCode = conn.getResponseCode();
                if (responseCode >= 200 && responseCode < 300) {
                    java.io.InputStream is = conn.getInputStream();
                    java.io.InputStreamReader reader = new java.io.InputStreamReader(is, java.nio.charset.StandardCharsets.UTF_8);
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
                e.printStackTrace();
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
            return null;
        }


        @JavascriptInterface
        public void openSpotifyApp() {
            SpotifyMediaManager.openSpotify(MainActivity.this);
        }

        @JavascriptInterface
        public void mediaPlayPause() {
            SpotifyMediaManager.playPause(MainActivity.this);
        }

        @JavascriptInterface
        public void mediaNext() {
            SpotifyMediaManager.skipNext(MainActivity.this);
        }

        @JavascriptInterface
        public void mediaPrev() {
            SpotifyMediaManager.skipPrev(MainActivity.this);
        }

        @JavascriptInterface
        public void requestMusicSync() {
            SpotifyMediaManager.getInstance().dispatchState();
        }

        @JavascriptInterface
        public void requestOpenNavigation() {
            runOnUiThread(() -> checkAndOpenNavigationFeature());
        }

        @JavascriptInterface
        public void setNavFeatureActive(boolean active) {
            isNavFeatureActive = active;
            if (!active) {
                isWaitingNavPermissions = false;
                isWaitingGpsSettings = false;
            }
        }

        @JavascriptInterface
        public String getNativeLocation() {
            JSONObject res = new JSONObject();
            try {
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                if (lm != null && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    Location loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                    if (loc == null) {
                        loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                    }
                    if (loc == null) {
                        loc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                    }
                    if (loc != null) {
                        res.put("success", true);
                        res.put("lat", loc.getLatitude());
                        res.put("lng", loc.getLongitude());
                        res.put("speed", loc.hasSpeed() ? loc.getSpeed() * 3.6f : 0f);
                        return res.toString();
                    }
                }
                res.put("success", false);
                res.put("msg", "Menunggu sinyal GPS HP...");
            } catch (Exception e) {
                try {
                    res.put("success", false);
                    res.put("msg", e.getMessage());
                } catch (Exception ignored) {}
            }
            return res.toString();
        }

        @JavascriptInterface
        public void startGpsTracking() {
            runOnUiThread(() -> {
                try {
                    LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                    if (lm != null && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        if (gpsLocationListener == null) {
                            gpsLocationListener = new LocationListener() {
                                @Override
                                public void onLocationChanged(@NonNull Location location) {
                                    float speedKmh = location.hasSpeed() ? location.getSpeed() * 3.6f : 0f;
                                    runOnUiThread(() -> {
                                        if (webView != null) {
                                            webView.evaluateJavascript(
                                                String.format(java.util.Locale.US, "if (window.onNativeGpsUpdate) window.onNativeGpsUpdate(%.7f, %.7f, %.1f);",
                                                    location.getLatitude(), location.getLongitude(), speedKmh),
                                                null
                                            );
                                        }
                                    });
                                }
                                @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                                @Override public void onProviderEnabled(@NonNull String provider) {}
                                @Override public void onProviderDisabled(@NonNull String provider) {}
                            };
                        }
                        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1.0f, gpsLocationListener, Looper.getMainLooper());
                        }
                        if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 2.0f, gpsLocationListener, Looper.getMainLooper());
                        }
                    }
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "startGpsTracking error: " + e.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void stopGpsTracking() {
            runOnUiThread(() -> {
                try {
                    LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                    if (lm != null && gpsLocationListener != null) {
                        lm.removeUpdates(gpsLocationListener);
                    }
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "stopGpsTracking error: " + e.getMessage());
                }
            });
        }

        @JavascriptInterface
        public String resolveDestination(String rawInput) {
            JSONObject result = new JSONObject();
            if (rawInput == null || rawInput.trim().isEmpty()) {
                try {
                    result.put("success", false);
                    result.put("msg", "Teks tujuan kosong");
                } catch (Exception ignored) {}
                return result.toString();
            }

            String text = rawInput.trim();
            double destLat = Double.NaN;
            double destLng = Double.NaN;
            String destTitle = "Tujuan Google Maps";

            // 1. Ekstrak koordinat langsung jika ada angka pola: -6.2088, 106.8456 atau @-6.2088,106.8456
            java.util.regex.Pattern coordPattern = java.util.regex.Pattern.compile("@?(-?\\d+\\.\\d+)\\s*,\\s*(-?\\d+\\.\\d+)");
            java.util.regex.Matcher m = coordPattern.matcher(text);
            if (m.find()) {
                try {
                    destLat = Double.parseDouble(m.group(1));
                    destLng = Double.parseDouble(m.group(2));
                    destTitle = "Titik Koordinat";
                } catch (Exception ignored) {}
            }

            // 2. Ekstrak jika ada parameter q=, destination=, daddr=, center=
            java.util.regex.Pattern paramPattern = java.util.regex.Pattern.compile("(?:q|destination|daddr|center)=(-?\\d+\\.\\d+)(?:%2C|,)(-?\\d+\\.\\d+)");
            if (Double.isNaN(destLat)) {
                java.util.regex.Matcher pm = paramPattern.matcher(text);
                if (pm.find()) {
                    try {
                        destLat = Double.parseDouble(pm.group(1));
                        destLng = Double.parseDouble(pm.group(2));
                        destTitle = "Titik Peta";
                    } catch (Exception ignored) {}
                }
            }

            // 3. Jika teks berisi URL (misal: https://maps.app.goo.gl/xxx atau https://goo.gl/maps/xxx atau https://www.google.com/maps/...)
            java.util.regex.Pattern urlPattern = java.util.regex.Pattern.compile("https?://[^\\s]+");
            java.util.regex.Matcher um = urlPattern.matcher(text);
            String foundUrl = um.find() ? um.group(0) : null;

            if (foundUrl != null) {
                // Ekstrak nama tempat jika ada teks sebelum atau sesudah URL
                String cleanTitleCandidate = text.replace(foundUrl, "").replace("\n", " ").trim();
                if (cleanTitleCandidate.length() > 2) {
                    destTitle = cleanTitleCandidate.split(",")[0].trim();
                }

                // Jika koordinat belum ditemukan dari teks mentah, resolve URL Google Maps
                if (Double.isNaN(destLat)) {
                    String currentUrl = foundUrl;
                    String desktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
                    for (int hop = 0; hop < 5; hop++) {
                        java.net.HttpURLConnection conn = null;
                        try {
                            java.net.URL url = new java.net.URL(currentUrl);
                            conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setInstanceFollowRedirects(false);
                            conn.setConnectTimeout(7000);
                            conn.setReadTimeout(7000);
                            conn.setRequestProperty("User-Agent", desktopUserAgent);
                            conn.setRequestProperty("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");
                            conn.connect();

                            int code = conn.getResponseCode();
                            if (code >= 300 && code < 400) {
                                String redirect = conn.getHeaderField("Location");
                                if (redirect != null && !redirect.isEmpty()) {
                                    if (redirect.startsWith("http")) {
                                        currentUrl = redirect;
                                    } else if (redirect.startsWith("/")) {
                                        currentUrl = url.getProtocol() + "://" + url.getHost() + redirect;
                                    }
                                    java.util.regex.Matcher rm = coordPattern.matcher(currentUrl);
                                    if (rm.find()) {
                                        destLat = Double.parseDouble(rm.group(1));
                                        destLng = Double.parseDouble(rm.group(2));
                                        break;
                                    }
                                    java.util.regex.Matcher rpm = paramPattern.matcher(currentUrl);
                                    if (rpm.find()) {
                                        destLat = Double.parseDouble(rpm.group(1));
                                        destLng = Double.parseDouble(rpm.group(2));
                                        break;
                                    }
                                    continue;
                                }
                            }

                            if (code == 200) {
                                java.io.InputStream in = conn.getInputStream();
                                byte[] buf = new byte[16384];
                                int read = in.read(buf);
                                in.close();
                                if (read > 0) {
                                    String html = new String(buf, 0, read, java.nio.charset.StandardCharsets.UTF_8);
                                    java.util.regex.Matcher hm = paramPattern.matcher(html);
                                    if (hm.find()) {
                                        destLat = Double.parseDouble(hm.group(1));
                                        destLng = Double.parseDouble(hm.group(2));
                                        break;
                                    }
                                    java.util.regex.Pattern staticMapPattern = java.util.regex.Pattern.compile("/maps/api/staticmap\\?[^\"']*?center=(-?\\d+\\.\\d+)(?:%2C|,)(-?\\d+\\.\\d+)");
                                    java.util.regex.Matcher smm = staticMapPattern.matcher(html);
                                    if (smm.find()) {
                                        destLat = Double.parseDouble(smm.group(1));
                                        destLng = Double.parseDouble(smm.group(2));
                                        break;
                                    }
                                }
                            }
                            break;
                        } catch (Exception e) {
                            android.util.Log.w("MainActivity", "Resolve URL hop " + hop + " error: " + e.getMessage());
                            break;
                        } finally {
                            if (conn != null) conn.disconnect();
                        }
                    }
                }
            }

            // 4. Jika masih belum ditemukan koordinat, gunakan Geocoding OpenStreetMap (Nominatim)
            if (Double.isNaN(destLat)) {
                String searchQuery = text;
                if (foundUrl != null) {
                    searchQuery = text.replace(foundUrl, "").trim();
                }
                searchQuery = searchQuery.replace("\n", " ").replaceAll("[^a-zA-Z0-9\\s]", " ").trim();
                if (searchQuery.length() >= 2) {
                    try {
                        String geoUrl = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=" + java.net.URLEncoder.encode(searchQuery, "UTF-8");
                        java.net.URL url = new java.net.URL(geoUrl);
                        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(8000);
                        conn.setReadTimeout(8000);
                        conn.setRequestProperty("User-Agent", "RobotDeskApp/1.0 (contact: info@robotdesk.local)");
                        conn.connect();
                        if (conn.getResponseCode() == 200) {
                            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                            StringBuilder sb = new StringBuilder();
                            String line;
                            while ((line = reader.readLine()) != null) sb.append(line);
                            reader.close();

                            JSONArray arr = new JSONArray(sb.toString());
                            if (arr.length() > 0) {
                                JSONObject obj = arr.getJSONObject(0);
                                destLat = obj.getDouble("lat");
                                destLng = obj.getDouble("lon");
                                String dName = obj.optString("display_name", searchQuery);
                                destTitle = dName.split(",")[0].trim();
                            }
                        }
                        conn.disconnect();
                    } catch (Exception e) {
                        android.util.Log.w("MainActivity", "Nominatim geocoding error: " + e.getMessage());
                    }
                }
            }

            try {
                if (!Double.isNaN(destLat) && !Double.isNaN(destLng)) {
                    result.put("success", true);
                    result.put("lat", destLat);
                    result.put("lng", destLng);
                    result.put("title", destTitle);
                } else {
                    result.put("success", false);
                    result.put("msg", "Lokasi tidak ditemukan. Coba ketik nama tempat yang jelas.");
                }
            } catch (Exception ignored) {}

            return result.toString();
        }

        @JavascriptInterface
        public String fetchDrivingRoute(double startLat, double startLng, double destLat, double destLng) {
            try {
                String osrmUrl = String.format(java.util.Locale.US,
                    "https://router.project-osrm.org/route/v1/driving/%.7f,%.7f;%.7f,%.7f?overview=full&geometries=geojson&steps=true",
                    startLng, startLat, destLng, destLat);
                java.net.URL url = new java.net.URL(osrmUrl);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("User-Agent", "RobotDeskApp/1.0");
                conn.connect();
                if (conn.getResponseCode() == 200) {
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                    reader.close();
                    conn.disconnect();
                    return sb.toString();
                }
                conn.disconnect();
            } catch (Exception e) {
                android.util.Log.w("MainActivity", "OSRM fetch error: " + e.getMessage());
            }
            return "";
        }

        @JavascriptInterface
        public String getPendingShareText() {
            return pendingShareText != null ? pendingShareText : "";
        }

        @JavascriptInterface
        public void clearPendingShareText() {
            pendingShareText = null;
        }
    }

    @Override
    public void onDeviceDiscovered(String name, String address) {
        runOnUiThread(() -> {
            String safeName = (name != null ? name : "Robot Desk").replace("'", "\\'");
            String safeAddr = (address != null ? address : "").replace("'", "\\'");
            webView.evaluateJavascript("if (window.onDeviceDiscovered) window.onDeviceDiscovered('" + safeName + "', '" + safeAddr + "');", null);
        });
    }

    @Override
    public void onScanStarted() {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onScanStarted) window.onScanStarted();", null);
            }
        });
    }

    @Override
    public void onScanStopped() {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onScanStopped) window.onScanStopped();", null);
            }
        });
    }

    @Override
    public void onStatus(boolean connected, String statusMessage) {
        runOnUiThread(() -> {
            String safeMsg = statusMessage.replace("'", "\\'");
            webView.evaluateJavascript("if (window.onBLEStatus) window.onBLEStatus(" + connected + ", '" + safeMsg + "');", null);
        });
    }

    @Override
    public void onDataReceived(String json) {
        if (json != null && json.contains("\"media_ctrl\"")) {
            if (json.contains("\"play_pause\"")) {
                SpotifyMediaManager.playPause(this);
            } else if (json.contains("\"next\"")) {
                SpotifyMediaManager.skipNext(this);
            } else if (json.contains("\"prev\"")) {
                SpotifyMediaManager.skipPrev(this);
            }
        }
        runOnUiThread(() -> {
            String safeJson = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "").replace("\r", "");
            webView.evaluateJavascript("if (window.onBLEReceived) window.onBLEReceived('" + safeJson + "');", null);
        });
    }
    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){ if (typeof window.handleAndroidBack === 'function') { return window.handleAndroidBack(); } return false; })();",
                value -> {
                    if ("true".equals(value)) {
                        // Handled by JavaScript (kembali dari subpage detail fitur ke layar utama robot)
                        return;
                    }
                    runOnUiThread(() -> MainActivity.super.onBackPressed());
                }
            );
            return;
        }
        super.onBackPressed();
    }
    @Override
    protected void onDestroy() {
        super.onDestroy();
        backgroundTicker.removeCallbacks(backgroundTickRunnable);
        if (receiverRegistered) {
            try {
                unregisterReceiver(btStateReceiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        if (bleManager != null) {
            bleManager.setListener(null);
        }
        SpotifyLyricSyncEngine.getInstance().setSyncListener(null);
        // Layanan latar belakang RobotCompanionService dan koneksi BLE tetap dijaga aktif
        // agar sinkronisasi lirik ke robot tidak pernah terhenti saat aplikasi di-minimize atau layar mati!
    }
}
