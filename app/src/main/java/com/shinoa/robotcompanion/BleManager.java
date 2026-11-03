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
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public BleManager(Context context) {
        this.context = context.getApplicationContext();
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
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

    public void startScanAndConnect() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            notifyStatus(false, "Bluetooth HP belum aktif!");
            return;
        }

        disconnect();

        // 1. Periksa apakah sudah ter-pairing di pengaturan Bluetooth HP
        try {
            if (bluetoothAdapter.getBondedDevices() != null) {
                for (BluetoothDevice bonded : bluetoothAdapter.getBondedDevices()) {
                    String bName = bonded.getName();
                    if (bName != null && (bName.contains("Robot") || bName.contains("ESP32") || bName.contains("Desk"))) {
                        notifyStatus(false, "Menghubungkan ke " + bName + " (Paired)...");
                        connectToDevice(bonded);
                        return;
                    }
                }
            }
        } catch (Exception ignored) {}

        // 2. Pemindaian BLE tanpa filter perangkat keras yang kaku
        bleScanner = bluetoothAdapter.getBluetoothLeScanner();
        if (bleScanner == null) {
            notifyStatus(false, "Scanner BLE tidak tersedia");
            return;
        }

        notifyStatus(false, "Memindai Robot ESP32...");
        isScanning = true;

        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();

        mainHandler.postDelayed(() -> {
            if (isScanning) {
                stopScan();
                if (!isConnected) {
                    notifyStatus(false, "Robot tidak ditemukan. Pastikan robot menyala!");
                }
            }
        }, 12000);

        try {
            // Scan tanpa filter agar kompatibel dengan seluruh merk HP Android
            bleScanner.startScan(null, settings, scanCallback);
        } catch (Exception e) {
            try {
                bleScanner.startScan(scanCallback);
            } catch (Exception ignored) {}
        }
    }

    private void stopScan() {
        if (isScanning && bleScanner != null) {
            try {
                bleScanner.stopScan(scanCallback);
            } catch (Exception ignored) {}
            isScanning = false;
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

            boolean matchName = (name != null && (name.contains("Robot") || name.contains("ESP32") || name.contains("Desk")));
            boolean matchUuid = false;
            if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
                for (ParcelUuid pUuid : result.getScanRecord().getServiceUuids()) {
                    if (pUuid != null && pUuid.getUuid().equals(NUS_SERVICE_UUID)) {
                        matchUuid = true;
                        break;
                    }
                }
            }

            if (matchName || matchUuid) {
                stopScan();
                notifyStatus(false, "Menghubungkan ke " + (name != null ? name : "ESP32 C3 Robot") + "...");
                connectToDevice(device);
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            isScanning = false;
            notifyStatus(false, "Pemindaian gagal (Kode: " + errorCode + ")");
        }
    };

    private void connectToDevice(BluetoothDevice device) {
        bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
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
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                notifyStatus(false, "Terhubung, mencari layanan robot...");
                mainHandler.postDelayed(() -> {
                    try {
                        if (gatt != null) {
                            gatt.discoverServices();
                        }
                    } catch (Exception ignored) {}
                }, 350);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                isConnected = false;
                rxChar = null;
                txChar = null;
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
                // Cari service NUS secara case-insensitive
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
