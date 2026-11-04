/* ========================================================
   ROBOT DESK APP CONTROLLER (STRICT BLUETOOTH GATE)
   ======================================================== */

let isBleConnected = false;
let currentFaceIndex = 0;
let currentRobotMode = 0; // 0 = MODE_ANIMATION
let currentOpenDetailFeature = null;
let faceAnimationTimer = null;
let currentMainTab = 'pageMenu';
let toastTimeout = null;

// Sinkronisasi Waktu Ultra-Akurat ESP32 (Presisi Mikrodetik)
let esp32TimeBaseMs = 0;
let localTimeAtSyncMs = 0;
let hasEsp32TimeSync = false;

// ================= 1. TOAST NOTIFICATION (SEMUA NOTIFIKASI DINONAKTIFKAN) =================
function showNeonToast(message) {
  // Seluruh notifikasi toast dinonaktifkan sesuai permintaan pengguna ("hilangkan semua notfikasi")
  return;
}

// HAPTIC FEEDBACK
function triggerHaptic(durationMs = 25) {
  if (window.AndroidBLE && typeof window.AndroidBLE.vibrate === 'function') {
    window.AndroidBLE.vibrate(durationMs);
  } else if ('vibrate' in navigator) {
    navigator.vibrate(durationMs);
  }
}

// ================= 2. 4-TAB NAVIGATION =================
function switchMainTab(pageId, btn) {
  if (!isBleConnected) {
    showNeonToast('Wajib Terhubung Robot');
    return;
  }

  currentMainTab = pageId;

  // Tutup detail fitur jika meninggalkan tab Robot
  if (pageId !== 'pageRobot') {
    closeRobotFeatureDetail();
  }

  // Toggle pages
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === pageId);
  });

  // Toggle nav buttons
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  if (btn) {
    btn.classList.add('active');
  }

  // Refresh previews & telemetry on robot tab
  if (pageId === 'pageRobot') {
    updateOledFacePreview(currentFaceIndex);
    updateOledClockTick();
    updateOledAlarmPreview();
    updateOledWeatherPreview();
    if (isBleConnected) {
      sendCommand({ c: 's' });
    }
  }

  triggerHaptic(15);
}



// ================= 3. BLE COMMAND DISPATCH (DENGAN ANTRIAN FIFO ANTI-COLLISION) =================
const bleCommandQueue = [];
let isBleTransmitting = false;

function processNextBleCommand() {
  if (bleCommandQueue.length === 0) {
    isBleTransmitting = false;
    return;
  }
  isBleTransmitting = true;
  const cmd = bleCommandQueue.shift();
  const jsonStr = JSON.stringify(cmd);
  if (window.AndroidBLE && typeof window.AndroidBLE.send === 'function') {
    try {
      window.AndroidBLE.send(jsonStr);
    } catch (e) {
      console.error('[BLE SEND ERR]', e);
    }
  } else {
    console.log('[MOCK BLE SEND]', jsonStr);
  }
  // Berikan jeda 75ms antar paket agar BLE GATT Android tidak menolak/drop write
  setTimeout(processNextBleCommand, 75);
}

function sendCommand(cmdObject, priority = false) {
  if (!cmdObject) return false;
  if (priority) {
    bleCommandQueue.unshift(cmdObject);
  } else {
    bleCommandQueue.push(cmdObject);
  }
  if (!isBleTransmitting) {
    processNextBleCommand();
  }
  return true;
}

// ================= 4. STRICT BLUETOOTH SETUP GATE HANDLERS =================
let isDeviceFound = false;
let isDeviceSelected = false;
let isConnecting = false;
let connectStartTime = 0;
let connectTimeoutId = null;
let isScanAnimating = true;
let isBleScanning = true;
let scanStartTime = Date.now();
let scanMinTimerId = null;
const MIN_SCAN_ANIMATION_MS = 2500; // Minimal durasi animasi pindai ulang 2.5 detik

function setManualScanButtonDisabled(disabled) {
  const btnScan = document.getElementById('btnManualScan');
  const scanSpinner = document.getElementById('scanCornerSpinner');
  if (btnScan) {
    btnScan.disabled = disabled;
    if (disabled) {
      btnScan.classList.add('scanning', 'disabled');
      btnScan.setAttribute('disabled', 'disabled');
    } else {
      btnScan.classList.remove('scanning', 'disabled');
      btnScan.removeAttribute('disabled');
    }
  }
  if (scanSpinner) {
    scanSpinner.style.display = disabled ? 'inline-block' : 'none';
  }
}

function toggleSelectDevice() {
  if (!isDeviceFound || isConnecting) return;
  isDeviceSelected = !isDeviceSelected;

  const itemBox = document.getElementById('deviceItemBox');
  if (itemBox) {
    if (isDeviceSelected) {
      itemBox.classList.add('selected');
    } else {
      itemBox.classList.remove('selected');
    }
  }

  updateConnectButtonState();
  triggerHaptic(25);
}

function updateConnectButtonState() {
  const btn = document.getElementById('btnConnectRobot');
  const label = document.getElementById('btnConnectLabel');
  const spinner = document.getElementById('btnConnectSpinner');
  if (!btn) return;

  if (isConnecting) {
    btn.disabled = true;
    btn.className = 'neon-btn-action full connect-action-btn btn-state-connecting';
    if (label) label.textContent = 'MENGHUBUNGKAN...';
    if (spinner) spinner.style.display = 'inline-block';
  } else if (isDeviceFound && isDeviceSelected) {
    btn.disabled = false;
    btn.className = 'neon-btn-action full connect-action-btn';
    if (label) label.textContent = 'HUBUNGKAN';
    if (spinner) spinner.style.display = 'none';
  } else {
    btn.disabled = true;
    btn.className = 'neon-btn-action full connect-action-btn disabled';
    if (label) label.textContent = 'HUBUNGKAN';
    if (spinner) spinner.style.display = 'none';
  }
}

function connectToFoundRobot() {
  if (!isDeviceFound || !isDeviceSelected) {
    showNeonToast('Pilih Robot Desk terlebih dahulu');
    return;
  }
  if (isConnecting) return;

  isConnecting = true;
  connectStartTime = Date.now();

  updateConnectButtonState();
  triggerHaptic(30);

  // Kirim perintah koneksi ke native Android
  if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
  } else {
    // Mock untuk browser testing
    setTimeout(() => {
      window.onBLEStatus(true, 'Tersambung (Mock)');
    }, 1200);
  }

  if (connectTimeoutId) clearTimeout(connectTimeoutId);
  connectTimeoutId = setTimeout(() => {
    if (isConnecting) {
      finalizeFailed();
    }
  }, 10000);
}

function finalizeSuccess() {
  if (!isConnecting) return;
  isConnecting = false;
  if (connectTimeoutId) {
    clearTimeout(connectTimeoutId);
    connectTimeoutId = null;
  }

  const btn = document.getElementById('btnConnectRobot');
  const label = document.getElementById('btnConnectLabel');
  const spinner = document.getElementById('btnConnectSpinner');
  const gate = document.getElementById('setupGate');

  if (btn) {
    btn.disabled = true;
    btn.className = 'neon-btn-action full connect-action-btn btn-state-success';
  }
  if (spinner) spinner.style.display = 'none';
  if (label) label.textContent = 'BERHASIL';

  triggerHaptic(40);
  showNeonToast('Robot Tersambung');

  setTimeout(() => {
    if (gate) gate.classList.remove('active');
    syncClockQuiet();
    setTimeout(() => sendCommand({ c: 's' }), 400);
  }, 700);
}

function finalizeFailed() {
  if (!isConnecting) return;
  isConnecting = false;
  if (connectTimeoutId) {
    clearTimeout(connectTimeoutId);
    connectTimeoutId = null;
  }

  const btn = document.getElementById('btnConnectRobot');
  const label = document.getElementById('btnConnectLabel');
  const spinner = document.getElementById('btnConnectSpinner');

  if (btn) {
    btn.disabled = true;
    btn.className = 'neon-btn-action full connect-action-btn btn-state-failed';
  }
  if (spinner) spinner.style.display = 'none';
  if (label) label.textContent = 'GAGAL TERHUBUNG';

  triggerHaptic(50);
  showNeonToast('Gagal Menghubungkan');

  // Kembalikan tombol ke keadaan HUBUNGKAN setelah 2.5 detik
  setTimeout(() => {
    updateConnectButtonState();
  }, 2500);
}

function requestEnableBluetooth() {
  if (window.AndroidBLE && typeof window.AndroidBLE.enableBluetooth === 'function') {
    window.AndroidBLE.enableBluetooth();
    showNeonToast('Mengaktifkan Bluetooth');
  } else {
    showNeonToast('Bluetooth Aktif (Mock)');
    window.onBluetoothPowerState(true);
  }
  triggerHaptic(30);
}

function retryAutoScan() {
  // Cegah tombol pindai ulang dipencet saat sedang mendeteksi robot
  if (isBleScanning || isScanAnimating) {
    showNeonToast('Sedang mendeteksi Robot Desk...');
    return;
  }
  if (window.AndroidBLE && typeof window.AndroidBLE.isScanning === 'function') {
    if (window.AndroidBLE.isScanning()) {
      showNeonToast('Sedang mendeteksi Robot Desk...');
      return;
    }
  }

  isBleScanning = true;
  isScanAnimating = true;
  scanStartTime = Date.now();
  if (scanMinTimerId) {
    clearTimeout(scanMinTimerId);
    scanMinTimerId = null;
  }

  isDeviceFound = false;
  isDeviceSelected = false;
  isConnecting = false;
  if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

  // Matikan dan kunci mutlak tombol PINDAI ULANG
  setManualScanButtonDisabled(true);

  const scanningBox = document.getElementById('deviceScanningBox');
  const itemBox = document.getElementById('deviceItemBox');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');

  if (scanningBox) scanningBox.style.display = 'flex';
  if (itemBox) {
    itemBox.style.display = 'none';
    itemBox.classList.remove('selected');
  }
  if (txtScan) txtScan.textContent = 'Mencari Robot Desk...';
  if (spinner) spinner.style.display = 'block';

  updateConnectButtonState();
  triggerHaptic(30);

  if (window.AndroidBLE && typeof window.AndroidBLE.startScan === 'function') {
    window.AndroidBLE.startScan();
    showNeonToast('Mencari Robot Desk');
  } else if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
    showNeonToast('Mencari Robot Desk');
  } else {
    showNeonToast('Mencari (Mock)');
    setTimeout(() => {
      window.onDeviceDiscovered('Robot Desk', 'Siap Terhubung');
    }, 2200);
  }
}

// CALLBACK: SCAN STARTED
window.onScanStarted = function() {
  isBleScanning = true;
  isScanAnimating = true;
  scanStartTime = Date.now();
  setManualScanButtonDisabled(true);
};

// CALLBACK: DISCOVERED DEVICE (Diberikan animasi minimal agar tidak langsung)
window.onDeviceDiscovered = function(name, address) {
  const elapsed = Date.now() - scanStartTime;
  const remaining = Math.max(0, MIN_SCAN_ANIMATION_MS - elapsed);

  if (scanMinTimerId) clearTimeout(scanMinTimerId);
  scanMinTimerId = setTimeout(() => {
    isDeviceFound = true;
    const scanningBox = document.getElementById('deviceScanningBox');
    const itemBox = document.getElementById('deviceItemBox');
    const nameEl = document.getElementById('detectedDevName');
    const subEl = document.getElementById('detectedDevSub');

    if (nameEl) nameEl.textContent = name || 'Robot Desk';
    if (subEl) subEl.textContent = address ? `Bluetooth (${address})` : 'Bluetooth Siap Terhubung';

    const isNativeStillScanning = window.AndroidBLE && typeof window.AndroidBLE.isScanning === 'function' && window.AndroidBLE.isScanning();
    if (!isNativeStillScanning) {
      isBleScanning = false;
      isScanAnimating = false;
      setManualScanButtonDisabled(false);
    }

    if (scanningBox) scanningBox.style.display = 'none';
    if (itemBox) {
      itemBox.style.display = 'flex';
    }

    updateConnectButtonState();
    triggerHaptic(30);
  }, remaining);
};

// CALLBACK: SCAN STOPPED (Diberikan animasi minimal agar tidak langsung)
window.onScanStopped = function() {
  const elapsed = Date.now() - scanStartTime;
  const remaining = Math.max(0, MIN_SCAN_ANIMATION_MS - elapsed);

  if (scanMinTimerId) clearTimeout(scanMinTimerId);
  scanMinTimerId = setTimeout(() => {
    isBleScanning = false;
    isScanAnimating = false;
    setManualScanButtonDisabled(false);
  }, remaining);
};

function hasSavedRobot() {
  if (window.AndroidBLE && typeof window.AndroidBLE.hasSavedDevice === 'function') {
    return window.AndroidBLE.hasSavedDevice();
  }
  return localStorage.getItem('robot_saved_mac') !== null;
}

function getSavedRobotName() {
  if (window.AndroidBLE && typeof window.AndroidBLE.getSavedDeviceName === 'function') {
    const n = window.AndroidBLE.getSavedDeviceName();
    if (n && n.trim().length > 0) return n;
  }
  return localStorage.getItem('robot_saved_name') || 'Robot Desk';
}

function forgetSavedRobot() {
  triggerHaptic(40);
  if (window.AndroidBLE && typeof window.AndroidBLE.forgetDevice === 'function') {
    window.AndroidBLE.forgetDevice();
  } else {
    localStorage.removeItem('robot_saved_mac');
    localStorage.removeItem('robot_saved_name');
    window.onDeviceForgotten();
  }
}

window.onDeviceForgotten = function() {
  localStorage.removeItem('robot_saved_mac');
  localStorage.removeItem('robot_saved_name');
  showNeonToast('Perangkat robot dilupakan');
  const isBtOn = (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') ? window.AndroidBLE.isBluetoothEnabled() : true;
  updateSetupGateView(isBtOn);
  retryAutoScan();
};

function manualReconnectSaved() {
  triggerHaptic(30);
  const name = getSavedRobotName();
  showNeonToast('Menghubungkan ke ' + name);
  const txtSaved = document.getElementById('txtSavedDevState');
  const spinner = document.getElementById('savedDevSpinner');
  const btnReconnect = document.getElementById('btnManualReconnect');
  if (txtSaved) txtSaved.textContent = 'Menyambungkan kembali...';
  if (spinner) spinner.style.display = 'block';
  if (btnReconnect) btnReconnect.style.display = 'none';

  if (window.AndroidBLE && typeof window.AndroidBLE.reconnect === 'function') {
    window.AndroidBLE.reconnect();
  } else if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
  }
}

function updateSetupGateView(btEnabled) {
  const boxBt = document.getElementById('boxBtPower');
  const boxSaved = document.getElementById('boxSavedDevice');
  const boxDetected = document.getElementById('boxDetectedDevices');
  const radarWrap = document.querySelector('.setup-radar-wrap');
  const hasSaved = hasSavedRobot();

  if (!btEnabled) {
    if (boxBt) boxBt.style.display = 'flex';
    if (boxSaved) boxSaved.style.display = 'none';
    if (boxDetected) boxDetected.style.display = 'none';
    if (radarWrap) radarWrap.style.display = 'none';
  } else {
    if (boxBt) boxBt.style.display = 'none';
    if (hasSaved) {
      if (boxSaved) boxSaved.style.display = 'flex';
      if (boxDetected) boxDetected.style.display = 'none';
      if (radarWrap) radarWrap.style.display = 'none';

      const txtName = document.getElementById('txtSavedDevName');
      if (txtName) txtName.textContent = getSavedRobotName();

      const txtState = document.getElementById('txtSavedDevState');
      const spinner = document.getElementById('savedDevSpinner');
      const btnReconnect = document.getElementById('btnManualReconnect');
      if (isBleConnected) {
        if (txtState) txtState.textContent = 'Tersambung';
        if (spinner) spinner.style.display = 'none';
        if (btnReconnect) btnReconnect.style.display = 'none';
      } else {
        if (txtState) txtState.textContent = 'Menyambungkan ke robot...';
        if (spinner) spinner.style.display = 'block';
        if (btnReconnect) btnReconnect.style.display = 'none';
      }
    } else {
      if (boxSaved) boxSaved.style.display = 'none';
      if (boxDetected) boxDetected.style.display = 'flex';
      if (radarWrap) radarWrap.style.display = 'flex';
    }
  }
}

// BLUETOOTH POWER STATE CALLBACK FROM NATIVE ANDROID
window.onBluetoothPowerState = function(enabled) {
  const txtBt = document.getElementById('txtBtPower');
  const btnEnable = document.getElementById('btnEnableBt');
  const boxBt = document.getElementById('boxBtPower');
  const gate = document.getElementById('setupGate');

  if (enabled) {
    if (txtBt) {
      txtBt.textContent = 'AKTIF';
      txtBt.className = 'status-card-state success';
    }
    if (btnEnable) btnEnable.style.display = 'none';
    if (boxBt) boxBt.classList.add('ready');

    updateSetupGateView(true);

    if (!isBleConnected) {
      if (hasSavedRobot()) {
        if (window.AndroidBLE && typeof window.AndroidBLE.reconnect === 'function') {
          window.AndroidBLE.reconnect();
        }
      } else {
        const txtScan = document.getElementById('txtScanState');
        const spinner = document.getElementById('scanSpinner');
        if (txtScan && !isDeviceFound) {
          txtScan.textContent = 'Mencari Robot Desk...';
          if (spinner) spinner.style.display = 'block';
        }
      }
    }
  } else {
    isDeviceFound = false;
    isDeviceSelected = false;
    isConnecting = false;
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

    if (txtBt) {
      txtBt.textContent = 'TIDAK AKTIF';
      txtBt.className = 'status-card-state warning';
    }
    if (btnEnable) btnEnable.style.display = 'block';
    if (boxBt) boxBt.classList.remove('ready');

    updateSetupGateView(false);

    if (gate) gate.classList.add('active');
  }
};

function disconnectBluetooth() {
  triggerHaptic(40);
  if (window.AndroidBLE && typeof window.AndroidBLE.disconnect === 'function') {
    window.AndroidBLE.disconnect();
  }
  showNeonToast('Memutuskan koneksi...');
}

// BLE CONNECTION STATUS CALLBACK FROM NATIVE ANDROID
window.onBLEStatus = function(connected, message) {
  isBleConnected = connected;
  const dot = document.getElementById('bleDot');
  const label = document.getElementById('bleStatusLabel');
  const gate = document.getElementById('setupGate');

  if (connected) {
    if (dot) dot.className = 'pulse-dot online';
    if (label) label.textContent = 'BLE TERHUBUNG';

    localStorage.setItem('robot_saved_mac', 'connected');
    localStorage.setItem('robot_saved_name', 'Robot Desk');

    // Sinkronkan detik jam HP ke robot seketika saat tersambung agar realtime tanpa jeda
    syncClockQuiet();

    if (isConnecting) {
      const elapsed = Date.now() - connectStartTime;
      const remaining = Math.max(0, 3000 - elapsed);
      setTimeout(() => {
        finalizeSuccess();
      }, remaining);
    } else {
      if (gate) gate.classList.remove('active');
    }
  } else {
    if (dot) dot.className = 'pulse-dot';
    if (label) label.textContent = 'BLE TERPUTUS';

    if (!isConnecting && gate) {
      gate.classList.add('active');
      const isBtOn = (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') ? window.AndroidBLE.isBluetoothEnabled() : true;
      updateSetupGateView(isBtOn);

      if (hasSavedRobot()) {
        const txtSaved = document.getElementById('txtSavedDevState');
        const spinner = document.getElementById('savedDevSpinner');
        const btnReconnect = document.getElementById('btnManualReconnect');
        if (txtSaved) txtSaved.textContent = 'Terputus dari Robot';
        if (spinner) spinner.style.display = 'none';
        if (btnReconnect) btnReconnect.style.display = 'block';
      }
    }

    const isFailure = message && (
      message.toLowerCase().includes('terputus') ||
      message.toLowerCase().includes('gagal') ||
      message.toLowerCase().includes('tidak ditemukan')
    );

    if (isConnecting && isFailure) {
      const elapsed = Date.now() - connectStartTime;
      const remaining = Math.max(0, 3000 - elapsed);
      setTimeout(() => {
        finalizeFailed();
      }, remaining);
    } else {
      const isNotFound = message && message.toLowerCase().includes('tidak ditemukan');
      const txtScan = document.getElementById('txtScanState');
      const spinner = document.getElementById('scanSpinner');

      if (isNotFound) {
        if (txtScan) txtScan.textContent = 'Robot Desk Tidak Ditemukan';
        if (spinner) spinner.style.display = 'none';
        window.onScanStopped();
      } else if (message) {
        if (txtScan) txtScan.textContent = message;
      }
      updateConnectButtonState();
    }
  }
};

window.onBLEReceived = function(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    
    // Telemetry updates
    if (typeof data.epoch === 'number' && data.epoch > 100000000) {
      const espTotalMs = (data.epoch * 1000) + Math.floor((data.us || 0) / 1000);
      esp32TimeBaseMs = espTotalMs + 25; // Kompensasi perkiraan latensi BLE receive
      localTimeAtSyncMs = Date.now();
      hasEsp32TimeSync = true;
    }
    if (typeof data.mode === 'number') {
      currentRobotMode = data.mode;
      // Jika mode adalah 4 (MODE_GAME_MENU), robot berada di menu game (atau kembali setelah game over)
      if (data.mode === 4) {
        if (typeof isGameActivelyPlaying !== 'undefined' && isGameActivelyPlaying) {
          isGameActivelyPlaying = false;
          if (typeof renderOledGameMenu === 'function') renderOledGameMenu();
          if (typeof render10GamesGrid === 'function') render10GamesGrid();
        }
      } else if (data.mode >= 5 && data.mode <= 16 && data.mode !== 7 && data.mode !== 8) {
        if (typeof GAMES_LIST !== 'undefined') {
          const matchedIdx = GAMES_LIST.findIndex(g => g.mode === data.mode);
          if (matchedIdx >= 0) g_selectedGameIdx = matchedIdx;
        }
        if (typeof renderOledGameMenu === 'function') renderOledGameMenu();
        if (typeof render10GamesGrid === 'function') render10GamesGrid();
      }
    }
    if (typeof data.face === 'number') {
      currentFaceIndex = data.face;
      updateOledFacePreview(data.face);
    }
    if (data.mode_name) {
      const modeEl = document.getElementById('teleActiveMode');
      if (modeEl) modeEl.textContent = data.mode_name;
    }
    if (typeof data.asleep === 'boolean') {
      const sleepEl = document.getElementById('teleSleepState');
      if (sleepEl) sleepEl.textContent = data.asleep ? 'Robot Tidur' : 'Robot Aktif (Bangun)';
    }

    // Alarm config sync
    if (data.alarm) {
      if (typeof data.alarm.hour === 'number') {
        g_alarmHour = data.alarm.hour;
        const hEl = document.getElementById('alarmHour');
        if (hEl) hEl.value = String(data.alarm.hour).padStart(2, '0');
      }
      if (typeof data.alarm.min === 'number') {
        g_alarmMin = data.alarm.min;
        const mEl = document.getElementById('alarmMin');
        if (mEl) mEl.value = String(data.alarm.min).padStart(2, '0');
      }
      if (typeof data.alarm.enabled === 'boolean') {
        g_alarmEnabled = data.alarm.enabled;
        const enEl = document.getElementById('alarmEnabledToggle');
        if (enEl) enEl.checked = data.alarm.enabled;
      }
      if (typeof data.alarm.daily === 'boolean') {
        g_alarmDaily = data.alarm.daily;
        const dEl = document.getElementById('alarmDailyToggle');
        if (dEl) dEl.checked = data.alarm.daily;
      }
      updateOledAlarmPreview();
    }
  } catch (e) {
    console.error('Failed to parse incoming BLE JSON', e);
  }
};

// ================= 5. FEATURE ACTION HANDLERS =================

// Definisi 13 Grafis & Mood Wajah OLED Robot
const OLED_FACES = [
  { name: 'SENANG', svg: '<rect x="15" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="3"></rect><rect x="57" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="3"></rect>' },
  { name: 'KEDIP', svg: '<rect x="15" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="3"></rect><line x1="57" y1="25" x2="85" y2="25" stroke="#00F0FF" stroke-width="4" stroke-linecap="round"></line>' },
  { name: 'NGANTUK', svg: '<path d="M15 28 Q29 38 43 28" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><path d="M57 28 Q71 38 85 28" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><text x="75" y="15" fill="#00F0FF" font-size="11" font-weight="bold">Z</text>' },
  { name: 'SEDIH', svg: '<path d="M15 25 Q29 15 43 25" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><path d="M57 25 Q71 15 85 25" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><path d="M29 32 Q25 40 29 45 Q33 40 29 32" fill="#00F0FF"></path><path d="M71 32 Q67 40 71 45 Q75 40 71 32" fill="#00F0FF"></path>' },
  { name: 'CEMBURU', svg: '<line x1="15" y1="20" x2="43" y2="28" stroke="#00F0FF" stroke-width="3.5"></line><line x1="85" y1="20" x2="57" y2="28" stroke="#00F0FF" stroke-width="3.5"></line>' },
  { name: 'IMUT', svg: '<path d="M15 30 Q29 12 43 30" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><path d="M57 30 Q71 12 85 30" fill="none" stroke="#00F0FF" stroke-width="3.5"></path>' },
  { name: 'CIUM', svg: '<line x1="15" y1="25" x2="43" y2="25" stroke="#00F0FF" stroke-width="3.5"></line><path d="M57 30 Q71 14 85 30" fill="none" stroke="#00F0FF" stroke-width="3.5"></path><path d="M48 36 Q52 32 48 28" fill="none" stroke="#00F0FF" stroke-width="2.5"></path>' },
  { name: 'CINTA', svg: '<path d="M29 18 A 6 6 0 0 0 20 22 Q 29 36 29 36 Q 29 36 38 22 A 6 6 0 0 0 29 18" fill="none" stroke="#00F0FF" stroke-width="2.5"></path><path d="M71 18 A 6 6 0 0 0 62 22 Q 71 36 71 36 Q 71 36 80 22 A 6 6 0 0 0 71 18" fill="none" stroke="#00F0FF" stroke-width="2.5"></path>' },
  { name: 'BINTANG', svg: '<rect x="15" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect><rect x="57" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect><polygon points="29,18 31,23 36,25 31,27 29,32 27,27 22,25 27,23" fill="#00F0FF"></polygon><polygon points="71,18 73,23 78,25 73,27 71,32 69,27 64,25 69,23" fill="#00F0FF"></polygon>' },
  { name: 'PUSING', svg: '<line x1="20" y1="15" x2="38" y2="35" stroke="#00F0FF" stroke-width="3.5"></line><line x1="38" y1="15" x2="20" y2="35" stroke="#00F0FF" stroke-width="3.5"></line><line x1="62" y1="15" x2="80" y2="35" stroke="#00F0FF" stroke-width="3.5"></line><line x1="80" y1="15" x2="62" y2="35" stroke="#00F0FF" stroke-width="3.5"></line>' },
  { name: 'MARAH', svg: '<line x1="14" y1="14" x2="43" y2="24" stroke="#00F0FF" stroke-width="4"></line><line x1="86" y1="14" x2="57" y2="24" stroke="#00F0FF" stroke-width="4"></line><rect x="18" y="26" width="22" height="14" rx="4" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect><rect x="60" y="26" width="22" height="14" rx="4" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect>' },
  { name: 'MELIRIK', svg: '<rect x="15" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect><rect x="57" y="10" width="28" height="30" rx="8" fill="none" stroke="#00F0FF" stroke-width="2.5"></rect><rect x="17" y="16" width="12" height="18" rx="4" fill="#00F0FF"></rect><rect x="59" y="16" width="12" height="18" rx="4" fill="#00F0FF"></rect>' },
  { name: 'HATI', svg: '<path d="M29 14 A 8 8 0 0 0 17 22 Q 29 40 29 40 Q 29 40 41 22 A 8 8 0 0 0 29 14" fill="#00F0FF"></path><path d="M71 14 A 8 8 0 0 0 59 22 Q 71 40 71 40 Q 71 40 83 22 A 8 8 0 0 0 71 14" fill="#00F0FF"></path>' }
];

// UPDATE TAMPILAN WAJAH OLED DI DETAIL DAN OVERVIEW
function updateOledFacePreview(idx) {
  const item = OLED_FACES[idx] || OLED_FACES[0];
  const detailWrap = document.getElementById('detailFaceSvgWrap');
  const overviewWrap = document.getElementById('oledFaceSvgWrap');
  const moodLabel = document.getElementById('oledFaceMoodLabel');
  const detailMoodLabel = document.getElementById('detailFaceMoodLabel');

  if (detailWrap) {
    detailWrap.innerHTML = `<svg viewBox="0 0 100 50" class="oled-face-svg">${item.svg}</svg>`;
  }
  if (overviewWrap) {
    overviewWrap.innerHTML = `<svg viewBox="0 0 100 50" class="oled-face-svg">${item.svg}</svg>`;
  }
  if (moodLabel) {
    moodLabel.textContent = `MOOD: ${item.name}`;
  }
  if (detailMoodLabel) {
    detailMoodLabel.textContent = `MOOD: ${item.name}`;
  }
}

// RENDER 13 KARTU EXPRESI WAJAH OLED DI HALAMAN DETAIL FITUR
function renderDetailFacesGrid() {
  const container = document.getElementById('detailFacesGrid');
  if (!container) return;
  container.innerHTML = '';
  OLED_FACES.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'face-card';
    card.onclick = () => selectFaceFromDetail(index, card);
    card.innerHTML = `
      <div class="eye-preview">
        <svg viewBox="0 0 100 50" class="oled-face-svg">${item.svg}</svg>
      </div>
      <span>${index + 1}. ${item.name}</span>
    `;
    container.appendChild(card);
  });
}

// PILIH EXPRESI WAJAH OLED (DURASI 3 DETIK, HANYA BISA DI FITUR/MODE ANIMASI)
function selectFaceFromDetail(index, elem) {
  // Pergantian animasi cuma bisa di fitur animasi saja (jangan ke-input jika mode jam, alarm, dll)
  if (currentRobotMode !== 0 && currentOpenDetailFeature !== 'face') {
    return;
  }

  if (faceAnimationTimer) {
    clearTimeout(faceAnimationTimer);
    faceAnimationTimer = null;
  }

  currentFaceIndex = index;
  currentRobotMode = 0;

  // Update preview OLED wajah di aplikasi seketika
  updateOledFacePreview(index);

  // Kirim perintah pergantian ekspresi wajah ke robot fisik ESP32
  sendCommand({ c: 'f', v: index });

  triggerHaptic(25);

  // Durasi animasi tepat 3 detik, lalu otomatis kembali ke netral (0: SENANG) sesuai firmware robot fisik
  if (index !== 0) {
    faceAnimationTimer = setTimeout(() => {
      currentFaceIndex = 0;
      updateOledFacePreview(0);
      sendCommand({ c: 'f', v: 0 }); // Kembalikan ke netral di robot fisik
    }, 3000);
  }
}

// BUKA TAMPILAN DETAIL FITUR ROBOT (HALAMAN BARU - LAYAR OLED 100% PERSIS FISIK)
function openRobotFeatureDetail(featureKey) {
  triggerHaptic(25);
  currentOpenDetailFeature = featureKey;

  const overview = document.getElementById('robotMainOverview');
  const detailView = document.getElementById('robotFeatureDetailView');

  if (overview) overview.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Sembunyikan semua sub-panel detail
  document.querySelectorAll('.detail-feature-panel').forEach(p => p.style.display = 'none');

  if (featureKey === 'face') {
    const panel = document.getElementById('detailViewFace');
    if (panel) panel.style.display = 'block';
    renderDetailFacesGrid();
    updateOledFacePreview(currentFaceIndex || 0);
    currentRobotMode = 0;
    sendCommand({ c: 'm', v: 0 });
  } else if (featureKey === 'clock') {
    const panel = document.getElementById('detailViewClock');
    if (panel) panel.style.display = 'block';
    updateOledClockTick();
    syncClockQuiet(); // Sinkronkan detik jam HP ke robot seketika
    currentRobotMode = 1;
    sendCommand({ c: 'm', v: 1 });
  } else if (featureKey === 'alarm') {
    const panel = document.getElementById('detailViewAlarm');
    if (panel) panel.style.display = 'block';
    renderAlarmOledAndControls();
    currentRobotMode = 8;
    sendCommand({ c: 'm', v: 8 });
  } else if (featureKey === 'stopwatch') {
    const panel = document.getElementById('detailViewStopwatch');
    if (panel) panel.style.display = 'block';
    updateStopwatchDisplay();
    currentRobotMode = 7;
    sendCommand({ c: 'm', v: 7 });
  } else if (featureKey === 'weather') {
    const panel = document.getElementById('detailViewWeather');
    if (panel) panel.style.display = 'block';
    updateOledWeatherPreview();
    currentRobotMode = 2;
    sendCommand({ c: 'm', v: 2 });
  } else if (featureKey === 'subtitle') {
    const panel = document.getElementById('detailViewSubtitle');
    if (panel) panel.style.display = 'block';
    currentRobotMode = 3;
    sendCommand({ c: 'm', v: 3 });
  } else if (featureKey === 'game') {
    const panel = document.getElementById('detailViewGame');
    if (panel) panel.style.display = 'block';
    renderOledGameMenu();
    render10GamesGrid();
    currentRobotMode = 4;
    sendCommand({ c: 'm', v: 4 });
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// TUTUP DETAIL FITUR & KEMBALI KE OVERVIEW LAYAR OLED ROBOT
function closeRobotFeatureDetail() {
  triggerHaptic(20);
  currentOpenDetailFeature = null;

  const overview = document.getElementById('robotMainOverview');
  const detailView = document.getElementById('robotFeatureDetailView');

  if (detailView) detailView.style.display = 'none';
  if (overview) overview.style.display = 'block';

  document.querySelectorAll('.detail-feature-panel').forEach(p => p.style.display = 'none');
}

// HANDLER TOMBOL KEMBALI NAVIGASI ANDROID (HARDWARE / GESTURE BACK)
window.handleAndroidBack = function() {
  if (currentOpenDetailFeature !== null) {
    closeRobotFeatureDetail();
    return true; // Berhasil ditangani di JS, tidak keluar aplikasi
  }
  return false; // Biarkan sistem Android menangani keluar / minimize
};

// HANDLER INTERAKTIF UNTUK FITUR DETAIL
function triggerVirtualTouchTap() {
  triggerHaptic(30);
  sendCommand({ c: 'tap' });
}

// ================= FITUR 3: KONTROL ALARM INTERAKTIF =================
let g_alarmHour = parseInt(localStorage.getItem('robot_cfg_alarm_h') || '6', 10);
let g_alarmMin = parseInt(localStorage.getItem('robot_cfg_alarm_m') || '30', 10);
let g_alarmEnabled = localStorage.getItem('robot_cfg_alarm_en') !== '0';
let g_alarmDaily = localStorage.getItem('robot_cfg_alarm_daily') !== '0';

function renderAlarmOledAndControls() {
  const hh = String(g_alarmHour).padStart(2, '0');
  const mm = String(g_alarmMin).padStart(2, '0');
  const timeText = `${hh}:${mm}`;
  const badgeText = `${g_alarmEnabled ? 'ON' : 'OFF'} \u2022 ${g_alarmDaily ? 'TIAP HARI' : 'SEKALI'}`;

  // Update display teks jam & status badge
  ['detailAlarmDigits', 'oledAlarmTimePreview', 'stageAlarmDigits', 'mainAlarmDigits'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = timeText;
  });
  ['detailAlarmBadge', 'oledAlarmBadgePreview', 'stageAlarmBadge', 'mainAlarmBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = badgeText;
      el.style.opacity = g_alarmEnabled ? '1' : '0.45';
    }
  });

  // Update stepper display
  const dH = document.getElementById('dispAlarmHour');
  const dM = document.getElementById('dispAlarmMin');
  if (dH) dH.textContent = hh;
  if (dM) dM.textContent = mm;

  // Update tombol toggle
  const btnEn = document.getElementById('btnToggleAlarmEn');
  if (btnEn) {
    btnEn.textContent = `ALARM: ${g_alarmEnabled ? 'ON' : 'OFF'}`;
    btnEn.classList.toggle('active-toggle', g_alarmEnabled);
  }
  const btnRep = document.getElementById('btnToggleAlarmRepeat');
  if (btnRep) {
    btnRep.textContent = g_alarmDaily ? 'TIAP HARI' : 'SEKALI';
    btnRep.classList.toggle('active-toggle', g_alarmDaily);
  }

  // Update status bar alarm icon di semua detail screen
  document.querySelectorAll('.detail-status-alarm-icon').forEach(icon => {
    icon.classList.toggle('visible', g_alarmEnabled);
  });
}

function sendAlarmToRobot() {
  localStorage.setItem('robot_cfg_alarm_h', String(g_alarmHour));
  localStorage.setItem('robot_cfg_alarm_m', String(g_alarmMin));
  localStorage.setItem('robot_cfg_alarm_en', g_alarmEnabled ? '1' : '0');
  localStorage.setItem('robot_cfg_alarm_daily', g_alarmDaily ? '1' : '0');

  renderAlarmOledAndControls();

  sendCommand({
    cmd: 'alarm',
    hour: g_alarmHour,
    min: g_alarmMin,
    en: g_alarmEnabled,
    daily: g_alarmDaily,
    enabled: g_alarmEnabled
  });
}

let alarmSendDebounceTimer = null;

function stepAlarmHour(dir) {
  triggerHaptic(15);
  g_alarmHour = (g_alarmHour + dir + 24) % 24;
  renderAlarmOledAndControls();
  queueAlarmSend();
}

function stepAlarmMin(dir) {
  triggerHaptic(15);
  g_alarmMin = (g_alarmMin + dir + 60) % 60;
  renderAlarmOledAndControls();
  queueAlarmSend();
}

function queueAlarmSend() {
  if (alarmSendDebounceTimer) clearTimeout(alarmSendDebounceTimer);
  alarmSendDebounceTimer = setTimeout(() => {
    sendAlarmToRobot();
  }, 120);
}

function toggleAlarmPowerFromApp() {
  triggerHaptic(25);
  g_alarmEnabled = !g_alarmEnabled;
  sendAlarmToRobot();
}

function toggleAlarmRepeatFromApp() {
  triggerHaptic(25);
  g_alarmDaily = !g_alarmDaily;
  sendAlarmToRobot();
}

// ================= FITUR 3: KONTROL ALARM INTERAKTIF & REPEAT HOLD =================
function bindStepperHold(btnId, stepFn) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  let holdTimer = null;
  let repeatTimer = null;
  let isPressed = false;

  const start = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    isPressed = true;
    stepFn(); // Tap = naik 1 per 1

    if (holdTimer) clearTimeout(holdTimer);
    if (repeatTimer) clearInterval(repeatTimer);

    // Jika tombol ditahan lebih dari 250ms, auto-repeat cepat (setiap 55ms)
    holdTimer = setTimeout(() => {
      if (!isPressed) return;
      repeatTimer = setInterval(() => {
        if (!isPressed) {
          clearInterval(repeatTimer);
          return;
        }
        stepFn(); // Tahan = jadi cepat
      }, 55);
    }, 250);
  };

  const stop = () => {
    if (!isPressed) return;
    isPressed = false;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (repeatTimer) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }
    // Kirim nilai final ke robot saat dilepas
    sendAlarmToRobot();
  };

  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

function setupAlarmStepperRepeat() {
  bindStepperHold('btnAlarmHourUp', () => stepAlarmHour(1));
  bindStepperHold('btnAlarmHourDown', () => stepAlarmHour(-1));
  bindStepperHold('btnAlarmMinUp', () => stepAlarmMin(1));
  bindStepperHold('btnAlarmMinDown', () => stepAlarmMin(-1));
}

// ================= FITUR 4: KONTROL STOPWATCH INTERAKTIF =================
let isSwRunning = false;
let swStartTime = 0;
let swElapsedBeforePause = 0;
let swTimerId = null;

function formatStopwatchTime(totalMs) {
  const centisec = Math.floor((totalMs / 10) % 100);
  const sec = Math.floor((totalMs / 1000) % 60);
  const min = Math.floor(totalMs / 60000);
  if (min < 100) {
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(centisec).padStart(2, '0')}`;
  } else {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${String(hr).padStart(2, '0')}:${String(remMin).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
}

function updateStopwatchDisplay() {
  let totalMs = swElapsedBeforePause;
  if (isSwRunning) {
    totalMs += (Date.now() - swStartTime);
  }

  const timeStr = formatStopwatchTime(totalMs);
  const barPercent = Math.min(100, Math.max(0, ((totalMs % 60000) / 60000) * 100));

  const digits = document.getElementById('detailSwDigits');
  const previewDigits = document.getElementById('oledStopwatchPreview');
  const bar = document.getElementById('detailSwBarFill');
  const oledBar = document.getElementById('oledSwBarFill');

  if (digits) digits.textContent = timeStr;
  if (previewDigits) previewDigits.textContent = timeStr;
  if (bar) bar.style.width = barPercent + '%';
  if (oledBar) oledBar.style.width = barPercent + '%';

  const btnStartStop = document.getElementById('btnSwStartStop');
  if (btnStartStop) {
    btnStartStop.textContent = isSwRunning ? 'STOP' : 'MULAI';
    btnStartStop.classList.toggle('danger', isSwRunning);
  }

  // Tombol reset HANYA bisa dipencet jika:
  // 1. Sudah ada angkanya (totalMs > 0)
  // 2. Bukan 00:00:00
  // 3. Tidak sedang mulai/berjalan (!isSwRunning)
  const btnReset = document.getElementById('btnSwReset');
  const canReset = (!isSwRunning && totalMs > 0);
  if (btnReset) {
    btnReset.disabled = !canReset;
    btnReset.classList.toggle('disabled', !canReset);
  }
}

function toggleStopwatchStartStop() {
  triggerHaptic(30);
  if (!isSwRunning) {
    isSwRunning = true;
    swStartTime = Date.now();
    if (swTimerId) clearInterval(swTimerId);
    swTimerId = setInterval(updateStopwatchDisplay, 30);
    sendCommand({ c: 'action' });
  } else {
    isSwRunning = false;
    swElapsedBeforePause += (Date.now() - swStartTime);
    if (swTimerId) {
      clearInterval(swTimerId);
      swTimerId = null;
    }
    sendCommand({ c: 'action' });
  }
  updateStopwatchDisplay();
}

function resetStopwatchFromApp() {
  let totalMs = swElapsedBeforePause;
  if (isSwRunning) {
    totalMs += (Date.now() - swStartTime);
  }

  // Syarat mutlak: tidak bisa dipencet saat 00:00 atau saat sedang mulai
  if (isSwRunning || totalMs <= 0) {
    return;
  }

  triggerHaptic(40);
  isSwRunning = false;
  if (swTimerId) {
    clearInterval(swTimerId);
    swTimerId = null;
  }
  swStartTime = 0;
  swElapsedBeforePause = 0;
  updateStopwatchDisplay();
  sendCommand({ c: 'm', v: 7 }); // Mode 7 di ESP32 mereset stopwatch ke 00:00:00
}

// ================= FITUR 5: 10 GAME ARCADE (WARNA TEMA CYAN, AUTO LAUNCH & LOCK SYARAT) =================
const GAMES_LIST = [
  {
    id: 0,
    mode: 5,
    name: 'FLAPPY BIRD',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><path d="M4 14c2-4 6-6 10-4l4-2v4c2 2 2 5-1 7-4 2-9 1-13-5z"/><circle cx="15" cy="11" r="1" fill="#00F0FF"/></svg>'
  },
  {
    id: 1,
    mode: 6,
    name: 'DINO RUNNER',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><path d="M7 19v-4m4 4v-3m3 3h4V12h-3V7h-4v3H7v3h4v4z"/></svg>'
  },
  {
    id: 2,
    mode: 9,
    name: 'CAVE COPTER',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><path d="M4 7h16M12 7v3m-7 4h10a4 4 0 0 1-4 4H7a2 2 0 0 1-2-2v-2zm12 2h3m-15 4h12"/></svg>'
  },
  {
    id: 3,
    mode: 10,
    name: 'GRAV RUNNER',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="5" r="2"/><path d="m9 20 3-6 3 2 2 4M6 13l3-2 3 2 4-3"/></svg>'
  },
  {
    id: 4,
    mode: 11,
    name: 'PIN CIRCLE',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="#00F0FF"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/></svg>'
  },
  {
    id: 5,
    mode: 12,
    name: 'ORBIT JUMP',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)"/></svg>'
  },
  {
    id: 6,
    mode: 13,
    name: 'TOWER STACK',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><rect x="7" y="15" width="10" height="4" rx="1"/><rect x="5" y="10" width="14" height="4" rx="1"/><rect x="8" y="5" width="8" height="4" rx="1"/></svg>'
  },
  {
    id: 7,
    mode: 14,
    name: 'RADAR DEFEND',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><line x1="12" y1="12" x2="18" y2="7"/><circle cx="12" cy="12" r="1.5" fill="#00F0FF"/></svg>'
  },
  {
    id: 8,
    mode: 15,
    name: 'HOOP DUNK',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="7" cy="8" r="3"/><path d="M12 11h8l-2 8h-4l-2-8zM12 11v6m8-6-4 8m0-8 4 8"/></svg>'
  },
  {
    id: 9,
    mode: 16,
    name: 'ORBIT PONG',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="9"/><rect x="5" y="10" width="2" height="5" rx="1" fill="#00F0FF"/><rect x="17" y="9" width="2" height="5" rx="1" fill="#00F0FF"/><circle cx="11" cy="12" r="1.5" fill="#00F0FF"/></svg>'
  }
];

let g_selectedGameIdx = 0;
let isGameActivelyPlaying = false;

function renderOledGameMenu() {
  const container = document.getElementById('oledGameMenuContainer');
  const counter = document.getElementById('oledGameCounter');
  if (!container) return;

  const total = GAMES_LIST.length;
  let startIdx = 0;
  if (total > 3 && g_selectedGameIdx >= 3) {
    startIdx = g_selectedGameIdx - 2;
  }

  let html = '';
  for (let row = 0; row < 3; row++) {
    const idx = startIdx + row;
    if (idx >= total) break;
    const g = GAMES_LIST[idx];
    const isSel = (idx === g_selectedGameIdx);
    const cursor = isSel ? '&gt;&nbsp;' : '&nbsp;&nbsp;';
    html += `
      <div class="oled-game-menu-row ${isSel ? 'selected' : ''}">
        <span class="row-num">${cursor}${idx + 1}.</span>
        <span class="row-title">${g.name}</span>
      </div>
    `;
  }
  container.innerHTML = html;

  if (counter) {
    const curStr = String(g_selectedGameIdx + 1).padStart(2, '0');
    const totStr = String(total).padStart(2, '0');
    counter.textContent = `${curStr}/${totStr}`;
  }

  const lockStatus = document.getElementById('gameLockStatus');
  if (lockStatus) {
    lockStatus.style.display = isGameActivelyPlaying ? 'block' : 'none';
  }
}

function render10GamesGrid() {
  const grid = document.getElementById('games10Grid');
  if (!grid) return;

  grid.innerHTML = '';
  GAMES_LIST.forEach((g, idx) => {
    const card = document.createElement('div');
    card.className = `game-select-card ${isGameActivelyPlaying ? 'disabled-playing locked' : ''}`;
    card.onclick = () => selectAndLaunchGame(idx);
    card.innerHTML = `
      <span class="game-select-num">${idx + 1}</span>
      <div class="game-select-icon">${g.svg}</div>
      <span class="game-select-name">${g.name}</span>
    `;
    grid.appendChild(card);
  });
}

function selectAndLaunchGame(idx) {
  // Syarat: tidak sedang aktif memainkan game
  // Bisa masuk jika di menu game, belum mulai, atau game over
  if (isGameActivelyPlaying) {
    triggerHaptic(40);
    showNeonToast('Sedang bermain game! Selesaikan game atau Game Over untuk ganti game');
    return;
  }

  triggerHaptic(30);
  g_selectedGameIdx = idx;
  const game = GAMES_LIST[idx];

  // Otomatis masuk ke game tersebut dalam status belum dimulai (IDLE/READY)
  currentRobotMode = game.mode;
  sendCommand({ c: 'm', v: game.mode });

  renderOledGameMenu();
  render10GamesGrid();
}

// PILIH FITUR DI MENU ROBOT (LANGSUNG BUKA TAMPILAN DETAIL PERSIS OLED)
function selectRobotMenuFeature(featureKey, btnEl) {
  if (!isBleConnected) {
    showNeonToast('Wajib Terhubung Robot');
    return;
  }

  if (btnEl && typeof btnEl.blur === 'function') {
    btnEl.blur();
  }

  triggerHaptic(35);

  const navTabs = document.querySelectorAll('.nav-tab');
  const navRobotBtn = navTabs.length >= 3 ? navTabs[2] : null;
  switchMainTab('pageRobot', navRobotBtn);
  openRobotFeatureDetail(featureKey);
}

// ALIAS PENGIRIMAN WAJAH
function sendFace(faceIndex, elem) {
  selectFaceFromDetail(faceIndex, elem);
}

// Ganti Mode Robot (Jam, Cuaca, Game, dll)
function sendDeviceMode(modeIndex) {
  currentRobotMode = modeIndex;
  const ok = sendCommand({ c: 'm', v: modeIndex });
  if (ok) {
    showNeonToast('Mode Diaktifkan');
    triggerHaptic(30);
  }
}

// ================= 6. ROBOT SENSOR & DAYA =================
function sendTouchTap() {
  const ok = sendCommand({ c: 'tap' });
  if (ok) {
    showNeonToast('Tepuk Kepala');
    triggerHaptic(30);
  }
}

function sendPetting() {
  const ok = sendCommand({ c: 'pet' });
  if (ok) {
    showNeonToast('Elus Sayang');
    triggerHaptic(40);
  }
}

function sendShake() {
  const ok = sendCommand({ c: 'tilt' });
  if (ok) {
    showNeonToast('Goyang Robot');
    triggerHaptic(45);
  }
}

function sendSleep() {
  const ok = sendCommand({ c: 'sleep' });
  if (ok) {
    showNeonToast('Robot Masuk Tidur');
    triggerHaptic(30);
    const sleepEl = document.getElementById('teleSleepState');
    if (sleepEl) sleepEl.textContent = 'Robot Tidur';
  }
}

function sendWake() {
  const ok = sendCommand({ c: 'wake' });
  if (ok) {
    showNeonToast('Robot Bangun');
    triggerHaptic(35);
    const sleepEl = document.getElementById('teleSleepState');
    if (sleepEl) sleepEl.textContent = 'Robot Aktif (Bangun)';
  }
}

// SINKRONISASI TAMPILAN ALARM OLED
function updateOledAlarmPreview() {
  const h = document.getElementById('alarmHour');
  const m = document.getElementById('alarmMin');
  const en = document.getElementById('alarmEnabledToggle');
  const daily = document.getElementById('alarmDailyToggle');

  if (h && h.value !== '') g_alarmHour = parseInt(h.value, 10) || 0;
  if (m && m.value !== '') g_alarmMin = parseInt(m.value, 10) || 0;
  if (en) g_alarmEnabled = en.checked;
  if (daily) g_alarmDaily = daily.checked;

  renderAlarmOledAndControls();
}

// SIMPAN & TES ALARM
function saveAlarmSettings() {
  const hInput = document.getElementById('alarmHour');
  const mInput = document.getElementById('alarmMin');
  const enInput = document.getElementById('alarmEnabledToggle');
  const dailyInput = document.getElementById('alarmDailyToggle');

  const h = parseInt(hInput ? hInput.value : '6', 10) || 0;
  const m = parseInt(mInput ? mInput.value : '30', 10) || 0;
  const enabled = enInput ? enInput.checked : true;
  const daily = dailyInput ? dailyInput.checked : true;

  g_alarmHour = h;
  g_alarmMin = m;
  g_alarmEnabled = enabled;
  g_alarmDaily = daily;

  sendAlarmToRobot();
  showNeonToast('Alarm Disimpan: ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  triggerHaptic(30);
}

function testAlarmBuzzer() {
  const ok = sendCommand({ cmd: 'alarm_test' });
  if (ok) {
    showNeonToast('Tes Bunyi Alarm');
    triggerHaptic(40);
  }
}

// JAM DIGITAL OLED DENGAN ZONA WAKTU & FORMAT
let currentTimeFormat = 24;
let currentTimezoneOffset = 7;
let currentTempUnit = 'C';

function updateOledClockTick() {
  const clockEl = document.getElementById('oledClockPreview');
  const dateEl = document.getElementById('oledDatePreview');
  const stageClockEl = document.getElementById('stageClockDigits');
  const stageDateEl = document.getElementById('stageClockDate');
  const stageTzEl = document.getElementById('stageOledTzLabel');
  const detailClockEl = document.getElementById('detailClockDigits');
  const detailDateEl = document.getElementById('detailClockDate');
  const detailTzEl = document.getElementById('detailClockTz');

  let targetTime;
  if (hasEsp32TimeSync && localTimeAtSyncMs > 0) {
    const elapsedSinceSync = Date.now() - localTimeAtSyncMs;
    targetTime = new Date(esp32TimeBaseMs + elapsedSinceSync);
  } else {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    targetTime = new Date(utc + (3600000 * currentTimezoneOffset));
  }

  let hours = targetTime.getHours();
  const minutes = String(targetTime.getMinutes()).padStart(2, '0');
  const seconds = String(targetTime.getSeconds()).padStart(2, '0');

  let timeStr = '';
  if (currentTimeFormat === 12) {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    timeStr = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
  } else {
    timeStr = `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
  }

  const mainClockEl = document.getElementById('mainClockDigits');
  if (mainClockEl) mainClockEl.textContent = timeStr;
  if (clockEl) clockEl.textContent = timeStr;
  if (stageClockEl) stageClockEl.textContent = timeStr;
  if (detailClockEl) detailClockEl.textContent = timeStr;

  // Format tanggal 100% PERSIS OLED: "Minggu, 05 Nov 2026"
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const dayName = days[targetTime.getDay()];
  const dateNum = String(targetTime.getDate()).padStart(2, '0');
  const monthName = months[targetTime.getMonth()];
  const yearNum = targetTime.getFullYear();
  const dateStr = `${dayName}, ${dateNum} ${monthName} ${yearNum}`;

  const mainDateEl = document.getElementById('mainClockDate');
  if (mainDateEl) mainDateEl.textContent = dateStr;
  if (dateEl) dateEl.textContent = dateStr;
  if (stageDateEl) stageDateEl.textContent = dateStr;
  if (detailDateEl) detailDateEl.textContent = dateStr;

  const sel = document.getElementById('selTimezoneWorld');
  const selectedText = sel ? sel.options[sel.selectedIndex]?.text : '';
  const tzCode = selectedText ? selectedText.split(' ')[0] : 'WIB';
  if (stageTzEl) stageTzEl.textContent = tzCode;
  if (detailTzEl) detailTzEl.textContent = tzCode;
}

// Pembaruan realtime ultra-cepat (50ms) agar detik jam berpindah seketika tanpa jeda
setInterval(updateOledClockTick, 50);

// ================= 7. PENGATURAN (SETTING) =================

// Pengaturan Format Waktu (24 vs 12 Jam)
function setTimeFormat(fmt) {
  currentTimeFormat = fmt;
  const btn24 = document.getElementById('btnFmt24');
  const btn12 = document.getElementById('btnFmt12');
  const dBtn24 = document.getElementById('btnDetailFmt24');
  const dBtn12 = document.getElementById('btnDetailFmt12');
  if (btn24) btn24.classList.toggle('active', fmt === 24);
  if (btn12) btn12.classList.toggle('active', fmt === 12);
  if (dBtn24) dBtn24.classList.toggle('active', fmt === 24);
  if (dBtn12) dBtn12.classList.toggle('active', fmt === 12);
  localStorage.setItem('robot_cfg_time_fmt', String(fmt));
  updateOledClockTick();
  showNeonToast('Format Jam: ' + (fmt === 24 ? '24 Jam' : '12 Jam'));
  triggerHaptic(25);
}

// Pengaturan Zona Waktu Kota Dunia
function onTimezoneSelected(val) {
  const customWrap = document.getElementById('customTzWrap');
  const tzLabel = document.getElementById('oledTzLabel');

  if (val === 'custom') {
    if (customWrap) customWrap.style.display = 'flex';
    const customInput = document.getElementById('customTzInput');
    const customVal = parseFloat(customInput ? customInput.value : '7') || 0;
    currentTimezoneOffset = customVal;
    if (tzLabel) tzLabel.textContent = `UTC${customVal >= 0 ? '+' : ''}${customVal}`;
  } else {
    if (customWrap) customWrap.style.display = 'none';
    currentTimezoneOffset = parseFloat(val);
    const sel = document.getElementById('selTimezoneWorld');
    const selectedText = sel ? sel.options[sel.selectedIndex].text : '';
    const code = selectedText.split(' ')[0] || 'UTC';
    if (tzLabel) tzLabel.textContent = code;
  }
  localStorage.setItem('robot_cfg_tz', String(currentTimezoneOffset));
  updateOledClockTick();
  triggerHaptic(20);
}

// Sinkronisasi Jam HP & Timezone ke Robot Desk dengan kompensasi latensi mikrodetik
function syncClock() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc + (3600000 * currentTimezoneOffset));
  const totalMs = targetTime.getTime();
  const epochSec = Math.floor(totalMs / 1000);
  const remMs = (totalMs % 1000) + 30; // Kompensasi ~30ms latensi transmisi BLE
  const us = (remMs % 1000) * 1000;
  const finalEpoch = epochSec + Math.floor(remMs / 1000);

  // Kunci waktu lokal dengan waktu ESP32 secara instan
  esp32TimeBaseMs = (finalEpoch * 1000) + Math.floor(us / 1000);
  localTimeAtSyncMs = Date.now();
  hasEsp32TimeSync = true;

  const ok = sendCommand({
    cmd: 'time',
    epoch: finalEpoch,
    us: us,
    tz: currentTimezoneOffset,
    fmt: currentTimeFormat
  });
  if (ok) {
    showNeonToast('Jam Disinkronkan (' + (currentTimezoneOffset >= 0 ? '+' : '') + currentTimezoneOffset + ' UTC)');
    triggerHaptic(35);
  }
}

function syncClockQuiet() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc + (3600000 * currentTimezoneOffset));
  const totalMs = targetTime.getTime();
  const epochSec = Math.floor(totalMs / 1000);
  const remMs = (totalMs % 1000) + 30;
  const us = (remMs % 1000) * 1000;
  const finalEpoch = epochSec + Math.floor(remMs / 1000);

  esp32TimeBaseMs = (finalEpoch * 1000) + Math.floor(us / 1000);
  localTimeAtSyncMs = Date.now();
  hasEsp32TimeSync = true;

  sendCommand({
    cmd: 'time',
    epoch: finalEpoch,
    us: us,
    tz: currentTimezoneOffset,
    fmt: currentTimeFormat
  });
}

// SINKRONISASI TAMPILAN CUACA OLED (100% PERSIS FISIK SSD1306)
function updateOledWeatherPreview(city) {
  const cityEl = document.getElementById('oledCityPreview');
  const tempEl = document.getElementById('oledTempPreview');
  const stageCityEl = document.getElementById('stageWeatherCity');
  const stageTempEl = document.getElementById('stageWeatherTemp');
  const detailCityEl = document.getElementById('detailWeatherCity');
  const detailTempEl = document.getElementById('detailWeatherTemp');
  const cityInput = document.getElementById('cfgCityInput');
  const cityName = (city || (cityInput ? cityInput.value : 'JAKARTA')).toUpperCase();
  const tempVal = currentTempUnit === 'F' ? '82' : '28';
  const tempHtml = `${tempVal}<span class="oled-deg-circle"></span>`;

  const mainCity = document.getElementById('mainWeatherCity');
  const mainTemp = document.getElementById('mainWeatherTemp');
  if (mainCity) mainCity.textContent = cityName;
  if (mainTemp) mainTemp.innerHTML = tempHtml;

  if (cityEl) cityEl.textContent = cityName;
  if (stageCityEl) stageCityEl.textContent = cityName;
  if (detailCityEl) detailCityEl.textContent = cityName;
  if (tempEl) tempEl.innerHTML = tempHtml;
  if (stageTempEl) stageTempEl.innerHTML = tempHtml;
  if (detailTempEl) detailTempEl.innerHTML = tempHtml;

  // Nilai teks kelembapan dan angin persis format SSD1306
  const humPreview = document.getElementById('oledWeatherHumPreview');
  const windPreview = document.getElementById('oledWeatherWindPreview');
  const detailHum = document.getElementById('detailWeatherHum');
  const detailWind = document.getElementById('detailWeatherWind');
  if (humPreview) humPreview.textContent = 'Lembap: 75';
  if (windPreview) windPreview.textContent = 'Angin: 4 km';
  if (detailHum) detailHum.textContent = 'Lembap: 75';
  if (detailWind) detailWind.textContent = 'Angin: 4 km';
}

// Pengaturan Satuan Suhu (°C / °F)
function setTempUnit(unit) {
  currentTempUnit = unit;
  const btnC = document.getElementById('btnTempC');
  const btnF = document.getElementById('btnTempF');
  if (btnC) btnC.classList.toggle('active', unit === 'C');
  if (btnF) btnF.classList.toggle('active', unit === 'F');

  updateOledWeatherPreview();

  localStorage.setItem('robot_cfg_temp_unit', unit);
  sendCommand({ cmd: 'temp_unit', unit: unit });
  showNeonToast('Satuan Suhu: °' + unit);
  triggerHaptic(25);
}

// Pengaturan Kota Cuaca Dunia
function saveCitySetting() {
  const input = document.getElementById('cfgCityInput');
  const city = (input ? input.value.trim() : '') || 'Jakarta';
  localStorage.setItem('robot_cfg_city', city);

  updateOledWeatherPreview(city);

  const ok = sendCommand({ cmd: 'weather_city', city: city, unit: currentTempUnit });
  if (ok) {
    showNeonToast('Kota Disimpan: ' + city);
  }
  triggerHaptic(30);
}

function setPresetCity(name) {
  const input = document.getElementById('cfgCityInput');
  if (input) input.value = name;
  saveCitySetting();
}

// Kecerahan Layar OLED
let brightnessDebounce = null;
function changeOledBrightness(val) {
  const intVal = parseInt(val, 10);
  const pct = Math.round((intVal / 255) * 100) + '%';
  const txt = document.getElementById('txtOledBrightness');
  if (txt) txt.textContent = pct;

  if (brightnessDebounce) clearTimeout(brightnessDebounce);
  brightnessDebounce = setTimeout(() => {
    sendCommand({ cmd: 'bright', val: intVal });
  }, 200);
}

// Auto Sleep Timeout Chips
function setAutoSleep(seconds, btn) {
  document.querySelectorAll('.chips-control-box .chip-preset').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const ok = sendCommand({ cmd: 'sleep_to', val: seconds });
  if (ok) {
    showNeonToast(seconds === 0 ? 'Mode Selalu Nyala' : (seconds / 60) + ' Menit Istirahat');
    triggerHaptic(30);
  }
}

// Tes Suara Buzzer
function testBuzzerSound() {
  const ok = sendCommand({ cmd: 'buzzer', freq: 2400, dur: 120 });
  if (ok) {
    showNeonToast('Bunyi Nada Buzzer');
    triggerHaptic(30);
  }
}

// Restart Robot Desk
function restartRobot() {
  if (confirm('Restart Robot Desk sekarang?')) {
    sendCommand({ cmd: 'reboot' });
    showNeonToast('Robot Restart...');
    triggerHaptic(60);
  }
}

// Restore saved preferences on startup & trigger auto check
window.addEventListener('DOMContentLoaded', () => {
  const savedCity = localStorage.getItem('robot_cfg_city');
  if (savedCity) {
    const input = document.getElementById('cfgCityInput');
    if (input) input.value = savedCity;
    const cityPreview = document.getElementById('oledCityPreview');
    if (cityPreview) cityPreview.textContent = savedCity.toUpperCase();
  }

  const savedFmt = localStorage.getItem('robot_cfg_time_fmt');
  if (savedFmt) {
    setTimeFormat(parseInt(savedFmt, 10));
  }

  const savedTz = localStorage.getItem('robot_cfg_tz');
  if (savedTz) {
    currentTimezoneOffset = parseFloat(savedTz);
    const sel = document.getElementById('selTimezoneWorld');
    if (sel) sel.value = savedTz;
    const tzLabel = document.getElementById('oledTzLabel');
    const selectedText = sel ? sel.options[sel.selectedIndex]?.text : '';
    if (tzLabel && selectedText) tzLabel.textContent = selectedText.split(' ')[0] || 'UTC';
  }

  const savedUnit = localStorage.getItem('robot_cfg_temp_unit');
  if (savedUnit) {
    setTempUnit(savedUnit);
  }

  // Restore saved alarm preferences
  const savedAlarmH = localStorage.getItem('robot_cfg_alarm_h');
  const savedAlarmM = localStorage.getItem('robot_cfg_alarm_m');
  const savedAlarmEn = localStorage.getItem('robot_cfg_alarm_en');
  const savedAlarmDaily = localStorage.getItem('robot_cfg_alarm_daily');

  if (savedAlarmH !== null) {
    const hEl = document.getElementById('alarmHour');
    if (hEl) hEl.value = String(savedAlarmH).padStart(2, '0');
  }
  if (savedAlarmM !== null) {
    const mEl = document.getElementById('alarmMin');
    if (mEl) mEl.value = String(savedAlarmM).padStart(2, '0');
  }
  if (savedAlarmEn !== null) {
    const enEl = document.getElementById('alarmEnabledToggle');
    if (enEl) enEl.checked = savedAlarmEn === '1';
  }
  if (savedAlarmDaily !== null) {
    const dailyEl = document.getElementById('alarmDailyToggle');
    if (dailyEl) dailyEl.checked = savedAlarmDaily === '1';
  }

  // Attach live update listeners for alarm inputs
  ['alarmHour', 'alarmMin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateOledAlarmPreview);
  });
  ['alarmEnabledToggle', 'alarmDailyToggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateOledAlarmPreview);
  });

  renderDetailFacesGrid();
  updateOledFacePreview(0);
  renderAlarmOledAndControls();
  setupAlarmStepperRepeat();
  updateStopwatchDisplay();
  renderOledGameMenu();
  render10GamesGrid();
  updateOledClockTick();
  updateOledWeatherPreview();
  syncClockQuiet();

  // Cek status daya Bluetooth HP & sambungkan kembali ke robot tersimpan
  if (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') {
    const btOn = window.AndroidBLE.isBluetoothEnabled();
    window.onBluetoothPowerState(btOn);
    if (btOn) {
      if (hasSavedRobot()) {
        if (typeof window.AndroidBLE.reconnect === 'function') {
          window.AndroidBLE.reconnect();
        } else {
          window.AndroidBLE.connect();
        }
      } else {
        window.AndroidBLE.connect();
      }
    }
  } else {
    updateSetupGateView(true);
  }
});
