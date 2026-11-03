package com.shinoa.robotcompanion;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity implements BleManager.BleListener {
    private static final int PERMISSION_REQ_CODE = 101;

    private WebView webView;
    private BleManager bleManager;
    private Vibrator vibrator;
    private boolean receiverRegistered = false;

    private final BroadcastReceiver btStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                if (state == BluetoothAdapter.STATE_ON) {
                    runOnUiThread(() -> {
                        webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(true);", null);
                        checkAndRequestPermissions();
                        bleManager.startScan();
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
                boolean btEnabled = bleManager.isBluetoothEnabled();
                webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(" + btEnabled + ");", null);
                if (btEnabled) {
                    bleManager.startScan();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setBackgroundColor(0xFF060B13);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBLE");

        webView.loadUrl("file:///android_asset/index.html");

        checkAndRequestPermissions();

        IntentFilter filter = new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED);
        registerReceiver(btStateReceiver, filter);
        receiverRegistered = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bleManager != null && webView != null) {
            boolean btEnabled = bleManager.isBluetoothEnabled();
            webView.evaluateJavascript("if (window.onBluetoothPowerState) window.onBluetoothPowerState(" + btEnabled + ");", null);
            if (btEnabled && !bleManager.isConnected()) {
                bleManager.startScan();
            }
        }
    }

    private void checkAndRequestPermissions() {
        List<String> neededPermissions = new ArrayList<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
        }

        if (!neededPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(this, neededPermissions.toArray(new String[0]), PERMISSION_REQ_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted && bleManager.isBluetoothEnabled()) {
                bleManager.startScan();
            } else if (!allGranted) {
                Toast.makeText(this, "Izin Bluetooth diperlukan untuk menghubungkan robot", Toast.LENGTH_LONG).show();
            }
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
                    Toast.makeText(MainActivity.this, "Gagal mengaktifkan Bluetooth", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void startScan() {
            runOnUiThread(() -> {
                checkAndRequestPermissions();
                bleManager.startScan();
            });
        }

        @JavascriptInterface
        public void connect() {
            runOnUiThread(() -> {
                checkAndRequestPermissions();
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
