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
        msgView.setTextColor(Color.parseColor("#00F0FF"));
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
        btnClose.setTextColor(Color.parseColor("#00F0FF"));
        btnClose.setTextSize(13);
        btnClose.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        GradientDrawable closeBg = new GradientDrawable();
        closeBg.setColor(Color.parseColor("#08182B"));
        closeBg.setCornerRadius(dp(8));
        closeBg.setStroke(dp(1.5f), Color.parseColor("#00F0FF"));
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
        btnAllow.setTextColor(Color.parseColor("#00F0FF"));
        btnAllow.setTextSize(13);
        btnAllow.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        GradientDrawable allowBg = new GradientDrawable();
        allowBg.setColor(Color.parseColor("#0E283E"));
        allowBg.setCornerRadius(dp(8));
        allowBg.setStroke(dp(1.5f), Color.parseColor("#00F0FF"));
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
        isNavFeatureActive = true;
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onNavPermissionsGranted) window.onNavPermissionsGranted();", null);
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
        public void openChronosApp() {
            runOnUiThread(() -> {
                try {
                    Intent intent = getPackageManager().getLaunchIntentForPackage("com.fbiego.chronos");
                    if (intent != null) {
                        startActivity(intent);
                    } else {
                        Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.fbiego.chronos"));
                        startActivity(market);
                    }
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "openChronosApp error: " + e.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void openGoogleMaps() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q="));
                    intent.setPackage("com.google.android.apps.maps");
                    if (intent.resolveActivity(getPackageManager()) != null) {
                        startActivity(intent);
                    } else {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.google.com")));
                    }
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "openGoogleMaps error: " + e.getMessage());
                }
            });
        }



        @JavascriptInterface
        public String resolveDestination(String rawInput) {
            return "{\"success\":false}";
        }


        @JavascriptInterface
        public String getPendingShareText() {
            return "";
        }

        @JavascriptInterface
        public void clearPendingShareText() {
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
