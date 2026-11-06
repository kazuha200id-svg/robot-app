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
    // Sinkronisasi status game sedang aktif dimainkan dari ESP32
    if (typeof data.playing === 'boolean') {
      const prevPlaying = isGameActivelyPlaying;
      isGameActivelyPlaying = data.playing;
      if (prevPlaying !== isGameActivelyPlaying) {
        if (typeof renderOledGameMenu === 'function') renderOledGameMenu();
        if (typeof render10GamesGrid === 'function') render10GamesGrid();
      }
    }
    if (data.status === 'error' && data.msg) {
      showNeonToast(data.msg);
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

    // Time sync ACK from robot
    if (data.action === 'time' || data.action === 't' || (data.status === 'ok' && typeof data.epoch === 'number')) {
      clockSyncAckReceived = true;
    }

    // Clock config sync
    if (data.clock) {
      if (typeof data.clock.fmt_12h === 'boolean') {
        currentClockFormat12H = data.clock.fmt_12h;
        currentClockShowSec = !currentClockFormat12H;
        const btn24 = document.getElementById('btnClockFmt24');
        const btn12 = document.getElementById('btnClockFmt12');
        if (btn24) btn24.classList.toggle('active', !currentClockFormat12H);
        if (btn12) btn12.classList.toggle('active', currentClockFormat12H);
      }
      if (typeof data.clock.tz === 'number') {
        currentClockTzOffsetMin = data.clock.tz;
        const matched = WORLD_TIMEZONES.find(t => t.offsetMin === currentClockTzOffsetMin);
        if (matched) {
          currentClockTzTitle = matched.title;
          const titleEl = document.getElementById('clockActiveTzTitle');
          if (titleEl) titleEl.textContent = matched.title;
        }
      }
      updateOledClockTick();
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
  if (elem && typeof elem.blur === 'function') {
    elem.blur();
  }
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

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
    if (!isGameActivelyPlaying) {
      currentRobotMode = 4;
      sendCommand({ c: 'm', v: 4 });
    }
    // Minta status bermain game dari ESP32 seketika
    sendCommand({ c: 's' });

    if (window._gameDetailSyncTimer) clearInterval(window._gameDetailSyncTimer);
    window._gameDetailSyncTimer = setInterval(() => {
      if (currentOpenDetailFeature === 'game' && isBleConnected) {
        sendCommand({ c: 's' });
      } else {
        clearInterval(window._gameDetailSyncTimer);
        window._gameDetailSyncTimer = null;
      }
    }, 1500);
  } else if (featureKey === 'spotify') {
    const panel = document.getElementById('detailViewSpotify');
    if (panel) panel.style.display = 'block';
    updateSpotifyPermissionUI();
    updateSpotifyDetailUI();
    currentRobotMode = 17;
    sendCommand({ c: 'm', v: 17 });
    if (window.AndroidBLE && typeof window.AndroidBLE.requestMusicSync === 'function') {
      window.AndroidBLE.requestMusicSync();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// TUTUP DETAIL FITUR & KEMBALI KE OVERVIEW LAYAR OLED ROBOT
function closeRobotFeatureDetail() {
  triggerHaptic(20);
  currentOpenDetailFeature = null;

  if (window._gameDetailSyncTimer) {
    clearInterval(window._gameDetailSyncTimer);
    window._gameDetailSyncTimer = null;
  }

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
    card.onclick = () => {
      if (typeof card.blur === 'function') card.blur();
      selectAndLaunchGame(idx);
    };
    card.innerHTML = `
      <span class="game-select-num">${idx + 1}</span>
      <div class="game-select-icon">${g.svg}</div>
      <span class="game-select-name">${g.name}</span>
    `;
    grid.appendChild(card);
  });
}

function selectAndLaunchGame(idx) {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  // Syarat: tidak sedang aktif memainkan game
  // Pergantian game hanya bisa dilakukan saat:
  // 1. Berada di menu game
  // 2. Game over
  // 3. Game belum dimulai (status IDLE/READY)
  if (isGameActivelyPlaying) {
    triggerHaptic(40);
    showNeonToast('Sedang bermain game! Hanya bisa ganti saat di menu game, game over, atau game belum dimulai');
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

// PILIH FITUR DI MENU LAYAR UTAMA (HANYA GANTI MODE LAYAR OLED FISIK ROBOT, TIDAK MEMBUKA DETAIL DI APLIKASI)
function selectRobotMenuFeature(featureKey, btnEl) {
  if (!isBleConnected) {
    showNeonToast('Wajib Terhubung Robot');
    return;
  }

  if (btnEl && typeof btnEl.blur === 'function') {
    btnEl.blur();
  }

  // Kunci perpindahan fitur jika robot sedang aktif memainkan game
  if (isGameActivelyPlaying) {
    triggerHaptic(40);
    showNeonToast('Sedang bermain game! Selesaikan atau Game Over untuk ganti fitur');
    return;
  }

  triggerHaptic(30);

  const modeMap = {
    'face': 0,
    'clock': 1,
    'weather': 2,
    'subtitle': 3,
    'game': 4,
    'stopwatch': 7,
    'alarm': 8,
    'spotify': 17
  };

  const targetMode = modeMap[featureKey];
  if (targetMode !== undefined) {
    currentRobotMode = targetMode;
    if (featureKey === 'clock') {
      syncClockQuiet();
    } else if (featureKey === 'spotify') {
      if (window.AndroidBLE && typeof window.AndroidBLE.requestMusicSync === 'function') {
        window.AndroidBLE.requestMusicSync();
      }
    }
    sendCommand({ c: 'm', v: targetMode });
  }
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

// Konfigurasi Fitur Jam Digital Robot
let currentClockFormat12H = false; // false = 24 Jam (HH:MM:SS), true = 12 Jam (HH:MM AM/PM)
let currentClockShowSec = true;    // 24 Jam menggunakan detik, 12 Jam menggunakan AM/PM
let currentClockTzOffsetMin = 420; // Default UTC+07:00 (+420 menit)
let currentClockTzTitle = 'UTC+07:00 (Jakarta, Bangkok, Hanoi)';

// Daftar Lengkap Seluruh Zona Waktu Dunia Format Internasional (UTC-12:00 s/d UTC+14:00)
const WORLD_TIMEZONES = [
  { offsetMin: -720, label: 'UTC-12:00', title: 'UTC-12:00 (Baker Island, Howland Island)' },
  { offsetMin: -660, label: 'UTC-11:00', title: 'UTC-11:00 (Pago Pago, Niue, Midway)' },
  { offsetMin: -600, label: 'UTC-10:00', title: 'UTC-10:00 (Honolulu, Tahiti, Rarotonga)' },
  { offsetMin: -540, label: 'UTC-09:00', title: 'UTC-09:00 (Anchorage, Juneau, Gambier)' },
  { offsetMin: -480, label: 'UTC-08:00', title: 'UTC-08:00 (Los Angeles, San Francisco, Vancouver)' },
  { offsetMin: -420, label: 'UTC-07:00', title: 'UTC-07:00 (Denver, Phoenix, Calgary, Salt Lake)' },
  { offsetMin: -360, label: 'UTC-06:00', title: 'UTC-06:00 (Chicago, Houston, Dallas, Mexico City)' },
  { offsetMin: -300, label: 'UTC-05:00', title: 'UTC-05:00 (New York, Washington DC, Toronto, Bogota)' },
  { offsetMin: -240, label: 'UTC-04:00', title: 'UTC-04:00 (Santiago, Santo Domingo, Halifax, Caracas)' },
  { offsetMin: -210, label: 'UTC-03:30', title: 'UTC-03:30 (St. John\'s, Newfoundland)' },
  { offsetMin: -180, label: 'UTC-03:00', title: 'UTC-03:00 (Sao Paulo, Buenos Aires, Montevideo)' },
  { offsetMin: -120, label: 'UTC-02:00', title: 'UTC-02:00 (South Georgia, Fernando de Noronha)' },
  { offsetMin: -60,  label: 'UTC-01:00', title: 'UTC-01:00 (Azores, Cape Verde, Praia)' },
  { offsetMin: 0,    label: 'UTC+00:00', title: 'UTC+00:00 (London, Dublin, Lisbon, Reykjavik)' },
  { offsetMin: 60,   label: 'UTC+01:00', title: 'UTC+01:00 (Paris, Berlin, Rome, Madrid, Amsterdam)' },
  { offsetMin: 120,  label: 'UTC+02:00', title: 'UTC+02:00 (Cairo, Athens, Jerusalem, Helsinki)' },
  { offsetMin: 180,  label: 'UTC+03:00', title: 'UTC+03:00 (Riyadh, Moscow, Istanbul, Nairobi)' },
  { offsetMin: 210,  label: 'UTC+03:30', title: 'UTC+03:30 (Tehran, Isfahan)' },
  { offsetMin: 240,  label: 'UTC+04:00', title: 'UTC+04:00 (Dubai, Abu Dhabi, Baku, Tbilisi)' },
  { offsetMin: 270,  label: 'UTC+04:30', title: 'UTC+04:30 (Kabul, Kandahar)' },
  { offsetMin: 300,  label: 'UTC+05:00', title: 'UTC+05:00 (Karachi, Tashkent, Islamabad, Yekaterinburg)' },
  { offsetMin: 330,  label: 'UTC+05:30', title: 'UTC+05:30 (New Delhi, Mumbai, Kolkata, Colombo)' },
  { offsetMin: 345,  label: 'UTC+05:45', title: 'UTC+05:45 (Kathmandu, Pokhara)' },
  { offsetMin: 360,  label: 'UTC+06:00', title: 'UTC+06:00 (Dhaka, Almaty, Omsk, Bishkek)' },
  { offsetMin: 390,  label: 'UTC+06:30', title: 'UTC+06:30 (Yangon, Naypyidaw)' },
  { offsetMin: 420,  label: 'UTC+07:00', title: 'UTC+07:00 (Jakarta, Bangkok, Hanoi, Surabaya)' },
  { offsetMin: 480,  label: 'UTC+08:00', title: 'UTC+08:00 (Singapore, Beijing, Kuala Lumpur, Perth)' },
  { offsetMin: 540,  label: 'UTC+09:00', title: 'UTC+09:00 (Tokyo, Seoul, Jayapura, Pyongyang)' },
  { offsetMin: 570,  label: 'UTC+09:30', title: 'UTC+09:30 (Adelaide, Darwin)' },
  { offsetMin: 600,  label: 'UTC+10:00', title: 'UTC+10:00 (Sydney, Melbourne, Brisbane, Guam)' },
  { offsetMin: 660,  label: 'UTC+11:00', title: 'UTC+11:00 (Honiara, Noumea, Magadan)' },
  { offsetMin: 720,  label: 'UTC+12:00', title: 'UTC+12:00 (Auckland, Wellington, Fiji)' },
  { offsetMin: 765,  label: 'UTC+12:45', title: 'UTC+12:45 (Chatham Islands)' },
  { offsetMin: 780,  label: 'UTC+13:00', title: 'UTC+13:00 (Nuku\'alofa, Apia, Tokelau)' },
  { offsetMin: 840,  label: 'UTC+14:00', title: 'UTC+14:00 (Kiritimati, Line Islands)' }
];

function renderTimezoneDropdown() {
  const container = document.getElementById('clockTzDropdownList');
  if (!container) return;
  container.innerHTML = '';
  WORLD_TIMEZONES.forEach((item) => {
    const el = document.createElement('div');
    el.className = `tz-dropdown-item ${item.offsetMin === currentClockTzOffsetMin ? 'selected' : ''}`;
    el.onclick = () => selectTimezoneItem(item.offsetMin, item.title);
    el.innerHTML = `<span class="tz-item-title">${item.title}</span>`;
    container.appendChild(el);
  });
}

function toggleTimezoneDropdown() {
  triggerHaptic(15);
  const list = document.getElementById('clockTzDropdownList');
  const arrow = document.getElementById('clockTzArrow');
  if (!list) return;
  const isHidden = list.style.display === 'none';
  if (isHidden) {
    renderTimezoneDropdown();
    list.style.display = 'flex';
    if (arrow) arrow.classList.add('open');
  } else {
    list.style.display = 'none';
    if (arrow) arrow.classList.remove('open');
  }
}

// PEMILIHAN ZONA WAKTU INTERNASIONAL (OTOMATIS LANGSUNG DITERAPKAN KE ESP32)
function selectTimezoneItem(offsetMin, title) {
  triggerHaptic(25);
  currentClockTzOffsetMin = offsetMin;
  currentClockTzTitle = title;

  const titleEl = document.getElementById('clockActiveTzTitle');
  if (titleEl) titleEl.textContent = title;

  const list = document.getElementById('clockTzDropdownList');
  const arrow = document.getElementById('clockTzArrow');
  if (list) list.style.display = 'none';
  if (arrow) arrow.classList.remove('open');

  currentTimezoneOffset = offsetMin / 60;
  const oledTzLabel = document.getElementById('oledTzLabel');
  if (oledTzLabel) {
    const sign = offsetMin >= 0 ? '+' : '';
    const hrs = offsetMin / 60;
    oledTzLabel.textContent = `UTC${sign}${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)}`;
  }

  updateOledClockTick();

  // OTOMATIS BERUBAH DI ESP32 C3 (TANPA TOMBOL TERAPKAN)
  if (isBleConnected && !isGameActivelyPlaying) {
    sendCommand({
      cmd: 'clock_cfg',
      tz: currentClockTzOffsetMin,
      fmt_12h: currentClockFormat12H,
      show_sec: currentClockShowSec
    });
  }

  showNeonToast(`Zona Waktu: ${title}`);
}

// PEMILIHAN FORMAT 24H vs 12H (OTOMATIS LANGSUNG DITERAPKAN KE ESP32)
function selectClockFormat(is12H, btnEl) {
  if (btnEl && typeof btnEl.blur === 'function') btnEl.blur();
  triggerHaptic(20);
  currentClockFormat12H = is12H;
  currentClockShowSec = !is12H; // 24 jam dengan detik (HH:MM:SS), 12 jam dengan AM/PM (HH:MM AM/PM)
  currentTimeFormat = is12H ? 12 : 24;

  const btn24 = document.getElementById('btnClockFmt24');
  const btn12 = document.getElementById('btnClockFmt12');
  if (btn24) btn24.classList.toggle('active', !is12H);
  if (btn12) btn12.classList.toggle('active', is12H);

  updateOledClockTick();

  // OTOMATIS BERUBAH DI ESP32 C3 (TANPA TOMBOL TERAPKAN)
  if (isBleConnected && !isGameActivelyPlaying) {
    sendCommand({
      cmd: 'clock_cfg',
      c: 'cfg_c',
      tz: currentClockTzOffsetMin,
      z: currentClockTzOffsetMin,
      fmt_12h: currentClockFormat12H,
      f: currentClockFormat12H,
      show_sec: currentClockShowSec,
      s: currentClockShowSec
    });
  }

  showNeonToast(`Format Jam: ${is12H ? '12 Jam (AM/PM)' : '24 Jam (Detik)'}`);
}

// SINKRONKAN JAM DENGAN HP DENGAN ANIMASI MINIMAL 3 DETIK
let isClockSyncing = false;
let clockSyncAckReceived = false;

function syncClockFromPhone(btnEl) {
  if (btnEl && typeof btnEl.blur === 'function') btnEl.blur();
  if (isClockSyncing) return;

  const btn = document.getElementById('btnSyncClockPhone');
  const txt = document.getElementById('btnSyncClockText');
  const spinner = document.getElementById('clockSyncSpinner');

  if (!isBleConnected) {
    triggerHaptic(40);
    if (btn) {
      btn.classList.remove('syncing', 'success');
      btn.classList.add('failed');
    }
    if (txt) txt.textContent = 'GAGAL MENYINKRONKAN';
    setTimeout(() => {
      if (btn) btn.classList.remove('failed');
      if (txt) txt.textContent = 'SINKRONKAN JAM DENGAN HP';
    }, 2500);
    return;
  }
  if (isGameActivelyPlaying) {
    triggerHaptic(40);
    if (btn) {
      btn.classList.remove('syncing', 'success');
      btn.classList.add('failed');
    }
    if (txt) txt.textContent = 'GAGAL MENYINKRONKAN';
    setTimeout(() => {
      if (btn) btn.classList.remove('failed');
      if (txt) txt.textContent = 'SINKRONKAN JAM DENGAN HP';
    }, 2500);
    return;
  }

  isClockSyncing = true;
  clockSyncAckReceived = false;
  triggerHaptic(30);

  if (btn) {
    btn.disabled = true;
    btn.classList.add('syncing');
    btn.classList.remove('success', 'failed');
  }
  if (spinner) spinner.style.display = 'inline-block';
  if (txt) txt.textContent = 'MENYINKRONKAN...';

  const now = Date.now();
  const epoch = Math.floor(now / 1000);
  const us = (now % 1000) * 1000;

  // Deteksi otomatis zona waktu asli dari perangkat HP (contoh: Jawa Barat = UTC+7 / +420 menit)
  const phoneTzOffsetMin = -new Date().getTimezoneOffset();
  currentClockTzOffsetMin = phoneTzOffsetMin;
  currentTimezoneOffset = phoneTzOffsetMin / 60;

  // Perbarui judul selector zona waktu di UI agar sinkron dengan zona waktu HP
  const matchedTz = WORLD_TIMEZONES.find(t => t.offsetMin === phoneTzOffsetMin);
  if (matchedTz) {
    currentClockTzTitle = matchedTz.title;
    const titleEl = document.getElementById('clockActiveTzTitle');
    if (titleEl) titleEl.textContent = matchedTz.title;
  }
  const oledTzLabel = document.getElementById('oledTzLabel');
  if (oledTzLabel) {
    const sign = phoneTzOffsetMin >= 0 ? '+' : '';
    const hrs = phoneTzOffsetMin / 60;
    oledTzLabel.textContent = `UTC${sign}${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)}`;
  }

  // Kirim data waktu presisi UTC + offset menit zona waktu HP ke ESP32
  sendCommand({
    cmd: 'time',
    c: 't',
    epoch: epoch,
    e: epoch,
    us: us,
    u: us,
    tz: currentClockTzOffsetMin,
    z: currentClockTzOffsetMin,
    fmt_12h: currentClockFormat12H,
    f: currentClockFormat12H,
    show_sec: currentClockShowSec,
    s: currentClockShowSec
  }, true);

  esp32TimeBaseMs = now;
  localTimeAtSyncMs = now;
  hasEsp32TimeSync = true;
  updateOledClockTick();

  const syncStartTime = Date.now();
  const MIN_SYNC_ANIMATION_MS = 3000; // Minimal durasi animasi 3 detik

  setTimeout(() => {
    const elapsed = Date.now() - syncStartTime;
    const remainingWait = Math.max(0, MIN_SYNC_ANIMATION_MS - elapsed);

    setTimeout(() => {
      // Evaluasi apakah sinkronisasi berhasil atau gagal
      const isSuccess = isBleConnected;

      if (isSuccess) {
        // Fase Berhasil (Tetap Menggunakan Warna Tema Neon Cyan)
        if (btn) {
          btn.classList.remove('syncing', 'failed');
          btn.classList.add('success');
        }
        if (spinner) spinner.style.display = 'none';
        if (txt) txt.textContent = 'JAM TERSINKRON';

        triggerHaptic(45);

        // Kembalikan tombol ke tampilan normal setelah 1.8 detik
        setTimeout(() => {
          if (btn) {
            btn.disabled = false;
            btn.classList.remove('success');
          }
          if (txt) txt.textContent = 'SINKRONKAN JAM DENGAN HP';
          isClockSyncing = false;
        }, 1800);

      } else {
        // Fase Gagal (Tetap Menggunakan Warna Tema Neon Cyan)
        if (btn) {
          btn.classList.remove('syncing', 'success');
          btn.classList.add('failed');
        }
        if (spinner) spinner.style.display = 'none';
        if (txt) txt.textContent = 'GAGAL MENYINKRONKAN';

        triggerHaptic(50);

        // Kembalikan tombol ke tampilan normal setelah 2.5 detik
        setTimeout(() => {
          if (btn) {
            btn.disabled = false;
            btn.classList.remove('failed');
          }
          if (txt) txt.textContent = 'SINKRONKAN JAM DENGAN HP';
          isClockSyncing = false;
        }, 2500);
      }

    }, remainingWait);
  }, 100);
}

function updateOledClockTick() {
  const clockEl = document.getElementById('oledClockPreview');
  const dateEl = document.getElementById('oledDatePreview');
  const detailClockEl = document.getElementById('detailClockDigits');
  const detailDateEl = document.getElementById('detailClockDate');

  const localNow = new Date();

  // Waktu target dihitung dari UTC + offset zona waktu terpilih
  const utcMs = localNow.getTime() + (localNow.getTimezoneOffset() * 60000);
  const targetTime = new Date(utcMs + (currentClockTzOffsetMin * 60000));

  let hours = targetTime.getHours();
  const minutes = String(targetTime.getMinutes()).padStart(2, '0');
  const seconds = String(targetTime.getSeconds()).padStart(2, '0');

  let timeStr = '';
  if (!currentClockFormat12H) {
    // Mode 24 Jam: Jam Menit Detik (HH:MM:SS)
    timeStr = `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
  } else {
    // Mode 12 Jam: Jam Menit AM/PM (HH:MM AM/PM)
    const ampm = hours >= 12 ? 'PM' : 'AM';
    let h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    timeStr = `${String(h12).padStart(2, '0')}:${minutes} ${ampm}`;
  }

  if (clockEl) clockEl.textContent = timeStr;
  if (detailClockEl) detailClockEl.textContent = timeStr;

  // Tanggal & Nama Hari Otomatis Mengikuti Zona Waktu (Gregorian Calendar)
  const days = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
  const dayName = days[targetTime.getDay()];
  const dateNum = String(targetTime.getDate()).padStart(2, '0');
  const monthName = months[targetTime.getMonth()];
  const yearNum = targetTime.getFullYear();
  const dateStr = `${dayName}, ${dateNum} ${monthName} ${yearNum}`;

  if (dateEl) dateEl.textContent = dateStr;
  if (detailDateEl) detailDateEl.textContent = dateStr;
}

// Pembaruan realtime ultra-cepat (50ms) agar detik jam berpindah seketika tanpa jeda
setInterval(updateOledClockTick, 50);

// ================= 7. PENGATURAN (SETTING) =================

// Pengaturan Format Waktu (24 vs 12 Jam)
function setTimeFormat(fmt) {
  currentTimeFormat = fmt;
  currentClockFormat12H = (fmt === 12);
  currentClockShowSec = !currentClockFormat12H;
  const btn24 = document.getElementById('btnFmt24');
  const btn12 = document.getElementById('btnFmt12');
  const dBtn24 = document.getElementById('btnDetailFmt24');
  const dBtn12 = document.getElementById('btnDetailFmt12');
  const cBtn24 = document.getElementById('btnClockFmt24');
  const cBtn12 = document.getElementById('btnClockFmt12');
  if (btn24) btn24.classList.toggle('active', fmt === 24);
  if (btn12) btn12.classList.toggle('active', fmt === 12);
  if (dBtn24) dBtn24.classList.toggle('active', fmt === 24);
  if (dBtn12) dBtn12.classList.toggle('active', fmt === 12);
  if (cBtn24) cBtn24.classList.toggle('active', fmt === 24);
  if (cBtn12) cBtn12.classList.toggle('active', fmt === 12);
  localStorage.setItem('robot_cfg_time_fmt', String(fmt));
  updateOledClockTick();
  if (isBleConnected && !isGameActivelyPlaying) {
    sendCommand({
      cmd: 'clock_cfg',
      c: 'cfg_c',
      tz: currentClockTzOffsetMin,
      z: currentClockTzOffsetMin,
      fmt_12h: currentClockFormat12H,
      f: currentClockFormat12H,
      show_sec: currentClockShowSec,
      s: currentClockShowSec
    });
  }
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
  syncClockFromPhone();
}

function syncClockQuiet() {
  if (!isBleConnected) return;
  const now = Date.now();
  const epoch = Math.floor(now / 1000);
  const us = (now % 1000) * 1000;

  esp32TimeBaseMs = now;
  localTimeAtSyncMs = now;
  hasEsp32TimeSync = true;

  sendCommand({
    cmd: 'time',
    epoch: epoch,
    us: us,
    tz: currentClockTzOffsetMin,
    fmt_12h: currentClockFormat12H,
    show_sec: currentClockShowSec
  });
}

// State Cuaca & Autocomplete Terpilih
let selectedCityData = null;
let citySearchTimer = null;

function getWeatherConditionText(code) {
  if (code === 0) return 'Cerah';
  if (code === 1 || code === 2) return 'Berawan';
  if (code === 3) return 'Mendung';
  if (code === 45 || code === 48) return 'Kabut';
  if (code >= 51 && code <= 55) return 'Gerimis';
  if (code >= 61 && code <= 82) return 'Hujan';
  if (code >= 95) return 'Badai';
  return 'Berawan';
}

// SINKRONISASI TAMPILAN CUACA OLED (100% PERSIS FISIK SSD1306 DENGAN DATA REALTIME)
function updateOledWeatherPreviewWithData(cityName, temp, hum, wind, cond) {
  const cityUpper = (cityName || 'JAKARTA').toUpperCase();
  const tempHtml = `${temp}<span class="oled-deg-circle"></span>`;

  const mainCity = document.getElementById('mainWeatherCity');
  const mainTemp = document.getElementById('mainWeatherTemp');
  if (mainCity) mainCity.textContent = cityUpper;
  if (mainTemp) mainTemp.innerHTML = tempHtml;

  const cityEl = document.getElementById('oledCityPreview');
  const stageCityEl = document.getElementById('stageWeatherCity');
  const detailCityEl = document.getElementById('detailWeatherCity');
  const tempEl = document.getElementById('oledTempPreview');
  const stageTempEl = document.getElementById('stageWeatherTemp');
  const detailTempEl = document.getElementById('detailWeatherTemp');

  if (cityEl) cityEl.textContent = cityUpper;
  if (stageCityEl) stageCityEl.textContent = cityUpper;
  if (detailCityEl) detailCityEl.textContent = cityUpper;
  if (tempEl) tempEl.innerHTML = tempHtml;
  if (stageTempEl) stageTempEl.innerHTML = tempHtml;
  if (detailTempEl) detailTempEl.innerHTML = tempHtml;

  const humPreview = document.getElementById('oledWeatherHumPreview');
  const windPreview = document.getElementById('oledWeatherWindPreview');
  const detailHum = document.getElementById('detailWeatherHum');
  const detailWind = document.getElementById('detailWeatherWind');
  const condPreview = document.getElementById('oledWeatherCondPreview');
  const detailCond = document.getElementById('detailWeatherCond');

  const humText = 'Lembap: ' + hum;
  const windText = 'Angin: ' + wind + ' km';

  if (humPreview) humPreview.textContent = humText;
  if (detailHum) detailHum.textContent = humText;
  if (windPreview) windPreview.textContent = windText;
  if (detailWind) detailWind.textContent = windText;

  const formatCond = cond ? (cond.charAt(0).toUpperCase() + cond.slice(1).toLowerCase()) : 'Cerah';
  if (condPreview) condPreview.textContent = formatCond;
  if (detailCond) detailCond.textContent = formatCond;
}

function updateOledWeatherPreview(city) {
  const savedTemp = localStorage.getItem('robot_cfg_temp') || '28';
  const savedHum = localStorage.getItem('robot_cfg_hum') || '75';
  const savedWind = localStorage.getItem('robot_cfg_wind') || '4';
  const savedCond = localStorage.getItem('robot_cfg_cond') || 'CERAH';
  updateOledWeatherPreviewWithData(city, savedTemp, savedHum, savedWind, savedCond);
}

// Pengaturan Satuan Suhu (Default Permanen Celsius °C)
function setTempUnit(unit) {
  currentTempUnit = 'C';
  updateOledWeatherPreview();
  localStorage.setItem('robot_cfg_temp_unit', 'C');
  sendCommand({ cmd: 'temp_unit', unit: 'C' });
}

let isSearchingCity = false;

function escapeWeatherText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Helper Fetch Antar-Platform (Bypass batasan CORS WebView via Native AndroidBLE bridge jika tersedia)
function fetchGeocoding(url) {
  return new Promise(function(resolve, reject) {
    if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function') {
      try {
        const raw = window.AndroidBLE.httpGet(url);
        if (raw && raw.length > 0) {
          const parsed = JSON.parse(raw);
          return resolve(parsed);
        }
      } catch (err) {
        console.warn('[HTTP] Native bridge error, mencoba fetch biasa:', err);
      }
    }

    fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP Status ' + res.status);
        return res.json();
      })
      .then(resolve)
      .catch(reject);
  });
}

// Pengontrol Visual & Animasi Tombol Cuaca (Hover Murni Tanpa Terjebak Selected Active)
function setWeatherBtnVisual(state, text) {
  const btns = [document.getElementById('btnSearchCity'), document.getElementById('btnSearchCitySetting')].filter(Boolean);
  const txts = [document.getElementById('txtSearchCityBtn'), document.getElementById('txtSearchCityBtnSetting')].filter(Boolean);
  const inputs = [document.getElementById('cfgCityInput'), document.getElementById('cfgCityInputSetting')].filter(Boolean);

  if (state === 'loading') {
    btns.forEach(b => {
      b.disabled = true;
      b.classList.add('disabled', 'is-loading');
      b.classList.remove('is-shaking', 'is-success');
      b.blur();
    });
    inputs.forEach(i => {
      i.classList.add('is-processing');
      i.readOnly = true;
    });
    txts.forEach(t => {
      t.innerHTML = '<span class="weather-spinner-cyber"></span> MEMPROSES CUACA...';
    });
  } else if (state === 'error') {
    btns.forEach(b => {
      b.disabled = false;
      b.classList.remove('disabled', 'is-loading');
      b.classList.add('is-shaking');
      b.blur();
    });
    inputs.forEach(i => {
      i.classList.remove('is-processing');
      i.readOnly = false;
    });
    txts.forEach(t => {
      t.textContent = text || 'KOTA TIDAK DITEMUKAN';
    });
    setTimeout(() => {
      btns.forEach(b => {
        b.classList.remove('is-shaking');
        b.blur();
      });
    }, 450);
    setTimeout(() => {
      if (!isSearchingCity) {
        txts.forEach(t => { t.textContent = 'TERAPKAN CUACA'; });
        btns.forEach(b => { b.blur(); });
      }
    }, 2400);
  } else if (state === 'success') {
    btns.forEach(b => {
      b.disabled = false;
      b.classList.remove('disabled', 'is-loading');
      b.classList.add('is-success');
      b.blur();
    });
    inputs.forEach(i => {
      i.classList.remove('is-processing');
      i.readOnly = false;
    });
    txts.forEach(t => {
      t.textContent = text || 'KOTA BERHASIL DIATUR';
    });
    setTimeout(() => {
      btns.forEach(b => {
        b.classList.remove('is-success');
        b.blur();
      });
    }, 550);
    setTimeout(() => {
      if (!isSearchingCity) {
        txts.forEach(t => { t.textContent = 'TERAPKAN CUACA'; });
        btns.forEach(b => { b.blur(); });
      }
    }, 2400);
  } else {
    btns.forEach(b => {
      b.disabled = false;
      b.classList.remove('disabled', 'is-loading', 'is-shaking', 'is-success');
      b.blur();
    });
    inputs.forEach(i => {
      i.classList.remove('is-processing');
      i.readOnly = false;
    });
    txts.forEach(t => {
      t.textContent = 'TERAPKAN CUACA';
    });
  }
}

// Live Autocomplete Pencarian Kota (Menampilkan Pilihan Dropdown di Seluruh Dunia)
function searchCitySuggestions(query, isSetting) {
  const dropdown = document.getElementById(isSetting ? 'cityDropdownSetting' : 'cityDropdown');
  if (!dropdown) return;

  const clean = (query || '').trim();
  if (clean.length < 2) {
    dropdown.innerHTML = '';
    dropdown.style.display = 'none';
    return;
  }

  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(clean) + '&count=6&language=id&format=json';

  fetchGeocoding(url)
    .then(function(data) {
      const results = (data && data.results) ? data.results : [];
      if (results.length === 0) {
        dropdown.innerHTML = '<div class="city-item-empty">Tidak ada kota yang cocok</div>';
        dropdown.style.display = 'block';
        return;
      }

      dropdown.innerHTML = '';
      results.forEach(function(item) {
        const row = document.createElement('div');
        row.className = 'city-autocomplete-item';

        const nameEl = document.createElement('span');
        nameEl.className = 'city-item-name';
        nameEl.textContent = item.name.toUpperCase();

        const descParts = [item.admin1, item.country].filter(Boolean);
        const descEl = document.createElement('span');
        descEl.className = 'city-item-desc';
        descEl.textContent = descParts.join(', ');

        row.appendChild(nameEl);
        row.appendChild(descEl);

        row.addEventListener('click', function() {
          selectedCityData = item;
          const displayLabel = item.name + (item.country ? (', ' + item.country) : '');

          const inputMain = document.getElementById('cfgCityInput');
          const inputSet = document.getElementById('cfgCityInputSetting');
          if (inputMain) inputMain.value = displayLabel;
          if (inputSet) inputSet.value = displayLabel;

          dropdown.style.display = 'none';
          triggerHaptic(20);
        });

        dropdown.appendChild(row);
      });

      dropdown.style.display = 'block';
    })
    .catch(function(err) {
      console.warn('Autocomplete fetch failed:', err);
    });
}

// Eksekusi Terapkan Cuaca (Animasi Terjamin Minimal 3 Detik & Sinkron 100% Real-Time)
function applyWeatherCity(isFromSetting) {
  if (isSearchingCity) return;

  const activeInput = isFromSetting ?
    (document.getElementById('cfgCityInputSetting') || document.getElementById('cfgCityInput')) :
    (document.getElementById('cfgCityInput') || document.getElementById('cfgCityInputSetting'));

  if (!activeInput) return;
  
  // Jika input kosong, gunakan nama kota yang tersimpan atau default BANDUNG
  let rawQuery = (activeInput.value || '').trim();
  if (!rawQuery) {
    const saved = localStorage.getItem('robot_cfg_city') || 'BANDUNG';
    activeInput.value = saved;
    rawQuery = saved;
  }

  const MIN_ANIMATION_MS = 3000;
  const startTime = Date.now();

  isSearchingCity = true;
  setWeatherBtnVisual('loading');
  triggerHaptic(25);

  if (rawQuery.length < 2) {
    const elapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);
    setTimeout(() => {
      isSearchingCity = false;
      setWeatherBtnVisual('error', 'NAMA KOTA HARUS DIISI');
      triggerHaptic(50);
      setTimeout(() => triggerHaptic(50), 120);
    }, remainingTime);
    return;
  }

  // Jika belum memilih dari dropdown, resolve koordinat terlebih dahulu
  let resolvePromise;
  if (selectedCityData && selectedCityData.name && rawQuery.toLowerCase().includes(selectedCityData.name.toLowerCase())) {
    resolvePromise = Promise.resolve(selectedCityData);
  } else {
    let clean = rawQuery.toLowerCase();
    let targetCity = clean;
    let targetCountry = '';
    if (clean.includes(',')) {
      const parts = clean.split(',');
      targetCity = parts[0].trim();
      targetCountry = parts[1].trim();
    }

    const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(targetCity) + '&count=8&language=id&format=json';
    resolvePromise = fetchGeocoding(geoUrl).then(function(data) {
      const rawResults = (data && data.results) ? data.results : [];
      if (rawResults.length === 0) return null;

      let exact = rawResults.filter(item => item.name && item.name.toLowerCase() === targetCity);
      if (exact.length === 0) exact = rawResults;

      exact.sort((a, b) => (b.population || 0) - (a.population || 0));
      return exact[0];
    });
  }

  resolvePromise
    .then(function(cityItem) {
      if (!cityItem) {
        throw new Error('NOT_FOUND');
      }

      selectedCityData = cityItem;
      const cityName = (cityItem.name || rawQuery).toUpperCase();
      const lat = parseFloat(cityItem.latitude);
      const lon = parseFloat(cityItem.longitude);
      const tz = cityItem.timezone || 'auto';

      // AMBIL CUACA REALTIME SEBENARNYA DARI SATELIT OPEN-METEO
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
                         '&longitude=' + lon +
                         '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto';

      return fetchGeocoding(weatherUrl)
        .then(function(wData) {
          if (!wData || !wData.current) {
            throw new Error('WEATHER_FAIL');
          }

          // Pastikan animasi berjalan minimal 3000ms penuh
          const elapsed = Date.now() - startTime;
          const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);

          return new Promise(function(resolve) {
            setTimeout(function() {
              resolve({ wData: wData, cityName: cityName, lat: lat, lon: lon, tz: tz });
            }, remainingTime);
          });
        })
        .then(function(res) {
          const cur = res.wData.current;
          const temp = Math.round(cur.temperature_2m);
          const hum = Math.round(cur.relative_humidity_2m);
          const wind = Math.round(cur.wind_speed_10m);
          const code = cur.weather_code;
          const cond = getWeatherConditionText(code);

          // 1. UPDATE LAYAR OLED PREVIEW DI HP DENGAN DATA ASLI REALTIME
          updateOledWeatherPreviewWithData(res.cityName, temp, hum, wind, cond);

          // 2. SIMPAN PREFERENSI KE HP
          localStorage.setItem('robot_cfg_city', res.cityName);
          localStorage.setItem('robot_cfg_lat', res.lat);
          localStorage.setItem('robot_cfg_lon', res.lon);
          localStorage.setItem('robot_cfg_tz', res.tz);
          localStorage.setItem('robot_cfg_temp', temp);
          localStorage.setItem('robot_cfg_hum', hum);
          localStorage.setItem('robot_cfg_wind', wind);
          localStorage.setItem('robot_cfg_cond', cond);
          localStorage.setItem('robot_cfg_temp_unit', 'C');

          // 3. KIRIM DATA REALTIME LENGKAP VIA BLE KE ROBOT ESP32 (SINKRONISASI 100%)
          sendCommand({
            cmd: 'set_weather_live',
            city: res.cityName,
            temp: temp,
            hum: hum,
            wind: wind,
            code: code,
            lat: res.lat,
            lon: res.lon,
            tz: res.tz
          });

          // 4. EFEK SUKSES PADA TOMBOL & HAPTIC
          isSearchingCity = false;
          setWeatherBtnVisual('success', 'KOTA BERHASIL DIATUR');
          triggerHaptic(35);
        });
    })
    .catch(function(err) {
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);
      setTimeout(function() {
        isSearchingCity = false;
        const msg = (err && err.message === 'NOT_FOUND') ? 'KOTA TIDAK DITEMUKAN' : 'KONEKSI INTERNET GAGAL';
        setWeatherBtnVisual('error', msg);
        triggerHaptic(60);
        setTimeout(() => triggerHaptic(60), 120);
      }, remainingTime);
    });
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
  const savedCity = localStorage.getItem('robot_cfg_city') || 'BANDUNG';
  const savedTemp = localStorage.getItem('robot_cfg_temp') || '26';
  const savedHum = localStorage.getItem('robot_cfg_hum') || '75';
  const savedWind = localStorage.getItem('robot_cfg_wind') || '4';
  const savedCond = localStorage.getItem('robot_cfg_cond') || 'CERAH';
  
  const input = document.getElementById('cfgCityInput');
  if (input) input.value = savedCity;
  const inputSet = document.getElementById('cfgCityInputSetting');
  if (inputSet) inputSet.value = savedCity;

  updateOledWeatherPreviewWithData(savedCity, savedTemp, savedHum, savedWind, savedCond);

  // Mencegah Tombol Terjebak State Active/Selected di Layar Sentuh Mobile (Murni Hover)
  ['btnSearchCity', 'btnSearchCitySetting'].forEach(function(btnId) {
    const el = document.getElementById(btnId);
    if (el) {
      el.addEventListener('pointerup', function() { el.blur(); });
      el.addEventListener('touchend', function() { el.blur(); });
      el.addEventListener('mouseleave', function() { el.blur(); });
    }
  });

  // Pasang Live Autocomplete pada Input Pencarian Kota
  const setupCityInputListener = (inputId, isSetting) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', (e) => {
      const q = e.target.value;
      if (citySearchTimer) clearTimeout(citySearchTimer);
      citySearchTimer = setTimeout(() => {
        searchCitySuggestions(q, isSetting);
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dropdown = document.getElementById(isSetting ? 'cityDropdownSetting' : 'cityDropdown');
        if (dropdown) dropdown.style.display = 'none';
        applyWeatherCity(isSetting);
      }
    });
  };
  setupCityInputListener('cfgCityInput', false);
  setupCityInputListener('cfgCityInputSetting', true);

  // Tutup dropdown jika klik di luar
  document.addEventListener('click', (e) => {
    const d1 = document.getElementById('cityDropdown');
    const d2 = document.getElementById('cityDropdownSetting');
    const i1 = document.getElementById('cfgCityInput');
    const i2 = document.getElementById('cfgCityInputSetting');
    if (d1 && !d1.contains(e.target) && e.target !== i1) d1.style.display = 'none';
    if (d2 && !d2.contains(e.target) && e.target !== i2) d2.style.display = 'none';
  });

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
  initSpotifyFeature();

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

// =========================================================================
// SPOTIFY MUSIK & LIRIK REALTIME (LRCLIB + ANDROID MEDIASESSION)
// =========================================================================

let currentSpotifyState = {
  title: '',
  artist: '',
  positionSec: 0,
  durationSec: 0,
  isPlaying: false,
  lastUpdateTimestamp: 0
};

let currentLyricsLines = []; // Array of { timeSec: number, text: string }
let currentLyricsTrackKey = '';
let lastSentLyricLine = '';
let lastSentSpotifyPos = -1;
let spotifySyncLoopTimer = null;
let isFetchingLyrics = false;

function formatAudioTime(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseLrcLyrics(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = lrcText.split('\n');
  const result = [];
  const regex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = regex.exec(trimmed);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseFloat(match[2]);
      const timeSec = min * 60 + sec;
      const text = match[3].trim();
      if (text.length > 0) {
        result.push({ timeSec, text });
      }
    }
  }

  result.sort((a, b) => a.timeSec - b.timeSec);
  return result;
}

function fetchLrclibLyrics(title, artist, durationSec) {
  if (!title || title.trim().length === 0) return;
  const trackKey = (title + '::' + artist).toLowerCase();
  if (trackKey === currentLyricsTrackKey && currentLyricsLines.length > 0) return;
  if (isFetchingLyrics) return;

  isFetchingLyrics = true;
  currentLyricsTrackKey = trackKey;
  currentLyricsLines = [];

  const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = artist.replace(/\(.*?\)|\[.*?\]/g, '').trim();

  // Buat URL LRCLIB API gratis
  const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}&duration=${Math.round(durationSec || 0)}`;

  const handleResponseText = (responseText) => {
    isFetchingLyrics = false;
    if (!responseText) {
      searchLrclibFallback(cleanTitle, cleanArtist);
      return;
    }
    try {
      const json = JSON.parse(responseText);
      if (json.syncedLyrics && json.syncedLyrics.length > 0) {
        currentLyricsLines = parseLrcLyrics(json.syncedLyrics);
        updateSpotifyDetailUI();
      } else if (json.plainLyrics && json.plainLyrics.length > 0) {
        const rawLines = json.plainLyrics.split('\n').filter(l => l.trim().length > 0);
        currentLyricsLines = rawLines.map((l, idx) => ({
          timeSec: idx * 4,
          text: l.trim()
        }));
        updateSpotifyDetailUI();
      } else {
        searchLrclibFallback(cleanTitle, cleanArtist);
      }
    } catch (e) {
      searchLrclibFallback(cleanTitle, cleanArtist);
    }
  };

  if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function') {
    setTimeout(() => {
      try {
        const resp = window.AndroidBLE.httpGet(getUrl);
        handleResponseText(resp);
      } catch (err) {
        isFetchingLyrics = false;
      }
    }, 10);
  } else {
    fetch(getUrl)
      .then(res => res.ok ? res.text() : null)
      .then(handleResponseText)
      .catch(() => {
        isFetchingLyrics = false;
      });
  }
}

function searchLrclibFallback(title, artist) {
  const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const handleSearchResults = (responseText) => {
    if (!responseText) return;
    try {
      const results = JSON.parse(responseText);
      if (Array.isArray(results) && results.length > 0) {
        for (let i = 0; i < results.length; i++) {
          if (results[i].syncedLyrics && results[i].syncedLyrics.length > 0) {
            currentLyricsLines = parseLrcLyrics(results[i].syncedLyrics);
            updateSpotifyDetailUI();
            return;
          }
        }
      }
    } catch (ignored) {}
  };

  if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function') {
    setTimeout(() => {
      try {
        const resp = window.AndroidBLE.httpGet(searchUrl);
        handleSearchResults(resp);
      } catch (ignored) {}
    }, 10);
  } else {
    fetch(searchUrl)
      .then(res => res.ok ? res.text() : null)
      .then(handleSearchResults)
      .catch(() => {});
  }
}

function getActiveLyricAtTime(sec) {
  if (!currentLyricsLines || currentLyricsLines.length === 0) return '';
  let activeText = '';
  for (let i = 0; i < currentLyricsLines.length; i++) {
    if (currentLyricsLines[i].timeSec <= sec) {
      activeText = currentLyricsLines[i].text;
    } else {
      break;
    }
  }
  return activeText;
}

function updateSpotifyPermissionUI() {
  const banner = document.getElementById('spotifyPermBanner');
  if (!banner) return;
  if (window.AndroidBLE && typeof window.AndroidBLE.isMusicNotificationGranted === 'function') {
    const granted = window.AndroidBLE.isMusicNotificationGranted();
    banner.style.display = granted ? 'none' : 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function openSpotifyPermissionSettings() {
  triggerHaptic(30);
  if (window.AndroidBLE && typeof window.AndroidBLE.openMusicNotificationSettings === 'function') {
    window.AndroidBLE.openMusicNotificationSettings();
  } else {
    showNeonToast('Buka Pengaturan HP > Akses Notifikasi');
  }
}

function mediaControlAction(action) {
  triggerHaptic(35);
  if (window.AndroidBLE) {
    if (action === 'play_pause' && typeof window.AndroidBLE.mediaPlayPause === 'function') {
      window.AndroidBLE.mediaPlayPause();
      currentSpotifyState.isPlaying = !currentSpotifyState.isPlaying;
      updateSpotifyPlayPauseIcon(currentSpotifyState.isPlaying);
    } else if (action === 'next' && typeof window.AndroidBLE.mediaNext === 'function') {
      window.AndroidBLE.mediaNext();
      showNeonToast('Lagu Berikutnya');
    } else if (action === 'prev' && typeof window.AndroidBLE.mediaPrev === 'function') {
      window.AndroidBLE.mediaPrev();
      showNeonToast('Lagu Sebelumnya');
    }
  } else {
    showNeonToast('Perintah Media: ' + action);
  }
}

function updateSpotifyPlayPauseIcon(isPlaying) {
  const iconPlay = document.getElementById('iconMediaPlay');
  const iconPause = document.getElementById('iconMediaPause');
  if (iconPlay && iconPause) {
    if (isPlaying) {
      iconPlay.style.display = 'none';
      iconPause.style.display = 'block';
    } else {
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
    }
  }
}

function updateSpotifyDetailUI() {
  const trackName = currentSpotifyState.title || 'Belum Ada Musik';
  const artistName = currentSpotifyState.artist || 'Buka Spotify di HP';
  const isPlaying = currentSpotifyState.isPlaying;

  // 1. OLED Stage Track Info
  const trackEl = document.getElementById('stageSpotifyTrack');
  if (trackEl) {
    trackEl.textContent = currentSpotifyState.title ? `${currentSpotifyState.title} - ${artistName}` : 'Spotify Standby';
  }

  // 2. Info Box Control
  const infoTrack = document.getElementById('spInfoTrack');
  const infoArtist = document.getElementById('spInfoArtist');
  if (infoTrack) infoTrack.textContent = trackName;
  if (infoArtist) infoArtist.textContent = artistName;

  // 3. Play / Pause Button
  updateSpotifyPlayPauseIcon(isPlaying);

  // 4. Progress & Time
  const now = Date.now();
  const elapsed = (isPlaying && currentSpotifyState.lastUpdateTimestamp > 0)
    ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
    : 0;
  const curPos = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);
  const durSec = currentSpotifyState.durationSec;

  const curTimeEl = document.getElementById('stageSpotifyCurrentTime');
  const totTimeEl = document.getElementById('stageSpotifyTotalTime');
  const progFill = document.getElementById('stageSpotifyProgressFill');

  if (curTimeEl) curTimeEl.textContent = formatAudioTime(curPos);
  if (totTimeEl) totTimeEl.textContent = formatAudioTime(durSec);
  if (progFill) {
    const pct = (durSec > 0) ? Math.min(100, Math.max(0, (curPos / durSec) * 100)) : 0;
    progFill.style.width = pct + '%';
  }

  // 5. Lyrics / Equalizer display
  const lyricsWrap = document.getElementById('stageSpotifyLyricsWrap');
  const eqWrap = document.getElementById('stageSpotifyEqWrap');
  const lyric1 = document.getElementById('stageSpotifyLyric1');
  const lyric2 = document.getElementById('stageSpotifyLyric2');

  const activeLyric = getActiveLyricAtTime(curPos);

  if (activeLyric && activeLyric.length > 0) {
    if (lyricsWrap) lyricsWrap.style.display = 'flex';
    if (eqWrap) eqWrap.style.display = 'none';

    if (activeLyric.includes('\n')) {
      const parts = activeLyric.split('\n');
      if (lyric1) lyric1.textContent = parts[0] || '';
      if (lyric2) lyric2.textContent = parts[1] || '';
    } else if (activeLyric.length > 20) {
      let splitIdx = 20;
      while (splitIdx > 8 && activeLyric[splitIdx] !== ' ') {
        splitIdx--;
      }
      if (activeLyric[splitIdx] !== ' ') splitIdx = 20;
      if (lyric1) lyric1.textContent = activeLyric.substring(0, splitIdx);
      if (lyric2) lyric2.textContent = activeLyric.substring(splitIdx).trim();
    } else {
      if (lyric1) lyric1.textContent = activeLyric;
      if (lyric2) lyric2.textContent = '';
    }
  } else {
    if (isPlaying) {
      if (lyricsWrap) lyricsWrap.style.display = 'none';
      if (eqWrap) eqWrap.style.display = 'flex';
    } else {
      if (lyricsWrap) lyricsWrap.style.display = 'flex';
      if (eqWrap) eqWrap.style.display = 'none';
      if (lyric1) lyric1.textContent = currentSpotifyState.title ? 'Musik Dijeda' : 'Buka Spotify di HP';
      if (lyric2) lyric2.textContent = currentSpotifyState.title ? '' : 'Lirik akan sinkron otomatis';
    }
  }

  updateSpotifyPreviewCard(curPos);
}

function updateSpotifyPreviewCard(curPos) {
  const pTitle = document.getElementById('oledSpPreviewTitle');
  const pLyric = document.getElementById('oledSpPreviewLyric');
  if (pTitle) {
    pTitle.textContent = currentSpotifyState.title || 'SPOTIFY';
  }
  if (pLyric) {
    const activeLyric = getActiveLyricAtTime(curPos || currentSpotifyState.positionSec);
    pLyric.textContent = activeLyric || (currentSpotifyState.artist || 'Sentuh utk buka');
  }
}

function startSpotifySyncLoop() {
  if (spotifySyncLoopTimer) clearInterval(spotifySyncLoopTimer);
  spotifySyncLoopTimer = setInterval(() => {
    const isPlaying = currentSpotifyState.isPlaying;
    const now = Date.now();
    const elapsed = (isPlaying && currentSpotifyState.lastUpdateTimestamp > 0)
      ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
      : 0;
    const curPos = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);
    const intPos = Math.floor(curPos);

    if (currentOpenDetailFeature === 'spotify') {
      updateSpotifyDetailUI();
    } else {
      updateSpotifyPreviewCard(curPos);
    }

    if (isBleConnected && currentRobotMode === 17 && currentSpotifyState.title) {
      const activeLyric = getActiveLyricAtTime(curPos);
      if (intPos !== lastSentSpotifyPos || activeLyric !== lastSentLyricLine) {
        sendCommand({
          c: 'spotify',
          t: currentSpotifyState.title,
          a: currentSpotifyState.artist,
          l: activeLyric,
          p: intPos,
          d: Math.floor(currentSpotifyState.durationSec),
          play: isPlaying
        });
        lastSentSpotifyPos = intPos;
        lastSentLyricLine = activeLyric;
      }
    }
  }, 500);
}

window.onMusicStateChanged = function(data) {
  if (!data) return;

  const title = (data.title || '').trim();
  const artist = (data.artist || '').trim();
  const pos = typeof data.pos === 'number' ? data.pos : 0;
  const dur = typeof data.dur === 'number' ? data.dur : 0;
  const isPlaying = !!data.play;

  const trackChanged = (title !== currentSpotifyState.title || artist !== currentSpotifyState.artist);

  currentSpotifyState.title = title;
  currentSpotifyState.artist = artist;
  currentSpotifyState.positionSec = pos;
  currentSpotifyState.durationSec = dur;
  currentSpotifyState.isPlaying = isPlaying;
  currentSpotifyState.lastUpdateTimestamp = Date.now();

  if (trackChanged && title.length > 0) {
    lastSentLyricLine = '';
    lastSentSpotifyPos = -1;
    fetchLrclibLyrics(title, artist, dur);
  }

  updateSpotifyDetailUI();

  if (isBleConnected && currentRobotMode === 17 && title.length > 0) {
    const activeLyric = getActiveLyricAtTime(pos);
    sendCommand({
      c: 'spotify',
      t: title,
      a: artist,
      l: activeLyric,
      p: Math.floor(pos),
      d: Math.floor(dur),
      play: isPlaying
    });
    lastSentSpotifyPos = Math.floor(pos);
    lastSentLyricLine = activeLyric;
  }
};

function initSpotifyFeature() {
  updateSpotifyPermissionUI();
  updateSpotifyDetailUI();
  startSpotifySyncLoop();
  if (window.AndroidBLE && typeof window.AndroidBLE.requestMusicSync === 'function') {
    window.AndroidBLE.requestMusicSync();
  }
}
