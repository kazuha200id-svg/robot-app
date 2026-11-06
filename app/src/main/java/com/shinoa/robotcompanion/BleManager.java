package com.shinoa.robotcompanion;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@SuppressLint("MissingPermission")
public class BleManager {
    private static final String TAG = "BleManager";

    // Nordic UART Service (NUS)
    public static final UUID NUS_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    public static final UUID NUS_RX_UUID      = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    public static final UUID NUS_TX_UUID      = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    public static final UUID CCCD_UUID        = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    public interface BleListener {
        void onStatus(boolean connected, String statusMessage);
        void onDataReceived(String json);
        void onDeviceDiscovered(String name, String address);
        void onScanStarted();
        void onScanStopped();
    }

    private final Context context;
    private final BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic rxChar;
    private BluetoothGattCharacteristic txChar;
    private BleListener listener;

    private boolean isScanning = false;
    private boolean isConnected = false;
    private boolean isAutoConnectWhenFound = false;
    private BluetoothDevice discoveredDevice = null;
    private BluetoothDevice bondedCandidate = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final String PREF_NAME = "robot_companion_ble";
    private static final String KEY_SAVED_MAC = "saved_mac_address";
    private static final String KEY_SAVED_NAME = "saved_device_name";

    private static BleManager sInstance;

    public static synchronized BleManager getInstance(Context context) {
        if (sInstance == null) {
            sInstance = new BleManager(context.getApplicationContext());
        }
        return sInstance;
    }

    public BleManager(Context context) {
        this.context = context.getApplicationContext();
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        sInstance = this;
    }

    public void setListener(BleListener listener) {
        this.listener = listener;
    }

    public boolean isConnected() {
        return isConnected;
    }

    public boolean isBluetoothEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }

    public void saveDevice(BluetoothDevice device) {
        if (device != null && device.getAddress() != null) {
            String name = device.getName();
            if (name == null || name.trim().isEmpty()) name = "Robot Desk";
            context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_SAVED_MAC, device.getAddress())
                    .putString(KEY_SAVED_NAME, name)
                    .apply();
            Log.d(TAG, "Perangkat robot tersimpan permanen: " + device.getAddress() + " (" + name + ")");
        }
    }

    public String getSavedDeviceAddress() {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getString(KEY_SAVED_MAC, null);
    }

    public String getSavedDeviceName() {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getString(KEY_SAVED_NAME, "Robot Desk");
    }

    public boolean hasSavedDevice() {
        return getSavedDeviceAddress() != null;
    }

    public void forgetDevice() {
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_SAVED_MAC)
                .remove(KEY_SAVED_NAME)
                .apply();
        discoveredDevice = null;
        disconnect();
        notifyStatus(false, "Perangkat robot telah dilupakan");
    }

    public boolean connectToSavedDevice() {
        String savedMac = getSavedDeviceAddress();
        if (savedMac == null || bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            return false;
        }

        try {
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(savedMac);
            if (device != null) {
                discoveredDevice = device;
                stopScan();
                connectToDevice(device);
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "Gagal mendapatkan perangkat tersimpan: " + e.getMessage());
        }
        return false;
    }

    public void startScan() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            notifyStatus(false, "Bluetooth belum aktif!");
            return;
        }

        stopScan();
        discoveredDevice = null;
        bondedCandidate = null;

        // 1. Cek apakah ada perangkat yang pernah dipasangkan (paired/bonded) di HP sebagai deteksi instan
        try {
            if (bluetoothAdapter.getBondedDevices() != null) {
                for (BluetoothDevice bonded : bluetoothAdapter.getBondedDevices()) {
                    String bName = bonded.getName();
                    String bLower = (bName != null) ? bName.toLowerCase() : "";
                    if (bLower.contains("robot") || bLower.contains("desk") || bLower.contains("esp") || bLower.contains("c3")) {
                        bondedCandidate = bonded;
                        discoveredDevice = bonded;
                        notifyDeviceDiscovered("Robot Desk", bonded.getAddress());
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}

        // 2. Pemindaian sinyal aktif BLE realtime dengan ScanFilter perangkat keras
        bleScanner = bluetoothAdapter.getBluetoothLeScanner();
        if (bleScanner == null) {
            if (discoveredDevice == null) {
                notifyStatus(false, "Scanner BLE tidak tersedia");
            }
            return;
        }

        notifyStatus(false, "Memindai Robot Desk...");
        isScanning = true;
        mainHandler.post(() -> {
            if (listener != null) {
                listener.onScanStarted();
            }
        });

        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setReportDelay(0)
                .build();

        mainHandler.postDelayed(() -> {
            if (isScanning) {
                stopScan();
                if (discoveredDevice == null && !isConnected) {
                    notifyStatus(false, "Robot Desk tidak ditemukan. Pastikan robot menyala!");
                }
            }
        }, 12000);

        List<ScanFilter> filters = new ArrayList<>();
        try {
            filters.add(new ScanFilter.Builder()
                    .setServiceUuid(new ParcelUuid(NUS_SERVICE_UUID))
                    .build());
        } catch (Exception ignored) {}
        try {
            filters.add(new ScanFilter.Builder()
                    .setDeviceName("Robot Desk")
                    .build());
        } catch (Exception ignored) {}

        try {
            bleScanner.startScan(filters, settings, scanCallback);
        } catch (Exception e) {
            try {
                bleScanner.startScan(null, settings, scanCallback);
            } catch (Exception ignored) {
                try {
                    bleScanner.startScan(scanCallback);
                } catch (Exception ignored2) {}
            }
        }
    }

    public boolean isScanning() {
        return isScanning;
    }

    public void startScanAndConnect() {
        if (hasSavedDevice()) {
            connectToSavedDevice();
        } else {
            startScan();
        }
    }

    public void connectToDiscoveredDevice() {
        stopScan();
        if (discoveredDevice != null) {
            mainHandler.postDelayed(() -> {
                connectToDevice(discoveredDevice);
            }, 200);
        } else if (hasSavedDevice()) {
            connectToSavedDevice();
        } else {
            isAutoConnectWhenFound = true;
            startScan();
        }
    }

    private void notifyDeviceDiscovered(String name, String address) {
        mainHandler.post(() -> {
            if (listener != null) {
                listener.onDeviceDiscovered(name, address);
            }
        });
    }

    private void stopScan() {
        boolean wasScanning = isScanning;
        if (isScanning && bleScanner != null) {
            try {
                bleScanner.stopScan(scanCallback);
            } catch (Exception ignored) {}
            isScanning = false;
        }
        if (wasScanning) {
            mainHandler.post(() -> {
                if (listener != null) {
                    listener.onScanStopped();
                }
            });
        }
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (!isScanning) return;
            BluetoothDevice device = result.getDevice();
            String name = null;
            if (result.getScanRecord() != null) {
                name = result.getScanRecord().getDeviceName();
            }
            if (name == null) {
                name = device.getName();
            }

            String lowerName = (name != null) ? name.toLowerCase() : "";
            boolean matchName = lowerName.contains("robot") || lowerName.contains("desk") || lowerName.contains("esp") || lowerName.contains("c3") || lowerName.contains("companion");
            boolean matchUuid = false;
            if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
                for (ParcelUuid pUuid : result.getScanRecord().getServiceUuids()) {
                    if (pUuid != null && pUuid.getUuid().toString().equalsIgnoreCase(NUS_SERVICE_UUID.toString())) {
                        matchUuid = true;
                        break;
                    }
                }
            }

            String savedAddr = getSavedDeviceAddress();
            boolean matchSaved = savedAddr != null && savedAddr.equalsIgnoreCase(device.getAddress());

            if (matchName || matchUuid || matchSaved) {
                stopScan();
                discoveredDevice = device;
                notifyDeviceDiscovered("Robot Desk", device.getAddress());
                if (isAutoConnectWhenFound) {
                    isAutoConnectWhenFound = false;
                    mainHandler.postDelayed(() -> connectToDevice(device), 200);
                }
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            isScanning = false;
            stopScan();
            if (discoveredDevice == null) {
                notifyStatus(false, "Pemindaian gagal (Kode: " + errorCode + ")");
            }
        }
    };

    private int connectAttempts = 0;

    private void connectToDevice(BluetoothDevice device) {
        if (device == null) {
            notifyStatus(false, "Perangkat tidak valid");
            return;
        }

        if (bluetoothGatt != null) {
            try {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            } catch (Exception ignored) {}
            bluetoothGatt = null;
        }

        notifyStatus(false, "Menghubungkan ke Robot Desk...");

        mainHandler.postDelayed(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
                } else {
                    bluetoothGatt = device.connectGatt(context, false, gattCallback);
                }
            } catch (Exception e) {
                notifyStatus(false, "Gagal memulai koneksi: " + e.getMessage());
            }
        }, 100);
    }

    public void disconnect() {
        stopScan();
        if (bluetoothGatt != null) {
            try {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            } catch (Exception ignored) {}
            bluetoothGatt = null;
        }
        rxChar = null;
        txChar = null;
        isConnected = false;
        connectAttempts = 0;
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            Log.d(TAG, "BLE onConnectionStateChange: status=" + status + ", newState=" + newState);

            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                connectAttempts = 0;
                mainHandler.postDelayed(() -> {
                    try {
                        if (gatt != null) {
                            gatt.discoverServices();
                        }
                    } catch (Exception ignored) {}
                }, 300);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                isConnected = false;
                rxChar = null;
                txChar = null;
                if (gatt != null) {
                    try {
                        gatt.close();
                    } catch (Exception ignored) {}
                }
                bluetoothGatt = null;

                // Auto-retry sekali jika status 133 atau kegagalan awal handshake
                if (status != BluetoothGatt.GATT_SUCCESS && connectAttempts < 1 && discoveredDevice != null) {
                    connectAttempts++;
                    Log.w(TAG, "Handshake BLE gagal (status " + status + "), mencoba ulang (" + connectAttempts + "/1)...");
                    mainHandler.postDelayed(() -> {
                        if (discoveredDevice != null && !isConnected) {
                            connectToDevice(discoveredDevice);
                        }
                    }, 400);
                    return;
                }

                connectAttempts = 0;
                notifyStatus(false, "Terputus dari Robot");
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            Log.d(TAG, "BLE MTU dinegosiasikan: " + mtu);
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                BluetoothGattService foundService = null;
                for (BluetoothGattService s : gatt.getServices()) {
                    if (s.getUuid().toString().equalsIgnoreCase(NUS_SERVICE_UUID.toString())) {
                        foundService = s;
                        break;
                    }
                }

                if (foundService != null) {
                    for (BluetoothGattCharacteristic c : foundService.getCharacteristics()) {
                        if (c.getUuid().toString().equalsIgnoreCase(NUS_RX_UUID.toString())) {
                            rxChar = c;
                        } else if (c.getUuid().toString().equalsIgnoreCase(NUS_TX_UUID.toString())) {
                            txChar = c;
                        }
                    }

                    if (rxChar != null) {
                        isConnected = true;
                        connectAttempts = 0;

                        // Simpan perangkat secara permanen agar pairing hanya 1 kali
                        try {
                            saveDevice(gatt.getDevice());
                        } catch (Exception ignored) {}

                        // Aktifkan notifikasi pada TX Characteristic
                        if (txChar != null) {
                            try {
                                gatt.setCharacteristicNotification(txChar, true);
                                BluetoothGattDescriptor desc = txChar.getDescriptor(CCCD_UUID);
                                if (desc != null) {
                                    desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                                    gatt.writeDescriptor(desc);
                                }
                            } catch (Exception ignored) {}
                        }

                        notifyStatus(true, "Tersambung ke Robot");

                        // Negosiasikan MTU setelah servis ditemukan
                        mainHandler.postDelayed(() -> {
                            try {
                                if (gatt != null) gatt.requestMtu(256);
                            } catch (Exception ignored) {}
                        }, 200);

                        // Minta status awal
                        mainHandler.postDelayed(() -> sendCommand("{\"c\":\"s\"}"), 500);
                    } else {
                        notifyStatus(false, "RX Karakteristik tidak ditemukan");
                    }
                } else {
                    notifyStatus(false, "Layanan robot tidak ditemukan");
                }
            } else {
                notifyStatus(false, "GATT error status: " + status);
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (NUS_TX_UUID.equals(characteristic.getUuid())) {
                byte[] data = characteristic.getValue();
                if (data != null && data.length > 0) {
                    String json = new String(data, StandardCharsets.UTF_8);
                    if (json.contains("\"media_ctrl\"")) {
                        if (json.contains("\"play_pause\"")) {
                            SpotifyMediaManager.playPause(context);
                        } else if (json.contains("\"next\"")) {
                            SpotifyMediaManager.skipNext(context);
                        } else if (json.contains("\"prev\"")) {
                            SpotifyMediaManager.skipPrev(context);
                        }
                    }
                    if (listener != null) {
                        mainHandler.post(() -> listener.onDataReceived(json));
                    }
                }
            }
        }
    };

    public String sendCommand(String jsonCommand) {
        if (!isConnected) return "ERR: Belum Tersambung";
        if (bluetoothGatt == null) return "ERR: GATT Null";
        if (rxChar == null) return "ERR: RX Char Null";

        try {
            byte[] bytes = jsonCommand.getBytes(StandardCharsets.UTF_8);
            int props = rxChar.getProperties();
            int preferredType = ((props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) ?
                    BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
            int alternativeType = (preferredType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) ?
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;

            boolean writeOk = false;
            int errCode = -1;

            // 1. Coba API 33+ (Android 13/14)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                int res = bluetoothGatt.writeCharacteristic(rxChar, bytes, preferredType);
                if (res == android.bluetooth.BluetoothStatusCodes.SUCCESS) {
                    writeOk = true;
                } else {
                    errCode = res;
                    int res2 = bluetoothGatt.writeCharacteristic(rxChar, bytes, alternativeType);
                    if (res2 == android.bluetooth.BluetoothStatusCodes.SUCCESS) {
                        writeOk = true;
                    } else {
                        errCode = res2;
                    }
                }
            }

            // 2. Fallback metode setValue untuk Android 12 ke bawah atau jika API 33 gagal
            if (!writeOk) {
                rxChar.setWriteType(preferredType);
                rxChar.setValue(bytes);
                writeOk = bluetoothGatt.writeCharacteristic(rxChar);
                if (!writeOk) {
                    rxChar.setWriteType(alternativeType);
                    writeOk = bluetoothGatt.writeCharacteristic(rxChar);
                }
            }

            if (writeOk) {
                Log.d(TAG, "sendCommand sukses: " + jsonCommand);
                return "OK";
            } else {
                Log.e(TAG, "sendCommand gagal: kode " + errCode);
                return "ERR: Gagal Kirim (" + (errCode >= 0 ? errCode : "WriteFalse") + ")";
            }
        } catch (Exception e) {
            Log.e(TAG, "sendCommand exception: " + e.getMessage());
            return "ERR: " + e.getClass().getSimpleName();
        }
    }

    private void notifyStatus(boolean connected, String message) {
        if (listener != null) {
            mainHandler.post(() -> listener.onStatus(connected, message));
        }
    }
}
