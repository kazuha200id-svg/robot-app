package com.shinoa.robotcompanion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
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

public class MainActivity extends AppCompatActivity implements BleManager.BleListener {
    private static final int REQ_NEARBY = 101;
    private static final int REQ_LOCATION = 102;

    private WebView webView;
    private BleManager bleManager;
    private Vibrator vibrator;
    private boolean receiverRegistered = false;
    private boolean hasInitialScanStarted = false;
    private boolean hasRequestedNearby = false;
    private boolean hasRequestedLocation = false;
    private Dialog activeDialog = null;

    private final BroadcastReceiver btStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                if (state == BluetoothAdapter.STATE_ON) {
                    runOnUiThread(() -> {
                        webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(true);", null);
                        if (!hasInitialScanStarted) {
                            hasInitialScanStarted = true;
                            if (bleManager != null) {
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
        bleManager = new BleManager(this);
        bleManager.setListener(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                checkPermissionsAndProceed();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setBackgroundColor(0xFF060B13);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBLE");

        webView.loadUrl("file:///android_asset/index.html");

        IntentFilter filter = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        registerReceiver(btStateReceiver, filter);
        receiverRegistered = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkPermissionsAndProceed();
    }

    private void checkPermissionsAndProceed() {
        if (isFinishing() || isDestroyed()) return;

        // 1. Cek Perizinan Perangkat di Sekitar (Android 12+ / API 31+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean hasScan = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
            boolean hasConnect = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;

            if (!hasScan || !hasConnect) {
                if (!hasRequestedNearby) {
                    hasRequestedNearby = true;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT},
                            REQ_NEARBY);
                } else {
                    showPermissionPopup(
                        "Izin Perangkat di Sekitar",
                        "Aplikasi memerlukan izin perangkat di sekitar untuk mendeteksi dan menghubungkan Robot Desk.",
                        () -> ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT},
                                REQ_NEARBY)
                    );
                }
                return;
            }
        }

        // 2. Cek Perizinan Lokasi
        boolean hasLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasLocation) {
            if (!hasRequestedLocation) {
                hasRequestedLocation = true;
                ActivityCompat.requestPermissions(MainActivity.this,
                        new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                        REQ_LOCATION);
            } else {
                showPermissionPopup(
                    "Izin Lokasi",
                    "Aplikasi memerlukan izin lokasi untuk memindai sinyal Robot Desk di sekitar Anda.",
                    () -> ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                            REQ_LOCATION)
                );
            }
            return;
        }

        // 3. Cek Apakah Layanan Lokasi (GPS) Aktif
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        boolean isGpsEnabled = false;
        try {
            isGpsEnabled = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (Exception ignored) {}

        if (!isGpsEnabled) {
            showPermissionPopup(
                "Aktifkan Lokasi",
                "Layanan lokasi (GPS) pada HP Anda belum aktif. Harap izinkan / aktifkan lokasi untuk memindai Robot Desk.",
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

        // Hanya jalankan pemindaian otomatis SATU KALI saat Bluetooth telah aktif
        if (isBtOn && !hasInitialScanStarted) {
            hasInitialScanStarted = true;
            runOnUiThread(() -> {
                if (bleManager != null) {
                    bleManager.startScan();
                }
            });
        }
    }

    private int dp(float val) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, val, getResources().getDisplayMetrics());
    }

    private void showPermissionPopup(String title, String message, Runnable onAllow) {
        if (isFinishing() || isDestroyed()) return;
        if (activeDialog != null && activeDialog.isShowing()) return;

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
            finishAffinity();
        });
        btnRow.addView(btnClose, closeParams);

        // Tombol IZINKAN (Sisi Kanan)
        Button btnAllow = new Button(this);
        btnAllow.setText("IZINKAN");
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

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        checkPermissionsAndProceed();
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
        public boolean isConnected() {
            return bleManager.isConnected();
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
        runOnUiThread(() -> {
            String safeJson = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "").replace("\r", "");
            webView.evaluateJavascript("if (window.onBLEReceived) window.onBLEReceived('" + safeJson + "');", null);
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (receiverRegistered) {
            try {
                unregisterReceiver(btStateReceiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        if (bleManager != null) {
            bleManager.disconnect();
        }
    }
}
