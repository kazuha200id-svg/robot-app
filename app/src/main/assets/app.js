/* ========================================================
   ROBOT DESK APP CONTROLLER (STRICT BLUETOOTH GATE)
   ======================================================== */

let isBleConnected = false;
let s_isRebooting = false;
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

// ================= 1. TOAST NOTIFICATION =================
function showNeonToast(message) {
  if (!message) return;
  const toast = document.getElementById('neonToast');
  const txt = document.getElementById('toastText');
  if (!toast || !txt) return;
  txt.textContent = message;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// HAPTIC FEEDBACK (NON-BLOCKING ASYNC)
function triggerHaptic(durationMs = 25) {
  setTimeout(() => {
    try {
      if (window.AndroidBLE && typeof window.AndroidBLE.vibrate === 'function') {
        window.AndroidBLE.vibrate(durationMs);
      } else if ('vibrate' in navigator) {
        navigator.vibrate(durationMs);
      }
    } catch (ignored) {}
  }, 0);
}

// ================= 2. 4-TAB NAVIGATION =================
function switchMainTab(pageId, btn) {
  currentMainTab = pageId;

  // Tutup detail fitur jika meninggalkan tab Robot saat detail terbuka
  if (pageId !== 'pageRobot' && currentOpenDetailFeature !== null) {
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
  } else {
    const matchingBtn = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
    if (matchingBtn) matchingBtn.classList.add('active');
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



// ================= 3. BLE COMMAND DISPATCH (DENGAN ANTRIAN RESPONSIF ANTI-LAG) =================
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
  try {
    if (window.AndroidBLE && typeof window.AndroidBLE.send === 'function') {
      window.AndroidBLE.send(jsonStr);
    } else {
      console.log('[MOCK BLE SEND]', jsonStr);
    }
  } catch (e) {
    console.error('[BLE SEND ERR]', e);
  }
  // Jeda 50ms antar paket agar throughput BLE lancar dan responsif
  setTimeout(processNextBleCommand, 50);
}

function sendCommand(cmdObject, priority = false) {
  if (!cmdObject) return false;
  // Kapasitas antrean BLE hingga 32 agar batch paket crypto & kurs tidak terpotong
  if (bleCommandQueue.length >= 32) {
    bleCommandQueue.shift();
  }
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

  // Jika koneksi terputus mendadak sebelum proses selesai, gagalkan dan jangan izinkan masuk
  if (!isBleConnected) {
    finalizeFailed();
    return;
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
    if (!isBleConnected) {
      if (gate && !hasSavedRobot()) gate.classList.add('active');
      return;
    }
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
  const gate = document.getElementById('setupGate');
  if (gate) gate.classList.add('active');
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

    if (hasSavedRobot() && !s_forceSetupGate) {
      if (gate) gate.classList.remove('active');
    }

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
  if (connected) s_forceSetupGate = false;
  const gate = document.getElementById('setupGate');

  document.querySelectorAll('.oled-status-ble').forEach(el => {
    if (connected) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  });

  if (connected) {
    if (s_isRebooting) {
      s_isRebooting = false;
      if (s_rebootTimer) {
        clearInterval(s_rebootTimer);
        s_rebootTimer = null;
      }
      const overlay = document.getElementById('overlayRebootProgress');
      if (overlay) {
        overlay.classList.remove('failed');
        overlay.style.display = 'none';
      }
      showNeonToast('Robot berhasil terhubung kembali');
      triggerHaptic(40);
    }

    localStorage.setItem('robot_saved_mac', 'connected');
    localStorage.setItem('robot_saved_name', 'Robot Desk');

    // Sinkronkan detik jam HP ke robot seketika saat tersambung agar realtime tanpa jeda
    syncClockQuiet();

    // Sinkronkan jadwal sholat resmi Kemenag RI ke robot seketika saat tersambung
    syncPrayerQuiet();

    // Sinkronkan data Kurs Live & Crypto terkini secara tenang saat tersambung
    fetchKursLiveRates();
    fetchCryptoLivePrices();

    if (isConnecting) {
      const elapsed = Date.now() - connectStartTime;
      const remaining = Math.max(0, 3000 - elapsed);
      setTimeout(() => {
        finalizeSuccess();
      }, remaining);
    } else {
      if (gate) gate.classList.remove('active');
      setTimeout(() => {
        sendCommand({ c: 's' });
      }, 300);
    }
  } else {
    if (!isConnecting && gate) {
      if (!hasSavedRobot() || s_forceSetupGate) {
        gate.classList.add('active');
        const isBtOn = (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') ? window.AndroidBLE.isBluetoothEnabled() : true;
        updateSetupGateView(isBtOn);
      } else {
        // Jika robot sudah tersimpan, jangan tutupi layar dengan setup gate!
        gate.classList.remove('active');
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

    if (typeof data.sleep_to === 'number') {
      const activeSleepBadge = document.getElementById('txtActiveSleepBadge');
      const textVal = data.sleep_to === 0 ? 'SELALU NYALA' : `${Math.round(data.sleep_to / 60)} MENIT`;
      if (activeSleepBadge) activeSleepBadge.textContent = textVal;

      document.querySelectorAll('.setting-pill-btn').forEach(btn => {
        const sec = parseInt(btn.getAttribute('data-sec'), 10);
        btn.classList.toggle('active', sec === data.sleep_to);
      });
    }

    // Pembaruan navigasi real-time dari robot ESP32
    if (data.nav) {
      const n = data.nav;
      if (typeof updateOledNavLiveDisplay === 'function') {
        updateOledNavLiveDisplay(n.act, n.dist, n.inst, n.street, n.rem, n.time, n.spd);
      }
    }

    // Pembaruan jadwal sholat real-time dari robot ESP32
    if (data.prayer) {
      const p = data.prayer;
      if (typeof updateOledPrayerPreviewWithData === 'function') {
        updateOledPrayerPreviewWithData(p.city, p.imsak, p.subuh, p.dzuhur, p.ashar, p.maghrib, p.isya);
      }
    }

    // Pembaruan crypto / saham ticker real-time dari robot ESP32 (Sinkronisasi Dua Arah)
    if (data.status === 'crypto_cycle' || data.status === 'crypto_sync' || typeof data.coin === 'number' || (data.crypto && typeof data.crypto.coin === 'number')) {
      const rotIdx = (typeof data.idx === 'number')
        ? data.idx
        : ((data.crypto && typeof data.crypto.coin === 'number') ? data.crypto.coin : (typeof data.coin === 'number' ? data.coin : 0));
      const total = (typeof configuredCryptoCoins !== 'undefined' && typeof configuredStocks !== 'undefined')
        ? (configuredCryptoCoins.length + configuredStocks.length)
        : 10;
      if (rotIdx >= 0 && rotIdx < total) {
        currentVirtualRotationIndex = rotIdx;
        if (typeof updateOledCryptoPreview === 'function') updateOledCryptoPreview();
      }
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

    // Alarm config sync (sinkronisasi dua arah real-time antara OLED robot & aplikasi)
    if (data.alarm) {
      if (typeof data.alarm.hour === 'number') {
        g_alarmHour = data.alarm.hour;
        localStorage.setItem('robot_cfg_alarm_h', String(g_alarmHour));
        const hEl = document.getElementById('alarmHour');
        if (hEl) hEl.value = String(data.alarm.hour).padStart(2, '0');
      }
      if (typeof data.alarm.min === 'number') {
        g_alarmMin = data.alarm.min;
        localStorage.setItem('robot_cfg_alarm_m', String(g_alarmMin));
        const mEl = document.getElementById('alarmMin');
        if (mEl) mEl.value = String(data.alarm.min).padStart(2, '0');
      }
      if (typeof data.alarm.enabled === 'boolean') {
        g_alarmEnabled = data.alarm.enabled;
        localStorage.setItem('robot_cfg_alarm_en', g_alarmEnabled ? '1' : '0');
        const enEl = document.getElementById('alarmEnabledToggle');
        if (enEl) enEl.checked = data.alarm.enabled;
      }
      if (typeof data.alarm.daily === 'boolean') {
        g_alarmDaily = data.alarm.daily;
        localStorage.setItem('robot_cfg_alarm_daily', g_alarmDaily ? '1' : '0');
        const dEl = document.getElementById('alarmDailyToggle');
        if (dEl) dEl.checked = data.alarm.daily;
      }
      renderAlarmOledAndControls();
      updateOledAlarmPreview();
    }
  } catch (e) {
    console.error('Failed to parse incoming BLE JSON', e);
  }
};

// ================= 5. FEATURE ACTION HANDLERS =================

// Definisi 20 Grafis & Mood Wajah OLED Robot (100% Sesuai Layar OLED SSD1306 & TASK.md)
const OLED_FACES = [
  // --- KATEGORI 1: STANDBY (0..4) ---
  {
    name: 'Kedip',
    cat: 'STANDBY',
    svg: '<rect x="24" y="6" width="32" height="34" rx="8" fill="#00F0FF" stroke="none"/><circle cx="48" cy="14" r="3" fill="#02060c" stroke="none"/><rect x="72" y="6" width="32" height="34" rx="8" fill="#00F0FF" stroke="none"/><circle cx="80" cy="14" r="3" fill="#02060c" stroke="none"/><path d="M54 46 Q64 54 74 46" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Lirik',
    cat: 'STANDBY',
    svg: '<rect x="18" y="6" width="32" height="34" rx="8" fill="#00F0FF" stroke="none"/><circle cx="42" cy="14" r="3" fill="#02060c" stroke="none"/><rect x="66" y="6" width="32" height="34" rx="8" fill="#00F0FF" stroke="none"/><circle cx="74" cy="14" r="3" fill="#02060c" stroke="none"/><path d="M54 46 Q64 54 74 46" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Sedih',
    cat: 'STANDBY',
    svg: '<path d="M24 18 L56 10 Q56 40 48 40 L32 40 Q24 40 24 32 Z" fill="#00F0FF" stroke="none"/><path d="M72 10 L104 18 Q104 32 104 40 L80 40 Q72 40 72 32 Z" fill="#00F0FF" stroke="none"/><ellipse cx="52" cy="34" rx="2.5" ry="3.5" fill="#00F0FF" stroke="none"/><path d="M54 52 Q64 45 74 52" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Cemberut',
    cat: 'STANDBY',
    svg: '<rect x="32" y="14" width="32" height="20" rx="5" fill="#00F0FF" stroke="none"/><rect x="54" y="18" width="6" height="12" fill="#02060c" stroke="none"/><rect x="80" y="14" width="32" height="20" rx="5" fill="#00F0FF" stroke="none"/><rect x="102" y="18" width="6" height="12" fill="#02060c" stroke="none"/><circle cx="22" cy="28" r="6.5" fill="#00F0FF" stroke="none"/><circle cx="11" cy="36" r="2.5" fill="#00F0FF" stroke="none"/><circle cx="7" cy="39" r="1.8" fill="#00F0FF" stroke="none"/><ellipse cx="68" cy="47" rx="6" ry="3.5" fill="#00F0FF" stroke="none"/><ellipse cx="68" cy="47" rx="3" ry="1.5" fill="#02060c" stroke="none"/>'
  },
  {
    name: 'Tidur',
    cat: 'STANDBY',
    svg: '<path d="M27 28 Q40 41 53 28" fill="none" stroke="#00F0FF" stroke-width="3.5" stroke-linecap="round"/><path d="M75 28 Q88 41 101 28" fill="none" stroke="#00F0FF" stroke-width="3.5" stroke-linecap="round"/><text x="102" y="20" fill="#00F0FF" stroke="none" font-family="monospace" font-size="10" font-weight="bold">z</text><text x="113" y="14" fill="#00F0FF" stroke="none" font-family="monospace" font-size="14" font-weight="bold">Z</text><line x1="58" y1="47" x2="70" y2="47" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },

  // --- KATEGORI 2: TAP SENSOR (5..9) ---
  {
    name: 'Mikir',
    cat: 'TAP',
    svg: '<rect x="28" y="5" width="28" height="28" rx="7" fill="#00F0FF" stroke="none"/><circle cx="50" cy="11" r="2.5" fill="#02060c" stroke="none"/><rect x="76" y="5" width="30" height="30" rx="7" fill="#00F0FF" stroke="none"/><circle cx="98" cy="11" r="2.5" fill="#02060c" stroke="none"/><text x="110" y="16" fill="#00F0FF" stroke="none" font-family="monospace" font-size="15" font-weight="bold">?</text><path d="M56 49 Q64 49 72 45" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Serius',
    cat: 'TAP',
    svg: '<rect x="24" y="12" width="32" height="22" fill="#00F0FF" stroke="none"/><rect x="42" y="16" width="7" height="14" fill="#02060c" stroke="none"/><rect x="72" y="12" width="32" height="22" fill="#00F0FF" stroke="none"/><rect x="79" y="16" width="7" height="14" fill="#02060c" stroke="none"/><line x1="56" y1="47" x2="72" y2="47" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Malu',
    cat: 'TAP',
    svg: '<rect x="27" y="12" width="30" height="26" rx="6" fill="#00F0FF" stroke="none"/><circle cx="45" cy="30" r="3" fill="#02060c" stroke="none"/><rect x="71" y="12" width="30" height="26" rx="6" fill="#00F0FF" stroke="none"/><circle cx="83" cy="30" r="3" fill="#02060c" stroke="none"/><line x1="18" y1="34" x2="21" y2="28" stroke="#00F0FF" stroke-width="2"/><line x1="22" y1="34" x2="25" y2="28" stroke="#00F0FF" stroke-width="2"/><line x1="26" y1="34" x2="29" y2="28" stroke="#00F0FF" stroke-width="2"/><line x1="102" y1="34" x2="105" y2="28" stroke="#00F0FF" stroke-width="2"/><line x1="106" y1="34" x2="109" y2="28" stroke="#00F0FF" stroke-width="2"/><line x1="110" y1="34" x2="113" y2="28" stroke="#00F0FF" stroke-width="2"/><path d="M56 47 Q64 53 72 47" fill="none" stroke="#00F0FF" stroke-width="2" stroke-linecap="round"/>'
  },
  {
    name: 'Keren',
    cat: 'TAP',
    svg: '<rect x="24" y="8" width="32" height="28" rx="4" fill="#00F0FF" stroke="none"/><rect x="26" y="12" width="28" height="22" fill="#02060c" stroke="none"/><rect x="36" y="14" width="4" height="18" fill="#00F0FF" stroke="none"/><rect x="54" y="12" width="20" height="5" fill="#00F0FF" stroke="none"/><rect x="72" y="8" width="32" height="28" rx="4" fill="#00F0FF" stroke="none"/><rect x="74" y="12" width="28" height="22" fill="#02060c" stroke="none"/><rect x="84" y="14" width="4" height="18" fill="#00F0FF" stroke="none"/><path d="M56 49 Q64 49 72 45" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Genit',
    cat: 'TAP',
    svg: '<path d="M26 26 Q40 12 54 26" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round"/><circle cx="26" cy="32" r="3" fill="#00F0FF" stroke="none"/><rect x="72" y="6" width="32" height="34" rx="8" fill="#00F0FF" stroke="none"/><circle cx="80" cy="14" r="3" fill="#02060c" stroke="none"/><circle cx="94" cy="28" r="2" fill="#02060c" stroke="none"/><path d="M56 46 Q64 54 72 46 Z" fill="#00F0FF" stroke="none"/>'
  },

  // --- KATEGORI 3: TAHAN SENSOR (10..14) ---
  {
    name: 'Imut',
    cat: 'TAHAN',
    svg: '<path d="M26 25 Q40 11 54 25" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="30" r="3.5" fill="#00F0FF" stroke="none"/><path d="M74 25 Q88 11 102 25" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round"/><circle cx="104" cy="30" r="3.5" fill="#00F0FF" stroke="none"/><path d="M56 46 Q64 54 72 46 Z" fill="#00F0FF" stroke="none"/>'
  },
  {
    name: 'Tertawa',
    cat: 'TAHAN',
    svg: '<path d="M28 14 L46 23 L28 32" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M100 14 L82 23 L100 32" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M54 44 Q64 55 74 44 Z" fill="#00F0FF" stroke="none"/>'
  },
  {
    name: 'Takjub',
    cat: 'TAHAN',
    svg: '<path d="M40 7 Q40 23 56 23 Q40 23 40 39 Q40 23 24 23 Q40 23 40 7 Z" fill="#00F0FF" stroke="none"/><path d="M88 7 Q88 23 104 23 Q88 23 88 39 Q88 23 72 23 Q88 23 88 7 Z" fill="#00F0FF" stroke="none"/><path d="M16 10 Q16 13 19 13 Q16 13 16 16 Q16 13 13 13 Q16 13 16 10 Z" fill="#00F0FF" stroke="none"/><path d="M112 32 Q112 35 115 35 Q112 35 112 38 Q112 35 109 35 Q112 35 112 32 Z" fill="#00F0FF" stroke="none"/><path d="M55 45 Q64 54 73 45 Z" fill="#00F0FF" stroke="none"/>'
  },
  {
    name: 'Cium',
    cat: 'TAHAN',
    svg: '<rect x="26" y="11" width="28" height="24" rx="6" fill="#00F0FF" stroke="none"/><rect x="74" y="11" width="28" height="24" rx="6" fill="#00F0FF" stroke="none"/><ellipse cx="64" cy="47" rx="5" ry="4" fill="#00F0FF" stroke="none"/><ellipse cx="64" cy="47" rx="2.5" ry="2" fill="#02060c" stroke="none"/><path d="M76 26 C76 22 71 22 71 25 C71 28 76 33 76 35 C76 33 81 28 81 25 C81 22 76 22 76 26 Z" fill="#00F0FF" stroke="none"/>'
  },
  {
    name: 'Cinta',
    cat: 'TAHAN',
    svg: '<path d="M40 20 C40 11 27 11 27 20 C27 28 40 37 40 39 C40 37 53 28 53 20 C53 11 40 11 40 20 Z" fill="#00F0FF" stroke="none"/><path d="M88 20 C88 11 75 11 75 20 C75 28 88 37 88 39 C88 37 101 28 101 20 C101 11 88 11 88 20 Z" fill="#00F0FF" stroke="none"/><path d="M56 47 Q64 53 72 47" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },

  // --- KATEGORI 4: GUNCANG TILT (15..19) ---
  {
    name: 'Kaget',
    cat: 'GUNCANG',
    svg: '<rect x="23" y="5" width="34" height="36" rx="8" fill="#00F0FF" stroke="none"/><circle cx="40" cy="23" r="5" fill="#02060c" stroke="none"/><rect x="71" y="5" width="34" height="36" rx="8" fill="#00F0FF" stroke="none"/><circle cx="88" cy="23" r="5" fill="#02060c" stroke="none"/><circle cx="64" cy="48" r="5" fill="#00F0FF" stroke="none"/><circle cx="64" cy="48" r="2.5" fill="#02060c" stroke="none"/>'
  },
  {
    name: 'Panik',
    cat: 'GUNCANG',
    svg: '<rect x="22" y="7" width="32" height="30" rx="6" fill="#00F0FF" stroke="none"/><circle cx="38" cy="22" r="3" fill="#02060c" stroke="none"/><rect x="70" y="7" width="32" height="30" rx="6" fill="#00F0FF" stroke="none"/><circle cx="86" cy="22" r="3" fill="#02060c" stroke="none"/><ellipse cx="114" cy="18" rx="3.5" ry="5" fill="#00F0FF" stroke="none" transform="rotate(15 114 18)"/><path d="M56 47 Q60 44 62 47 Q64 50 66 47 Q68 44 72 47" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Marah',
    cat: 'GUNCANG',
    svg: '<line x1="20" y1="8" x2="54" y2="18" stroke="#00F0FF" stroke-width="3.5" stroke-linecap="round"/><path d="M24 14 L56 24 L56 38 L24 38 Z" fill="#00F0FF" stroke="none"/><line x1="108" y1="8" x2="74" y2="18" stroke="#00F0FF" stroke-width="3.5" stroke-linecap="round"/><path d="M72 24 L104 14 L104 38 L72 38 Z" fill="#00F0FF" stroke="none"/><line x1="55" y1="47" x2="73" y2="47" stroke="#00F0FF" stroke-width="3" stroke-linecap="round"/>'
  },
  {
    name: 'Pusing',
    cat: 'GUNCANG',
    svg: '<path d="M40 23 m0 -12 a12 12 0 1 1 0 24 a12 12 0 1 1 0 -24 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16 a4 4 0 1 1 0 8" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/><path d="M88 23 m0 -12 a12 12 0 1 1 0 24 a12 12 0 1 1 0 -24 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16 a4 4 0 1 1 0 8" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/><path d="M56 47 Q60 44 62 47 Q64 50 66 47 Q68 44 72 47" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  },
  {
    name: 'Pingsan',
    cat: 'GUNCANG',
    svg: '<line x1="27" y1="12" x2="53" y2="34" stroke="#00F0FF" stroke-width="4.5" stroke-linecap="round"/><line x1="53" y1="12" x2="27" y2="34" stroke="#00F0FF" stroke-width="4.5" stroke-linecap="round"/><line x1="75" y1="12" x2="101" y2="34" stroke="#00F0FF" stroke-width="4.5" stroke-linecap="round"/><line x1="101" y1="12" x2="75" y2="34" stroke="#00F0FF" stroke-width="4.5" stroke-linecap="round"/><path d="M64 5 L66 8 L69 8 L67 10 L68 13 L64 11 L60 13 L61 10 L59 8 L62 8 Z" fill="#00F0FF" stroke="none"/><line x1="57" y1="47" x2="71" y2="47" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round"/>'
  }
];

// UPDATE TAMPILAN WAJAH OLED DI DETAIL DAN OVERVIEW
function updateOledFacePreview(idx) {
  const item = OLED_FACES[idx] || OLED_FACES[0];
  const detailWrap = document.getElementById('detailFaceSvgWrap');
  const overviewWrap = document.getElementById('oledFaceSvgWrap');
  const moodLabel = document.getElementById('oledFaceMoodLabel');
  const detailMoodLabel = document.getElementById('detailFaceMoodLabel');

  if (detailWrap) {
    detailWrap.innerHTML = `<svg viewBox="0 0 128 64" class="oled-face-svg">${item.svg}</svg>`;
  }
  if (overviewWrap) {
    overviewWrap.innerHTML = `<svg viewBox="0 0 128 64" class="oled-face-svg">${item.svg}</svg>`;
  }
  if (moodLabel) {
    moodLabel.textContent = `ANIMASI: ${item.name.toUpperCase()}`;
  }
  if (detailMoodLabel) {
    detailMoodLabel.textContent = `ANIMASI: [${idx}] ${item.name} (${item.cat})`;
  }
}

// RENDER 20 KARTU ANIMASI WAJAH OLED DI HALAMAN DETAIL FITUR
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
        <svg viewBox="0 0 128 64" class="oled-face-svg">${item.svg}</svg>
      </div>
      <span>[${index}] ${item.name}</span>
    `;
    container.appendChild(card);
  });
}

// PILIH EXPRESI WAJAH OLED (DURASI 5 DETIK SESUAI TASK.MD KECUALI STANDBY INAKTIVITAS)
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

  // Sesuai TASK.md: Reaksi aktif berjalan 5 detik lalu balik ke Kedip (0).
  // Standby inaktivitas (0: Kedip, 2: Sedih, 3: Cemberut, 4: Tidur) bersifat fixed loop tanpa timer auto-return.
  const isFixedStandby = (index === 0 || index === 2 || index === 3 || index === 4);
  if (!isFixedStandby) {
    faceAnimationTimer = setTimeout(() => {
      currentFaceIndex = 0;
      updateOledFacePreview(0);
      sendCommand({ c: 'f', v: 0 }); // Kembalikan ke netral di robot fisik
    }, 5000);
  }
}

// RESET POSISI SCROLL SEMUA KONTAINER KE PALING ATAS (ANTI-TERPOTONG / TER-SCROLL KE BAWAH)
function scrollToPageTop() {
  const pageRobot = document.getElementById('pageRobot');
  if (pageRobot) pageRobot.scrollTop = 0;
  document.querySelectorAll('.page').forEach(p => { p.scrollTop = 0; });
  const detailViewEl = document.getElementById('robotFeatureDetailView');
  if (detailViewEl) detailViewEl.scrollTop = 0;
  const overview = document.getElementById('robotMainOverview');
  if (overview) overview.scrollTop = 0;
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

  requestAnimationFrame(() => {
    if (pageRobot) pageRobot.scrollTop = 0;
    const dv = document.getElementById('robotFeatureDetailView');
    if (dv) dv.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  setTimeout(() => {
    if (pageRobot) pageRobot.scrollTop = 0;
    const dv = document.getElementById('robotFeatureDetailView');
    if (dv) dv.scrollTop = 0;
    window.scrollTo(0, 0);
  }, 40);
}

// BUKA TAMPILAN DETAIL FITUR ROBOT (HALAMAN BARU - LAYAR OLED 100% PERSIS FISIK)
function openRobotFeatureDetail(featureKey) {
  triggerHaptic(25);
  scrollToPageTop();

  // Pastikan tab aktif berpindah ke tab Robot (pageRobot) agar layar tidak tertahan di tab menu
  currentMainTab = 'pageRobot';
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === 'pageRobot');
  });
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-page') === 'pageRobot');
  });

  // Jika membuka fitur Navigasi, periksa izin Lokasi & GPS terlebih dahulu
  if (featureKey === 'navigation') {
    if (window.AndroidBLE && typeof window.AndroidBLE.requestOpenNavigation === 'function') {
      window.AndroidBLE.requestOpenNavigation();
      return;
    }
  }

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
  } else if (featureKey === 'navigation') {
    const panel = document.getElementById('detailViewNavigation');
    if (panel) panel.style.display = 'block';
    currentRobotMode = 18;
    sendCommand({ c: 'm', v: 18 });
  } else if (featureKey === 'prayer') {
    const panel = document.getElementById('detailViewPrayer');
    if (panel) panel.style.display = 'block';
    setAppPrayerPage(0);
    updateOledPrayerPreview();
    currentRobotMode = 19;
    sendCommand({ c: 'm', v: 19 });

    if (window._prayerAutoFlipTimer) clearInterval(window._prayerAutoFlipTimer);
    window._prayerAutoFlipTimer = setInterval(() => {
      if (currentOpenDetailFeature === 'prayer') {
        setAppPrayerPage(1 - appPrayerPage);
      } else {
        clearInterval(window._prayerAutoFlipTimer);
        window._prayerAutoFlipTimer = null;
      }
    }, 4000);
  } else if (featureKey === 'crypto') {
    const panel = document.getElementById('detailViewCrypto');
    if (panel) panel.style.display = 'block';

    const coinInput = document.getElementById('cfgCryptoCoinInput');
    if (coinInput && currentCryptoCoin) {
      coinInput.value = currentCryptoCoin.symbol + ' - ' + currentCryptoCoin.name;
    }
    const stockInput = document.getElementById('cfgStockInput');
    if (stockInput && currentStock) {
      stockInput.value = currentStock.symbol + ' - ' + currentStock.name;
    }
    const currInput = document.getElementById('cfgCryptoCurrencyInput');
    if (currInput && currentCryptoCurrency) {
      currInput.value = currentCryptoCurrency.code + ' - ' + currentCryptoCurrency.name;
    }

    updateOledCryptoPreview();
    currentRobotMode = 20;
    // Beralih ke layar OLED mode 20 seketika dengan prioritas tinggi & sinkronkan data
    sendCommand({ c: 'm', v: 20 }, true);
    sendCryptoDataToRobot();
    startCryptoInterval();
  } else if (featureKey === 'kurs') {
    const panel = document.getElementById('detailViewKurs');
    if (panel) panel.style.display = 'block';

    const targetInput = document.getElementById('cfgKursTargetInput');
    if (targetInput) targetInput.value = currentKursTarget;
    const slotInput = document.getElementById('cfgKursSlotInput');
    if (slotInput) {
      const found = FOREX_POPULAR_CURRENCIES.find(c => c.code === configuredKursSlots[activeKursSlotIndex]);
      slotInput.value = found ? (found.code + ' - ' + found.name) : configuredKursSlots[activeKursSlotIndex];
    }

    renderKursSlotsUI();
    updateOledKursPreview();
    currentRobotMode = 21;
    sendCommand({ c: 'm', v: 21 }, true);
    sendKursDataToRobot();
    startKursInterval();
  }

  scrollToPageTop();
}

// TUTUP DETAIL FITUR & KEMBALI KE OVERVIEW LAYAR OLED ROBOT
function closeRobotFeatureDetail() {
  triggerHaptic(20);

  if (currentOpenDetailFeature === 'navigation') {
    if (window.AndroidBLE && typeof window.AndroidBLE.setNavFeatureActive === 'function') {
      window.AndroidBLE.setNavFeatureActive(false);
    }
  }

  currentOpenDetailFeature = null;

  if (window._gameDetailSyncTimer) {
    clearInterval(window._gameDetailSyncTimer);
    window._gameDetailSyncTimer = null;
  }

  if (typeof cryptoRefreshTimer !== 'undefined' && cryptoRefreshTimer) {
    clearInterval(cryptoRefreshTimer);
    cryptoRefreshTimer = null;
  }

  const overview = document.getElementById('robotMainOverview');
  const detailView = document.getElementById('robotFeatureDetailView');

  if (detailView) detailView.style.display = 'none';
  if (overview) overview.style.display = 'block';

  document.querySelectorAll('.detail-feature-panel').forEach(p => p.style.display = 'none');
  scrollToPageTop();
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
let g_alarmEnabled = localStorage.getItem('robot_cfg_alarm_en') === '1'; // Default OFF (false) persis firmware ESP32
let g_alarmDaily = localStorage.getItem('robot_cfg_alarm_daily') === '1';

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

// PILIH FITUR DI MENU LAYAR UTAMA (MURNI REMOTE NAVIGASI LAYAR OLED FISIK ROBOT)
function selectRobotMenuFeature(featureKey, btnEl) {
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
    'spotify': 17,
    'navigation': 18,
    'prayer': 19,
    'crypto': 20,
    'kurs': 21
  };

  const targetMode = modeMap[featureKey];
  if (targetMode !== undefined) {
    currentRobotMode = targetMode;
    if (featureKey === 'spotify') {
      if (window.AndroidBLE && typeof window.AndroidBLE.requestMusicSync === 'function') {
        window.AndroidBLE.requestMusicSync();
      }
    } else if (featureKey === 'crypto') {
      sendCryptoDataToRobot();
      fetchCryptoLivePrices();
      sendCommand({ c: 'm', v: 20 }, true);
      return;
    } else if (featureKey === 'kurs') {
      sendKursDataToRobot();
      fetchKursLiveRates();
      sendCommand({ c: 'm', v: 21 }, true);
      return;
    }
    sendCommand({ c: 'm', v: targetMode }, true);
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

// Helper Fetch Antar-Platform Cepat, Aman & Asinkron (100% Non-Blocking, Anti-Freeze / Hang)
function fetchGeocoding(url, timeoutMs = 3500) {
  // Untuk domain yang memblokir CORS browser seperti Yahoo Finance dan Indodax,
  // langsung prioritaskan AndroidBLE bridge jika tersedia agar tidak tertahan CORS WebView
  if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function' &&
      (url.includes('yahoo.com') || url.includes('indodax.com'))) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        try {
          const raw = window.AndroidBLE.httpGet(url);
          if (raw && raw.length > 0) {
            return resolve(JSON.parse(raw));
          }
          reject(new Error('AndroidBLE httpGet returned empty'));
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }

  return new Promise(function(resolve, reject) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    })
    .then(function(res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP Status ' + res.status);
      return res.json();
    })
    .then(resolve)
    .catch(function(err) {
      clearTimeout(timer);
      // Fallback bridge native hanya jika fetch web gagal, dan dipanggil secara non-blocking
      if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function') {
        setTimeout(function() {
          try {
            const raw = window.AndroidBLE.httpGet(url);
            if (raw && raw.length > 0) {
              return resolve(JSON.parse(raw));
            }
          } catch (e) {}
          reject(err);
        }, 0);
      } else {
        reject(err);
      }
    });
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
      dropdown.innerHTML = '<div class="city-item-empty">Tidak ada kota yang cocok</div>';
      dropdown.style.display = 'block';
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

// ================= JADWAL SHOLAT (DUNIA / PERSIS KEMENAG RI) =================
let isSearchingPrayerCity = false;
let selectedPrayerCityData = null;
let prayerSearchTimer = null;

function setPrayerBtnVisual(state, text) {
  const btn = document.getElementById('btnSearchPrayerCity');
  const txt = document.getElementById('txtSearchPrayerCityBtn');
  const input = document.getElementById('cfgPrayerCityInput');
  if (!btn || !txt) return;

  if (state === 'loading') {
    btn.disabled = true;
    btn.classList.add('disabled', 'is-loading');
    btn.classList.remove('is-shaking', 'is-success');
    btn.blur();
    if (input) {
      input.classList.add('is-processing');
      input.readOnly = true;
    }
    txt.innerHTML = '<span class="weather-spinner-cyber"></span> MEMPROSES JADWAL...';
  } else if (state === 'error') {
    btn.disabled = false;
    btn.classList.remove('disabled', 'is-loading');
    btn.classList.add('is-shaking');
    btn.blur();
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    txt.textContent = text || 'KOTA TIDAK DITEMUKAN';
    setTimeout(() => {
      btn.classList.remove('is-shaking');
      btn.blur();
    }, 450);
    setTimeout(() => {
      if (!isSearchingPrayerCity) {
        txt.textContent = 'TERAPKAN KOTA SHOLAT';
        btn.blur();
      }
    }, 2400);
  } else if (state === 'success') {
    btn.disabled = false;
    btn.classList.remove('disabled', 'is-loading');
    btn.classList.add('is-success');
    btn.blur();
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    txt.textContent = text || 'KOTA BERHASIL DIATUR';
    setTimeout(() => {
      btn.classList.remove('is-success');
      btn.blur();
    }, 550);
    setTimeout(() => {
      if (!isSearchingPrayerCity) {
        txt.textContent = 'TERAPKAN KOTA SHOLAT';
        btn.blur();
      }
    }, 2400);
  } else {
    btn.disabled = false;
    btn.classList.remove('disabled', 'is-loading', 'is-shaking', 'is-success');
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    txt.textContent = 'TERAPKAN KOTA SHOLAT';
  }
}

let appPrayerPage = 0;
function setAppPrayerPage(page) {
  appPrayerPage = page;
  const p1 = document.getElementById('stagePrayerPage1');
  const p2 = document.getElementById('stagePrayerPage2');
  const d1 = document.getElementById('prayerDot1');
  const d2 = document.getElementById('prayerDot2');
  if (p1 && p2) {
    p1.style.display = page === 0 ? 'flex' : 'none';
    p2.style.display = page === 1 ? 'flex' : 'none';
  }
  if (d1 && d2) {
    d1.classList.toggle('active', page === 0);
    d2.classList.toggle('active', page === 1);
  }
}

function flipPrayerPageApp() {
  triggerHaptic(15);
  setAppPrayerPage(1 - appPrayerPage);
}

function updateOledPrayerPreviewWithData(city, imsak, subuh, dzuhur, ashar, maghrib, isya) {
  const cityName = (city || 'JAKARTA').toUpperCase();

  // 1. Preview Card di Grid Overview
  const prevCityEl = document.getElementById('previewPrayerCity');
  if (prevCityEl) {
    prevCityEl.textContent = cityName.length > 5 ? cityName.substring(0, 4) : cityName;
  }
  const prevSubEl = document.getElementById('prevSubuh');
  if (prevSubEl) prevSubEl.textContent = subuh || '04:18';
  const prevDzuEl = document.getElementById('prevDzuhur');
  if (prevDzuEl) prevDzuEl.textContent = dzuhur || '11:45';
  const prevAshEl = document.getElementById('prevAshar');
  if (prevAshEl) prevAshEl.textContent = ashar || '15:02';
  const prevMagEl = document.getElementById('prevMaghrib');
  if (prevMagEl) prevMagEl.textContent = maghrib || '17:54';
  const prevIsyEl = document.getElementById('prevIsya');
  if (prevIsyEl) prevIsyEl.textContent = isya || '19:06';
  const prevImsEl = document.getElementById('prevImsak');
  if (prevImsEl) prevImsEl.textContent = imsak || '04:08';

  // 2. Stage Bezel di Halaman Detail Sholat
  const stageCityEl = document.getElementById('stagePrayerCity');
  if (stageCityEl) stageCityEl.textContent = 'KOTA: ' + cityName;

  const stageSubEl = document.getElementById('stageSubuh');
  if (stageSubEl) stageSubEl.textContent = subuh || '04:18';
  const stageImsEl = document.getElementById('stageImsak');
  if (stageImsEl) stageImsEl.textContent = imsak || '04:08';
  const stageDzuEl = document.getElementById('stageDzuhur');
  if (stageDzuEl) stageDzuEl.textContent = dzuhur || '11:45';
  const stageAshEl = document.getElementById('stageAshar');
  if (stageAshEl) stageAshEl.textContent = ashar || '15:02';
  const stageMagEl = document.getElementById('stageMaghrib');
  if (stageMagEl) stageMagEl.textContent = maghrib || '17:54';
  const stageIsyEl = document.getElementById('stageIsya');
  if (stageIsyEl) stageIsyEl.textContent = isya || '19:06';

  const inputEl = document.getElementById('cfgPrayerCityInput');
  if (inputEl && !isSearchingPrayerCity && document.activeElement !== inputEl) {
    inputEl.value = cityName;
  }
}

function updateOledPrayerPreview() {
  const savedCity = localStorage.getItem('robot_cfg_prayer_city') || 'JAKARTA';
  const savedImsak = localStorage.getItem('robot_cfg_prayer_imsak') || '04:08';
  const savedSubuh = localStorage.getItem('robot_cfg_prayer_subuh') || '04:18';
  const savedDzuhur = localStorage.getItem('robot_cfg_prayer_dzuhur') || '11:45';
  const savedAshar = localStorage.getItem('robot_cfg_prayer_ashar') || '15:02';
  const savedMaghrib = localStorage.getItem('robot_cfg_prayer_maghrib') || '17:54';
  const savedIsya = localStorage.getItem('robot_cfg_prayer_isya') || '19:06';

  updateOledPrayerPreviewWithData(savedCity, savedImsak, savedSubuh, savedDzuhur, savedAshar, savedMaghrib, savedIsya);
}

// Live Autocomplete Pencarian Kota Sholat (Sama persis pola seperti fitur cuaca)
function searchPrayerCitySuggestions(query) {
  const dropdown = document.getElementById('prayerCityDropdown');
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
          selectedPrayerCityData = item;
          const displayLabel = item.name + (item.country ? (', ' + item.country) : '');

          const input = document.getElementById('cfgPrayerCityInput');
          if (input) input.value = displayLabel;

          dropdown.style.display = 'none';
          triggerHaptic(20);
        });

        dropdown.appendChild(row);
      });

      dropdown.style.display = 'block';
    })
    .catch(function(err) {
      console.warn('Prayer autocomplete fetch failed:', err);
      dropdown.innerHTML = '<div class="city-item-empty">Tidak ada kota yang cocok</div>';
      dropdown.style.display = 'block';
    });
}

// Eksekusi Terapkan Kota Sholat (Aladhan API: Method 20 Kemenag RI untuk Indonesia, atau auto method dunia)
function applyPrayerCity(isFromSetting) {
  if (isSearchingPrayerCity) return;

  const activeInput = document.getElementById('cfgPrayerCityInput');
  if (!activeInput) return;

  let rawQuery = (activeInput.value || '').trim();
  if (!rawQuery) {
    const saved = localStorage.getItem('robot_cfg_prayer_city') || 'JAKARTA';
    activeInput.value = saved;
    rawQuery = saved;
  }

  const MIN_ANIMATION_MS = 2500;
  const startTime = Date.now();

  isSearchingPrayerCity = true;
  setPrayerBtnVisual('loading');
  triggerHaptic(25);

  if (rawQuery.length < 2) {
    const elapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);
    setTimeout(() => {
      isSearchingPrayerCity = false;
      setPrayerBtnVisual('error', 'NAMA KOTA HARUS DIISI');
      triggerHaptic(50);
      setTimeout(() => triggerHaptic(50), 120);
    }, remainingTime);
    return;
  }

  let resolvePromise;
  if (selectedPrayerCityData && selectedPrayerCityData.name && rawQuery.toLowerCase().includes(selectedPrayerCityData.name.toLowerCase())) {
    resolvePromise = Promise.resolve(selectedPrayerCityData);
  } else {
    let clean = rawQuery.toLowerCase();
    let targetCity = clean;
    if (clean.includes(',')) {
      const parts = clean.split(',');
      targetCity = parts[0].trim();
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

      selectedPrayerCityData = cityItem;
      const cityName = (cityItem.name || rawQuery).toUpperCase();
      const lat = parseFloat(cityItem.latitude);
      const lon = parseFloat(cityItem.longitude);

      // Cek apakah wilayah Indonesia untuk gunakan Method 20 (Kemenag RI)
      const countryStr = (cityItem.country || '').toLowerCase();
      const countryCode = (cityItem.country_code || '').toUpperCase();
      const isIndonesia = countryCode === 'ID' || countryStr.includes('indonesia');
      const methodId = isIndonesia ? 20 : 3; // 20: Kemenag RI, 3: Muslim World League (Internasional)

      // Format tanggal hari ini DD-MM-YYYY agar tidak terkena HTTP 302 Redirect
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const dateStr = dd + '-' + mm + '-' + yyyy;

      let prayerFetchPromise;
      if (isIndonesia) {
        let cleanCity = cityName.toLowerCase().replace(/^(kota|kabupaten|kab\.)\s+/i, '').trim();
        const myQuranSearchUrl = 'https://api.myquran.com/v2/sholat/kota/cari/' + encodeURIComponent(cleanCity);
        prayerFetchPromise = fetchGeocoding(myQuranSearchUrl)
          .then(function(mqData) {
            const list = (mqData && mqData.data) ? mqData.data : [];
            if (list.length > 0) {
              const cityId = list[0].id;
              const jadwalUrl = 'https://api.myquran.com/v2/sholat/jadwal/' + cityId + '/' + yyyy + '/' + mm + '/' + dd;
              return fetchGeocoding(jadwalUrl).then(function(jData) {
                if (jData && jData.data && jData.data.jadwal) {
                  const j = jData.data.jadwal;
                  return {
                    cityName: jData.data.lokasi || cityName,
                    lat: lat,
                    lon: lon,
                    timings: {
                      Fajr: j.subuh,
                      Imsak: j.imsak,
                      Dhuhr: j.dzuhur,
                      Asr: j.ashar,
                      Maghrib: j.maghrib,
                      Isha: j.isya
                    }
                  };
                }
                throw new Error('MYQURAN_NO_JADWAL');
              });
            }
            throw new Error('MYQURAN_NO_CITY');
          })
          .catch(function(mqErr) {
            console.warn('MyQuran API fallback to Aladhan tuned:', mqErr);
            // Fallback ke Aladhan dengan tune offset resmi Kemenag RI (+3 Imsak, +3 Fajr, +4 Dhuhr, +2 Asr, +3 Maghrib, +2 Isha)
            const tunedUrl = 'https://api.aladhan.com/v1/timings/' + dateStr +
                             '?latitude=' + lat +
                             '&longitude=' + lon +
                             '&method=20&tune=3,3,0,4,2,3,2,2,0';
            return fetchGeocoding(tunedUrl).then(function(pData) {
              if (!pData || !pData.data || !pData.data.timings) throw new Error('PRAYER_FAIL');
              return {
                cityName: cityName,
                lat: lat,
                lon: lon,
                timings: pData.data.timings
              };
            });
          });
      } else {
        // Internasional (Luar Indonesia)
        const intlUrl = 'https://api.aladhan.com/v1/timings/' + dateStr +
                        '?latitude=' + lat +
                        '&longitude=' + lon +
                        '&method=' + methodId;
        prayerFetchPromise = fetchGeocoding(intlUrl).then(function(pData) {
          if (!pData || !pData.data || !pData.data.timings) throw new Error('PRAYER_FAIL');
          return {
            cityName: cityName,
            lat: lat,
            lon: lon,
            timings: pData.data.timings
          };
        });
      }

      return prayerFetchPromise
        .then(function(res) {
          const elapsed = Date.now() - startTime;
          const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);

          return new Promise(function(resolve) {
            setTimeout(function() {
              resolve(res);
            }, remainingTime);
          });
        })
        .then(function(res) {
          const t = res.timings;
          // Ambil format jam:menit bersih (cth "04:07 (WIB)" -> "04:07")
          const cleanTime = (s) => String(s || '').trim().substring(0, 5);

          const subuh = cleanTime(t.Fajr);
          const imsak = cleanTime(t.Imsak);
          const dzuhur = cleanTime(t.Dhuhr);
          const ashar = cleanTime(t.Asr);
          const maghrib = cleanTime(t.Maghrib);
          const isya = cleanTime(t.Isha);

          // 1. UPDATE LAYAR OLED PREVIEW DI HP
          updateOledPrayerPreviewWithData(res.cityName, imsak, subuh, dzuhur, ashar, maghrib, isya);

          // 2. SIMPAN PREFERENSI KE HP
          localStorage.setItem('robot_cfg_prayer_city', res.cityName);
          localStorage.setItem('robot_cfg_prayer_lat', res.lat);
          localStorage.setItem('robot_cfg_prayer_lon', res.lon);
          localStorage.setItem('robot_cfg_prayer_imsak', imsak);
          localStorage.setItem('robot_cfg_prayer_subuh', subuh);
          localStorage.setItem('robot_cfg_prayer_dzuhur', dzuhur);
          localStorage.setItem('robot_cfg_prayer_ashar', ashar);
          localStorage.setItem('robot_cfg_prayer_maghrib', maghrib);
          localStorage.setItem('robot_cfg_prayer_isya', isya);
          localStorage.setItem('robot_cfg_prayer_last_date', dateStr);

          // 3. KIRIM DATA JADWAL SHOLAT VIA BLE KE ROBOT ESP32 (SINKRONISASI 100%)
          sendCommand({
            cmd: 'set_prayer_live',
            city: res.cityName,
            imsak: imsak,
            subuh: subuh,
            dzuhur: dzuhur,
            ashar: ashar,
            maghrib: maghrib,
            isya: isya,
            lat: res.lat,
            lon: res.lon
          });

          // 4. EFEK SUKSES PADA TOMBOL & HAPTIC
          isSearchingPrayerCity = false;
          setPrayerBtnVisual('success', 'KOTA BERHASIL DIATUR');
          triggerHaptic(35);
        });
    })
    .catch(function(err) {
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, MIN_ANIMATION_MS - elapsed);
      setTimeout(function() {
        isSearchingPrayerCity = false;
        const msg = (err && err.message === 'NOT_FOUND') ? 'KOTA TIDAK DITEMUKAN' : 'KONEKSI INTERNET GAGAL';
        setPrayerBtnVisual('error', msg);
        triggerHaptic(60);
        setTimeout(() => triggerHaptic(60), 120);
      }, remainingTime);
    });
}

function syncPrayerQuiet() {
  if (!isBleConnected) return;

  const savedCity = localStorage.getItem('robot_cfg_prayer_city') || 'JAKARTA';
  const savedImsak = localStorage.getItem('robot_cfg_prayer_imsak') || '03:57';
  const savedSubuh = localStorage.getItem('robot_cfg_prayer_subuh') || '04:07';
  const savedDzuhur = localStorage.getItem('robot_cfg_prayer_dzuhur') || '11:40';
  const savedAshar = localStorage.getItem('robot_cfg_prayer_ashar') || '14:59';
  const savedMaghrib = localStorage.getItem('robot_cfg_prayer_maghrib') || '17:51';
  const savedIsya = localStorage.getItem('robot_cfg_prayer_isya') || '19:03';
  const savedLat = parseFloat(localStorage.getItem('robot_cfg_prayer_lat') || '-6.2088');
  const savedLon = parseFloat(localStorage.getItem('robot_cfg_prayer_lon') || '106.8456');

  sendCommand({
    cmd: 'set_prayer_live',
    city: savedCity,
    imsak: savedImsak,
    subuh: savedSubuh,
    dzuhur: savedDzuhur,
    ashar: savedAshar,
    maghrib: savedMaghrib,
    isya: savedIsya,
    lat: savedLat,
    lon: savedLon
  });
}

function initPrayerFeature() {
  const savedCity = localStorage.getItem('robot_cfg_prayer_city') || 'JAKARTA';
  let savedImsak = localStorage.getItem('robot_cfg_prayer_imsak') || '03:57';
  let savedSubuh = localStorage.getItem('robot_cfg_prayer_subuh') || '04:07';
  let savedDzuhur = localStorage.getItem('robot_cfg_prayer_dzuhur') || '11:40';
  let savedAshar = localStorage.getItem('robot_cfg_prayer_ashar') || '14:59';
  let savedMaghrib = localStorage.getItem('robot_cfg_prayer_maghrib') || '17:51';
  let savedIsya = localStorage.getItem('robot_cfg_prayer_isya') || '19:03';

  // Bersihkan data dummy lama jika ada
  if (savedSubuh === '04:18' || savedSubuh === '04:28' || savedDzuhur === '11:45' || savedDzuhur === '11:58' || savedMaghrib === '17:54' || savedMaghrib === '18:05') {
    savedImsak = '03:57';
    savedSubuh = '04:07';
    savedDzuhur = '11:40';
    savedAshar = '14:59';
    savedMaghrib = '17:51';
    savedIsya = '19:03';
    localStorage.setItem('robot_cfg_prayer_imsak', savedImsak);
    localStorage.setItem('robot_cfg_prayer_subuh', savedSubuh);
    localStorage.setItem('robot_cfg_prayer_dzuhur', savedDzuhur);
    localStorage.setItem('robot_cfg_prayer_ashar', savedAshar);
    localStorage.setItem('robot_cfg_prayer_maghrib', savedMaghrib);
    localStorage.setItem('robot_cfg_prayer_isya', savedIsya);
  }

  const input = document.getElementById('cfgPrayerCityInput');
  if (input) input.value = savedCity;

  updateOledPrayerPreviewWithData(savedCity, savedImsak, savedSubuh, savedDzuhur, savedAshar, savedMaghrib, savedIsya);

  // Auto-refresh jadwal hari ini jika tanggal sudah berganti
  const now = new Date();
  const todayStr = String(now.getDate()).padStart(2, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
  if (localStorage.getItem('robot_cfg_prayer_last_date') !== todayStr) {
    setTimeout(() => {
      applyPrayerCity(false);
    }, 1500);
  }

  const btn = document.getElementById('btnSearchPrayerCity');
  if (btn) {
    btn.addEventListener('pointerup', function() { btn.blur(); });
    btn.addEventListener('touchend', function() { btn.blur(); });
    btn.addEventListener('mouseleave', function() { btn.blur(); });
  }

  if (input) {
    input.addEventListener('input', (e) => {
      const q = e.target.value;
      if (prayerSearchTimer) clearTimeout(prayerSearchTimer);
      prayerSearchTimer = setTimeout(() => {
        searchPrayerCitySuggestions(q);
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dropdown = document.getElementById('prayerCityDropdown');
        if (dropdown) dropdown.style.display = 'none';
        applyPrayerCity(false);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const d = document.getElementById('prayerCityDropdown');
    const i = document.getElementById('cfgPrayerCityInput');
    if (d && !d.contains(e.target) && e.target !== i) d.style.display = 'none';
  });
}

// =======================================================
// FITUR CRYPTO & SAHAM TICKER (100% SINKRON REALTIME & CYBER NEON)
// =======================================================

const CRYPTO_POPULAR_COINS = [
  { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', id: 'solana' },
  { symbol: 'BNB', name: 'BNB', id: 'binancecoin' },
  { symbol: 'XRP', name: 'XRP (Ripple)', id: 'ripple' },
  { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
  { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
  { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
  { symbol: 'SUI', name: 'Sui', id: 'sui' },
  { symbol: 'PEPE', name: 'Pepe', id: 'pepe' },
  { symbol: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu' },
  { symbol: 'TRX', name: 'TRON', id: 'tron' },
  { symbol: 'LINK', name: 'Chainlink', id: 'chainlink' },
  { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near' },
  { symbol: 'TON', name: 'Toncoin', id: 'the-open-network' },
  { symbol: 'DOT', name: 'Polkadot', id: 'polkadot' },
  { symbol: 'LTC', name: 'Litecoin', id: 'litecoin' },
  { symbol: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash' },
  { symbol: 'UNI', name: 'Uniswap', id: 'uniswap' },
  { symbol: 'POL', name: 'Polygon', id: 'polygon-ecosystem-token' },
  { symbol: 'KAS', name: 'Kaspa', id: 'kaspa' },
  { symbol: 'XMR', name: 'Monero', id: 'monero' },
  { symbol: 'XLM', name: 'Stellar Lumens', id: 'stellar' },
  { symbol: 'APT', name: 'Aptos', id: 'aptos' },
  { symbol: 'ICP', name: 'Internet Computer', id: 'internet-computer' },
  { symbol: 'ARB', name: 'Arbitrum', id: 'arbitrum' },
  { symbol: 'OP', name: 'Optimism', id: 'optimism' },
  { symbol: 'TAO', name: 'Bittensor', id: 'bittensor' },
  { symbol: 'RENDER', name: 'Render', id: 'render-token' },
  { symbol: 'INJ', name: 'Injective', id: 'injective-protocol' },
  { symbol: 'ATOM', name: 'Cosmos Hub', id: 'cosmos' },
  { symbol: 'FIL', name: 'Filecoin', id: 'filecoin' },
  { symbol: 'FET', name: 'Fetch.ai / ASI', id: 'fetch-ai' },
  { symbol: 'STX', name: 'Stacks', id: 'blockstack' },
  { symbol: 'FTM', name: 'Fantom / Sonic', id: 'fantom' },
  { symbol: 'HBAR', name: 'Hedera', id: 'hedera-hashgraph' },
  { symbol: 'VET', name: 'VeChain', id: 'vechain' },
  { symbol: 'TIA', name: 'Celestia', id: 'celestia' },
  { symbol: 'FLOKI', name: 'Floki', id: 'floki' },
  { symbol: 'BONK', name: 'Bonk', id: 'bonk' },
  { symbol: 'WIF', name: 'dogwifhat', id: 'dogwifcoin' },
  { symbol: 'POPCAT', name: 'Popcat', id: 'popcat' },
  { symbol: 'BRETT', name: 'Brett', id: 'brett' },
  { symbol: 'SEI', name: 'Sei', id: 'sei-network' },
  { symbol: 'JASMY', name: 'JasmyCoin', id: 'jasmycoin' },
  { symbol: 'AAVE', name: 'Aave', id: 'aave' },
  { symbol: 'MKR', name: 'Maker', id: 'maker' },
  { symbol: 'ALGO', name: 'Algorand', id: 'algorand' },
  { symbol: 'RUNE', name: 'THORChain', id: 'thorchain' },
  { symbol: 'SAND', name: 'The Sandbox', id: 'the-sandbox' },
  { symbol: 'MANA', name: 'Decentraland', id: 'decentraland' },
  { symbol: 'AXS', name: 'Axie Infinity', id: 'axie-infinity' },
  { symbol: 'GALA', name: 'GALA', id: 'gala' },
  { symbol: 'WLD', name: 'Worldcoin', id: 'worldcoin-wld' },
  { symbol: 'JUP', name: 'Jupiter', id: 'jupiter-exchange-solana' },
  { symbol: 'PYTH', name: 'Pyth Network', id: 'pyth-network' },
  { symbol: 'ONDO', name: 'Ondo Finance', id: 'ondo-finance' },
  { symbol: 'ENA', name: 'Ethena', id: 'ethena' },
  { symbol: 'STRK', name: 'Starknet', id: 'starknet' },
  { symbol: 'ZK', name: 'ZKsync', id: 'zksync' },
  { symbol: 'ZRO', name: 'LayerZero', id: 'layerzero' }
];

const STOCK_POPULAR_LIST = [
  // Saham Indonesia (IDX / BEI)
  { symbol: 'BBCA', querySym: 'BBCA.JK', name: 'Bank Central Asia', market: 'IDX' },
  { symbol: 'BBRI', querySym: 'BBRI.JK', name: 'Bank Rakyat Indonesia', market: 'IDX' },
  { symbol: 'BMRI', querySym: 'BMRI.JK', name: 'Bank Mandiri', market: 'IDX' },
  { symbol: 'BBNI', querySym: 'BBNI.JK', name: 'Bank Negara Indonesia', market: 'IDX' },
  { symbol: 'GOTO', querySym: 'GOTO.JK', name: 'GoTo Gojek Tokopedia', market: 'IDX' },
  { symbol: 'TLKM', querySym: 'TLKM.JK', name: 'Telkom Indonesia', market: 'IDX' },
  { symbol: 'ASII', querySym: 'ASII.JK', name: 'Astra International', market: 'IDX' },
  { symbol: 'ICBP', querySym: 'ICBP.JK', name: 'Indofood CBP Sukses Makmur', market: 'IDX' },
  { symbol: 'INDF', querySym: 'INDF.JK', name: 'Indofood Sukses Makmur', market: 'IDX' },
  { symbol: 'AMMN', querySym: 'AMMN.JK', name: 'Amman Mineral Internasional', market: 'IDX' },
  { symbol: 'BRIS', querySym: 'BRIS.JK', name: 'Bank Syariah Indonesia', market: 'IDX' },
  { symbol: 'ANTM', querySym: 'ANTM.JK', name: 'Aneka Tambang', market: 'IDX' },
  { symbol: 'MDKA', querySym: 'MDKA.JK', name: 'Merdeka Copper Gold', market: 'IDX' },
  { symbol: 'UNTR', querySym: 'UNTR.JK', name: 'United Tractors', market: 'IDX' },
  { symbol: 'PGAS', querySym: 'PGAS.JK', name: 'Perusahaan Gas Negara', market: 'IDX' },
  { symbol: 'ADRO', querySym: 'ADRO.JK', name: 'Adaro Energy Indonesia', market: 'IDX' },
  { symbol: 'PTBA', querySym: 'PTBA.JK', name: 'Bukit Asam', market: 'IDX' },
  { symbol: 'CPIN', querySym: 'CPIN.JK', name: 'Charoen Pokphand Indonesia', market: 'IDX' },
  { symbol: 'KLBF', querySym: 'KLBF.JK', name: 'Kalbe Farma', market: 'IDX' },
  { symbol: 'INCO', querySym: 'INCO.JK', name: 'Vale Indonesia', market: 'IDX' },
  { symbol: 'SMGR', querySym: 'SMGR.JK', name: 'Semen Indonesia', market: 'IDX' },
  { symbol: 'BUKA', querySym: 'BUKA.JK', name: 'Bukalapak.com', market: 'IDX' },
  { symbol: 'ACES', querySym: 'ACES.JK', name: 'Aspirasi Hidup Indonesia', market: 'IDX' },
  { symbol: 'MYOR', querySym: 'MYOR.JK', name: 'Mayora Indah', market: 'IDX' },
  { symbol: 'BRPT', querySym: 'BRPT.JK', name: 'Barito Pacific', market: 'IDX' },
  { symbol: 'TPIA', querySym: 'TPIA.JK', name: 'Chandra Asri Pacific', market: 'IDX' },
  { symbol: 'MEDC', querySym: 'MEDC.JK', name: 'Medco Energi Internasional', market: 'IDX' },
  { symbol: 'AKRA', querySym: 'AKRA.JK', name: 'AKR Corporindo', market: 'IDX' },
  { symbol: 'EMTK', querySym: 'EMTK.JK', name: 'Elang Mahkota Teknologi', market: 'IDX' },
  { symbol: 'UNVR', querySym: 'UNVR.JK', name: 'Unilever Indonesia', market: 'IDX' },
  // Saham Global / AS (Wall Street / Global Tech)
  { symbol: 'AAPL', querySym: 'AAPL', name: 'Apple Inc.', market: 'US' },
  { symbol: 'NVDA', querySym: 'NVDA', name: 'NVIDIA Corporation', market: 'US' },
  { symbol: 'TSLA', querySym: 'TSLA', name: 'Tesla Inc.', market: 'US' },
  { symbol: 'MSFT', querySym: 'MSFT', name: 'Microsoft Corporation', market: 'US' },
  { symbol: 'GOOGL', querySym: 'GOOGL', name: 'Alphabet / Google', market: 'US' },
  { symbol: 'AMZN', querySym: 'AMZN', name: 'Amazon.com', market: 'US' },
  { symbol: 'META', querySym: 'META', name: 'Meta Platforms (Facebook)', market: 'US' },
  { symbol: 'AMD', querySym: 'AMD', name: 'Advanced Micro Devices', market: 'US' },
  { symbol: 'NFLX', querySym: 'NFLX', name: 'Netflix Inc.', market: 'US' },
  { symbol: 'PLTR', querySym: 'PLTR', name: 'Palantir Technologies', market: 'US' },
  { symbol: 'COIN', querySym: 'COIN', name: 'Coinbase Global', market: 'US' },
  { symbol: 'BABA', querySym: 'BABA', name: 'Alibaba Group', market: 'US' },
  { symbol: 'INTC', querySym: 'INTC', name: 'Intel Corporation', market: 'US' },
  { symbol: 'QCOM', querySym: 'QCOM', name: 'Qualcomm Inc.', market: 'US' },
  { symbol: 'ARM', querySym: 'ARM', name: 'Arm Holdings', market: 'US' },
  { symbol: 'AVGO', querySym: 'AVGO', name: 'Broadcom Inc.', market: 'US' },
  { symbol: 'DIS', querySym: 'DIS', name: 'Walt Disney Co.', market: 'US' },
  { symbol: 'PYPL', querySym: 'PYPL', name: 'PayPal Holdings', market: 'US' },
  { symbol: 'UBER', querySym: 'UBER', name: 'Uber Technologies', market: 'US' },
  { symbol: 'SBUX', querySym: 'SBUX', name: 'Starbucks Corporation', market: 'US' },
  { symbol: 'NKE', querySym: 'NKE', name: 'Nike Inc.', market: 'US' },
  { symbol: 'KO', querySym: 'KO', name: 'Coca-Cola Company', market: 'US' },
  { symbol: 'PEP', querySym: 'PEP', name: 'PepsiCo Inc.', market: 'US' },
  { symbol: 'MCD', querySym: 'MCD', name: 'McDonald\'s Corp.', market: 'US' },
  { symbol: 'WMT', querySym: 'WMT', name: 'Walmart Inc.', market: 'US' }
];

const CRYPTO_ALL_CURRENCIES = [
  { code: 'USD', name: 'Dolar Amerika Serikat', symbol: '$' },
  { code: 'IDR', name: 'Rupiah Indonesia', symbol: 'Rp' },
  { code: 'EUR', name: 'Euro Uni Eropa', symbol: '€' },
  { code: 'JPY', name: 'Yen Jepang', symbol: '¥' },
  { code: 'GBP', name: 'Poundsterling Inggris', symbol: '£' },
  { code: 'AUD', name: 'Dolar Australia', symbol: 'A$' },
  { code: 'SGD', name: 'Dolar Singapura', symbol: 'S$' },
  { code: 'MYR', name: 'Ringgit Malaysia', symbol: 'RM' },
  { code: 'CNY', name: 'Yuan Tiongkok', symbol: '¥' },
  { code: 'KRW', name: 'Won Korea Selatan', symbol: '₩' },
  { code: 'CAD', name: 'Dolar Kanada', symbol: 'C$' },
  { code: 'CHF', name: 'Franc Swiss', symbol: 'CHF' },
  { code: 'THB', name: 'Baht Thailand', symbol: '฿' },
  { code: 'PHP', name: 'Peso Filipina', symbol: '₱' },
  { code: 'VND', name: 'Dong Vietnam', symbol: '₫' },
  { code: 'INR', name: 'Rupee India', symbol: '₹' },
  { code: 'RUB', name: 'Rubel Rusia', symbol: '₽' },
  { code: 'BRL', name: 'Real Brasil', symbol: 'R$' },
  { code: 'AED', name: 'Dirham Uni Emirat Arab', symbol: 'AED' },
  { code: 'SAR', name: 'Riyal Arab Saudi', symbol: 'SAR' },
  { code: 'TRY', name: 'Lira Turki', symbol: '₺' },
  { code: 'NZD', name: 'Dolar Selandia Baru', symbol: 'NZ$' },
  { code: 'TWD', name: 'Dolar Taiwan Baru', symbol: 'NT$' },
  { code: 'HKD', name: 'Dolar Hong Kong', symbol: 'HK$' },
  { code: 'ZAR', name: 'Rand Afrika Selatan', symbol: 'R' },
  { code: 'MXN', name: 'Peso Meksiko', symbol: 'Mex$' },
  { code: 'BHD', name: 'Dinar Bahrain', symbol: 'BD' },
  { code: 'KWD', name: 'Dinar Kuwait', symbol: 'KD' },
  { code: 'QAR', name: 'Riyal Qatar', symbol: 'QR' },
  { code: 'PLN', name: 'Zloty Polandia', symbol: 'zł' },
  { code: 'SEK', name: 'Krona Swedia', symbol: 'kr' },
  { code: 'NOK', name: 'Krone Norwegia', symbol: 'kr' },
  { code: 'DKK', name: 'Krone Denmark', symbol: 'kr' },
  { code: 'CZK', name: 'Koruna Ceko', symbol: 'Kč' },
  { code: 'HUF', name: 'Forint Hungaria', symbol: 'Ft' },
  { code: 'ILS', name: 'Shekel Israel', symbol: '₪' },
  { code: 'PKR', name: 'Rupee Pakistan', symbol: '₨' },
  { code: 'EGP', name: 'Pound Mesir', symbol: 'E£' },
  { code: 'CLP', name: 'Peso Chili', symbol: 'CLP$' },
  { code: 'COP', name: 'Peso Kolombia', symbol: 'COL$' },
  { code: 'UAH', name: 'Hryvnia Ukraina', symbol: '₴' },
  { code: 'RON', name: 'Leu Rumania', symbol: 'lei' }
];

const CRYPTO_CURRENCY_SYMBOLS = {};
CRYPTO_ALL_CURRENCIES.forEach(c => {
  CRYPTO_CURRENCY_SYMBOLS[c.code] = c.symbol;
});

// State aktif Tipe Aset yang sedang diedit / dipilih ('crypto' atau 'stock')
let currentActiveAssetType = 'crypto';

// ==========================================
// KONFIGURASI MULTI-ASSET (1..5 COIN & 1..5 SAHAM -> TOTAL 2..10)
// ==========================================
const DEFAULT_CRYPTO_SLOTS = [
  { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', id: 'solana' },
  { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin' },
  { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin' }
];

const DEFAULT_STOCK_SLOTS = [
  { symbol: 'AAPL', querySym: 'AAPL', name: 'Apple Inc.', market: 'US' },
  { symbol: 'NVDA', querySym: 'NVDA', name: 'NVIDIA Corporation', market: 'US' },
  { symbol: 'TSLA', querySym: 'TSLA', name: 'Tesla Inc.', market: 'US' },
  { symbol: 'BBCA', querySym: 'BBCA.JK', name: 'Bank Central Asia', market: 'IDX' },
  { symbol: 'GOTO', querySym: 'GOTO.JK', name: 'GoTo Gojek Tokopedia', market: 'IDX' }
];

let configuredCryptoCoins = (() => {
  try {
    const saved = localStorage.getItem('robot_cfg_crypto_coins_list');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5) return parsed;
    }
  } catch (e) {}
  return [...DEFAULT_CRYPTO_SLOTS];
})();

let configuredStocks = (() => {
  try {
    const version = localStorage.getItem('robot_cfg_stocks_version');
    if (version !== 'v3_usd') {
      localStorage.setItem('robot_cfg_stocks_version', 'v3_usd');
      localStorage.setItem('robot_cfg_stocks_list', JSON.stringify(DEFAULT_STOCK_SLOTS));
      return [...DEFAULT_STOCK_SLOTS];
    }
    const saved = localStorage.getItem('robot_cfg_stocks_list');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5) {
        parsed.forEach(s => delete s.curr);
        return parsed;
      }
    }
  } catch (e) {}
  return [...DEFAULT_STOCK_SLOTS];
})();

let activeCryptoSlotIndex = 0;
let activeStockSlotIndex = 0;
let currentVirtualRotationIndex = 0; // 0 .. (configuredCryptoCoins.length + configuredStocks.length - 1)

// Backward-compatibility aliases
let currentCryptoCoin = configuredCryptoCoins[0];
let currentCryptoCoinIndex = 0;
let currentStock = configuredStocks[0];
let currentStockIndex = 0;

// State aktif Mata Uang
let currentCryptoCurrency = { code: 'USD', name: 'Dolar Amerika Serikat', symbol: '$' };

const CRYPTO_AUTO_REFRESH_INTERVAL = 60000; // Default tetap setiap 1 menit (60 detik)
let cryptoRefreshTimer = null;
let isCryptoFetching = false;
let isApplyingCryptoCoin = false;
let isApplyingStock = false;
let isApplyingCryptoCurrency = false;
let selectedCryptoCoin = null;
let selectedStock = null;
let selectedCryptoCurrency = null;
let cryptoCoinSearchTimer = null;
let stockSearchTimer = null;
let cryptoCurrencySearchTimer = null;
let cryptoActiveAbortController = null;
let stockActiveAbortController = null;
let usdToIdrRate = 18050; // Nilai estimasi kurs USD/IDR live aktual

// Cache lokal untuk menyimpan data harga (coin & saham) dengan nilai live aktual
let cryptoPriceCache = {
  'BTC_USD': { price: 75150, change24h: 0.50, isUp: true },
  'ETH_USD': { price: 2130, change24h: -0.30, isUp: false },
  'SOL_USD': { price: 86.6, change24h: -0.20, isUp: false },
  'BNB_USD': { price: 690, change24h: 0.50, isUp: true },
  'DOGE_USD': { price: 0.070, change24h: 0.60, isUp: true },
  'AAPL_USD': { price: 350.70, change24h: 2.43, isUp: true },
  'NVDA_USD': { price: 178.70, change24h: -4.27, isUp: false },
  'TSLA_USD': { price: 378.10, change24h: 5.54, isUp: true },
  'BBCA_USD': { price: 0.29, change24h: 2.40, isUp: true },
  'GOTO_USD': { price: 0.0014, change24h: 4.17, isUp: true }
};

function saveConfiguredAssets() {
  try {
    localStorage.setItem('robot_cfg_crypto_coins_list', JSON.stringify(configuredCryptoCoins));
    localStorage.setItem('robot_cfg_stocks_list', JSON.stringify(configuredStocks));
  } catch (e) {}
}

function updateRotationBadgeUI() {
  // Rotasi badge dinonaktifkan sesuai permintaan pengguna
}

function renderCryptoSlotsUI() {
  const bar = document.getElementById('cryptoCoinsSlotsBar');
  if (!bar) return;
  bar.innerHTML = '';
  configuredCryptoCoins.forEach((coin, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip-preset' + (idx === activeCryptoSlotIndex ? ' active' : '');
    chip.textContent = `${idx + 1}: ${coin.symbol}`;
    chip.onclick = () => selectCryptoSlot(idx);
    bar.appendChild(chip);
  });
  updateRotationBadgeUI();
}

function selectCryptoSlot(idx) {
  if (idx < 0 || idx >= configuredCryptoCoins.length) return;
  activeCryptoSlotIndex = idx;
  currentActiveAssetType = 'crypto';
  currentVirtualRotationIndex = idx;
  currentCryptoCoin = configuredCryptoCoins[idx];
  selectedCryptoCoin = currentCryptoCoin;
  const input = document.getElementById('cfgCryptoCoinInput');
  if (input) input.value = currentCryptoCoin.symbol + ' - ' + currentCryptoCoin.name;
  renderCryptoSlotsUI();
  updateOledCryptoPreview();
  sendCommand({ c: 'crypto_cycle', idx: currentVirtualRotationIndex }, true);
}

function addCryptoCoinSlot() {
  if (configuredCryptoCoins.length >= 5) {
    showNeonToast('Maksimal 5 coin crypto!');
    return;
  }
  const nextCoin = CRYPTO_POPULAR_COINS.find(c => !configuredCryptoCoins.some(item => item.symbol.toUpperCase() === c.symbol.toUpperCase())) || {
    symbol: 'PEPE', name: 'Pepe', id: 'pepe'
  };
  configuredCryptoCoins.push({ ...nextCoin });
  activeCryptoSlotIndex = configuredCryptoCoins.length - 1;
  saveConfiguredAssets();
  renderCryptoSlotsUI();
  selectCryptoSlot(activeCryptoSlotIndex);
  debouncedFetchCrypto();
  showNeonToast('Slot Coin Ditambahkan (' + configuredCryptoCoins.length + '/5)');
}

function removeCryptoCoinSlot() {
  if (configuredCryptoCoins.length <= 1) {
    showNeonToast('Minimal 1 coin crypto harus tetap ada!');
    return;
  }
  configuredCryptoCoins.splice(activeCryptoSlotIndex, 1);
  if (activeCryptoSlotIndex >= configuredCryptoCoins.length) {
    activeCryptoSlotIndex = configuredCryptoCoins.length - 1;
  }
  saveConfiguredAssets();
  renderCryptoSlotsUI();
  selectCryptoSlot(activeCryptoSlotIndex);
  debouncedFetchCrypto();
  showNeonToast('Slot Coin Dihapus');
}

function renderStockSlotsUI() {
  const bar = document.getElementById('stockSlotsBar');
  if (!bar) return;
  bar.innerHTML = '';
  configuredStocks.forEach((stock, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip-preset' + (idx === activeStockSlotIndex ? ' active' : '');
    chip.textContent = `${idx + 1}: ${stock.symbol}`;
    chip.onclick = () => selectStockSlot(idx);
    bar.appendChild(chip);
  });
  updateRotationBadgeUI();
}

function selectStockSlot(idx) {
  if (idx < 0 || idx >= configuredStocks.length) return;
  activeStockSlotIndex = idx;
  currentActiveAssetType = 'stock';
  currentVirtualRotationIndex = configuredCryptoCoins.length + idx;
  currentStock = configuredStocks[idx];
  selectedStock = currentStock;
  const input = document.getElementById('cfgStockInput');
  if (input) input.value = currentStock.symbol + ' - ' + currentStock.name;
  renderStockSlotsUI();
  updateOledCryptoPreview();
  sendCommand({ c: 'crypto_cycle', idx: currentVirtualRotationIndex }, true);
}

function addStockSlot() {
  if (configuredStocks.length >= 5) {
    showNeonToast('Maksimal 5 saham!');
    return;
  }
  const nextStock = STOCK_POPULAR_LIST.find(s => !configuredStocks.some(item => item.symbol.toUpperCase() === s.symbol.toUpperCase())) || {
    symbol: 'TSLA', querySym: 'TSLA', name: 'Tesla Inc.', market: 'US'
  };
  configuredStocks.push({ ...nextStock });
  activeStockSlotIndex = configuredStocks.length - 1;
  saveConfiguredAssets();
  renderStockSlotsUI();
  selectStockSlot(activeStockSlotIndex);
  debouncedFetchCrypto();
  showNeonToast('Slot Saham Ditambahkan (' + configuredStocks.length + '/5)');
}

function removeStockSlot() {
  if (configuredStocks.length <= 1) {
    showNeonToast('Minimal 1 saham harus tetap ada!');
    return;
  }
  configuredStocks.splice(activeStockSlotIndex, 1);
  if (activeStockSlotIndex >= configuredStocks.length) {
    activeStockSlotIndex = configuredStocks.length - 1;
  }
  saveConfiguredAssets();
  renderStockSlotsUI();
  selectStockSlot(activeStockSlotIndex);
  debouncedFetchCrypto();
  showNeonToast('Slot Saham Dihapus');
}

function formatCryptoDisplayPrice(price, currCode) {
  if (typeof price !== 'number' || isNaN(price) || price <= 0) return '0';
  const sym = CRYPTO_CURRENCY_SYMBOLS[currCode] || (currCode + ' ');

  if (currCode === 'IDR') {
    if (price >= 1000000000) {
      return sym + (price / 1000000000).toFixed(2) + ' M';
    } else if (price >= 1000000) {
      return sym + (price / 1000000).toFixed(1) + ' Jt';
    } else if (price >= 1000) {
      return sym + Math.round(price).toLocaleString('id-ID');
    } else if (price >= 1) {
      return sym + price.toFixed(2);
    } else {
      return sym + price.toFixed(4);
    }
  }

  // Mata uang global (USD, EUR, GBP, JPY, dll)
  if (price >= 1000000000) {
    return sym + (price / 1000000000).toFixed(2) + 'B';
  } else if (price >= 1000000) {
    return sym + (price / 1000000).toFixed(1) + 'M';
  } else if (price >= 1000) {
    return sym + Math.round(price).toLocaleString('en-US');
  } else if (price >= 1) {
    return sym + price.toFixed(2);
  } else if (price >= 0.001) {
    return sym + price.toFixed(4);
  } else {
    return sym + price.toFixed(6);
  }
}

function updateOledCryptoPreview() {
  const cCount = configuredCryptoCoins.length;
  const sCount = configuredStocks.length;
  const total = cCount + sCount;
  if (currentVirtualRotationIndex >= total) currentVirtualRotationIndex = 0;

  const isStock = (currentVirtualRotationIndex >= cCount);
  const globalCurr = (currentCryptoCurrency && currentCryptoCurrency.code) ? currentCryptoCurrency.code.toUpperCase() : 'USD';
  let assetSym = '';
  let headerTitle = '';

  if (isStock) {
    const stockIdx = currentVirtualRotationIndex - cCount;
    const curStock = configuredStocks[stockIdx] || configuredStocks[0];
    assetSym = (curStock && curStock.symbol) ? curStock.symbol.toUpperCase() : 'AAPL';
    headerTitle = 'SAHAM';
  } else {
    const curCoin = configuredCryptoCoins[currentVirtualRotationIndex] || configuredCryptoCoins[0];
    assetSym = (curCoin && curCoin.symbol) ? curCoin.symbol.toUpperCase() : 'BTC';
    headerTitle = 'CRYPTO';
  }

  const currCode = globalCurr;
  const pairKey = assetSym + '_' + currCode;
  const pairSymbol = assetSym + '/' + currCode;
  const data = cryptoPriceCache[pairKey] || { price: (isStock ? 352.16 : 75100), change24h: 2.40, isUp: true };
  const priceStr = formatCryptoDisplayPrice(data.price, currCode);
  const changeNumStr = (data.isUp ? '+' : '') + Math.abs(data.change24h).toFixed(2) + '%';
  const changeFullStr = '24h ' + changeNumStr;
  const arrowStr = data.isUp ? '▲' : '▼';

  // 1. Grid Layar OLED Robot (Page 3)
  const prevCoin = document.getElementById('previewCryptoCoin');
  const prevPrice = document.getElementById('previewCryptoPrice');
  const prevChange = document.getElementById('previewCryptoChange');
  const prevHeader = document.getElementById('previewCryptoHeaderTitle');
  if (prevCoin) prevCoin.textContent = pairSymbol;
  if (prevPrice) prevPrice.textContent = priceStr;
  if (prevChange) prevChange.textContent = changeFullStr;
  if (prevHeader) prevHeader.textContent = headerTitle;

  // 2. Stage Virtual OLED Detail View
  const stageHeader = document.getElementById('stageCryptoHeaderTitle');
  const stageSym = document.getElementById('stageCryptoSymbol');
  const stagePrice = document.getElementById('stageCryptoPrice');
  const stageArrow = document.getElementById('stageCryptoArrow');
  const stageChange = document.getElementById('stageCryptoChange');
  if (stageHeader) stageHeader.textContent = headerTitle;
  if (stageSym) stageSym.textContent = assetSym + ' / ' + currCode;
  if (stagePrice) stagePrice.textContent = priceStr;
  if (stageArrow) stageArrow.textContent = arrowStr;
  if (stageChange) stageChange.textContent = changeFullStr;

  // Sorot slot chip yang aktif pada baris slot
  const cryptoChips = document.querySelectorAll('#cryptoCoinsSlotsBar .chip-preset');
  cryptoChips.forEach((chip, i) => {
    chip.classList.toggle('active', (!isStock && i === currentVirtualRotationIndex));
  });
  const stockChips = document.querySelectorAll('#stockSlotsBar .chip-preset');
  stockChips.forEach((chip, i) => {
    chip.classList.toggle('active', (isStock && i === (currentVirtualRotationIndex - cCount)));
  });
}

function sendAllTickerItemsToRobot() {
  const cCount = configuredCryptoCoins.length;
  const sCount = configuredStocks.length;
  const total = cCount + sCount;
  const globalCurr = (currentCryptoCurrency && currentCryptoCurrency.code) ? currentCryptoCurrency.code.toUpperCase() : 'USD';

  // Kirim semua slot Crypto (index 0 .. cCount - 1)
  configuredCryptoCoins.forEach((coin, idx) => {
    const assetSym = coin.symbol.toUpperCase();
    const pairKey = assetSym + '_' + globalCurr;
    const pairSymbol = assetSym + '/' + globalCurr;
    const data = cryptoPriceCache[pairKey] || { price: 75100, change24h: 2.40, isUp: true };
    const priceStr = formatCryptoDisplayPrice(data.price, globalCurr);
    const changeStr = (data.isUp ? '+' : '') + Math.abs(data.change24h).toFixed(2) + '%';
    const isCurrentActive = (idx === currentVirtualRotationIndex);

    sendCommand({
      c: 'crypto',
      idx: idx,
      total: total,
      sym: pairSymbol,
      price: priceStr,
      chg: changeStr,
      is_up: data.isUp,
      title: 'CRYPTO',
      force: isCurrentActive
    }, false);
  });

  // Kirim semua slot Saham (index cCount .. total - 1) menggunakan globalCurr (USD)
  configuredStocks.forEach((stock, sIdx) => {
    const globalIdx = cCount + sIdx;
    const assetSym = stock.symbol.toUpperCase();
    const pairKey = assetSym + '_' + globalCurr;
    const pairSymbol = assetSym + '/' + globalCurr;
    const data = cryptoPriceCache[pairKey] || { price: 352.16, change24h: 2.85, isUp: true };
    const priceStr = formatCryptoDisplayPrice(data.price, globalCurr);
    const changeStr = (data.isUp ? '+' : '') + Math.abs(data.change24h).toFixed(2) + '%';
    const isCurrentActive = (globalIdx === currentVirtualRotationIndex);

    sendCommand({
      c: 'crypto',
      idx: globalIdx,
      total: total,
      sym: pairSymbol,
      price: priceStr,
      chg: changeStr,
      is_up: data.isUp,
      title: 'SAHAM',
      force: isCurrentActive
    }, false);
  });
}

function sendCryptoDataToRobot() {
  sendAllTickerItemsToRobot();
}

async function fetchSingleCryptoPrice(coin, currCode) {
  const coinSym = coin.symbol.toUpperCase();
  const pairKey = coinSym + '_' + currCode;
  let gotPrice = false;
  let priceVal = 0;
  let changeVal = 0;

  // 1. Ambil dari Gate.io (Sangat cepat, live spot, 24h change akurat, CORS enabled)
  try {
    const gateUrl = 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=' + encodeURIComponent(coinSym + '_USDT');
    const gateData = await fetchGeocoding(gateUrl, 3000);
    if (Array.isArray(gateData) && gateData.length > 0 && gateData[0].last) {
      const usdPrice = parseFloat(gateData[0].last);
      changeVal = parseFloat(gateData[0].change_percentage) || 0;

      const effRate = (usdToIdrRate > 10000 && usdToIdrRate < 25000) ? usdToIdrRate : 18050;
      if (currCode === 'USD' || currCode === 'USDT') {
        priceVal = usdPrice;
        gotPrice = true;
      } else if (currCode === 'IDR') {
        priceVal = usdPrice * effRate;
        gotPrice = true;
      } else {
        priceVal = usdPrice;
        gotPrice = true;
      }
    }
  } catch (e) {}

  // 2. Cek Indodax jika mata uang IDR untuk memastikan harga lokal bursa Indonesia
  if (currCode === 'IDR') {
    try {
      const idxUrl = 'https://indodax.com/api/ticker/' + coinSym.toLowerCase() + 'idr';
      const idxData = await fetchGeocoding(idxUrl, 2500);
      if (idxData && idxData.ticker && idxData.ticker.last) {
        const idxPrice = parseFloat(idxData.ticker.last);
        if (idxPrice > 0) {
          priceVal = idxPrice;
          gotPrice = true;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback ke CoinGecko untuk coin langka/DEX jika Gate.io tidak punya
  if (!gotPrice) {
    try {
      const coinId = coin.id || coinSym.toLowerCase();
      const vsCurrs = currCode.toLowerCase() + ',usd';
      const cgUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(coinId) +
                    '&vs_currencies=' + vsCurrs + '&include_24hr_change=true';
      const cgData = await fetchGeocoding(cgUrl, 3000);
      if (cgData && cgData[coinId]) {
        const item = cgData[coinId];
        const cKey = currCode.toLowerCase();
        const effRate = (usdToIdrRate > 10000 && usdToIdrRate < 25000) ? usdToIdrRate : 18050;
        if (typeof item[cKey] === 'number') {
          priceVal = item[cKey];
          changeVal = item[cKey + '_24h_change'] || item['usd_24h_change'] || 0;
          gotPrice = true;
        } else if (typeof item.usd === 'number') {
          priceVal = (currCode === 'IDR') ? (item.usd * effRate) : item.usd;
          changeVal = item.usd_24h_change || 0;
          gotPrice = true;
        }
      }
    } catch (e) {}
  }

  if (gotPrice && priceVal > 0) {
    cryptoPriceCache[pairKey] = {
      price: priceVal,
      change24h: changeVal,
      isUp: (changeVal >= 0)
    };
  }
}

async function fetchSingleStockPrice(stock, currCode) {
  const stockSym = stock.symbol.toUpperCase();
  let qSym = stock.querySym || stockSym;

  // Hanya tambahkan .JK jika saham memang terdaftar di bursa IDX
  if (!qSym.includes('.') && stock.market === 'IDX') {
    qSym = stockSym + '.JK';
  }

  const pairKey = stockSym + '_' + currCode;
  let gotPrice = false;
  let priceVal = 0;
  let changeVal = 0;

  try {
    let yfUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(qSym) + '?interval=1d';
    let yfData = await fetchGeocoding(yfUrl, 3000);

    if (yfData && yfData.chart && Array.isArray(yfData.chart.result) && yfData.chart.result.length > 0) {
      const meta = yfData.chart.result[0].meta;
      if (meta && typeof meta.regularMarketPrice === 'number') {
        const rawPrice = meta.regularMarketPrice;
        const baseCurr = (meta.currency || 'USD').toUpperCase();
        changeVal = meta.regularMarketChangePercent || 0;
        if (changeVal === 0 && typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0) {
          changeVal = ((rawPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
        }

        const effRate = (usdToIdrRate > 10000 && usdToIdrRate < 25000) ? usdToIdrRate : 18050;
        if (currCode === baseCurr) {
          priceVal = rawPrice;
        } else if (baseCurr === 'IDR' && currCode === 'USD') {
          priceVal = rawPrice / effRate;
        } else if (baseCurr === 'USD' && currCode === 'IDR') {
          priceVal = rawPrice * effRate;
        } else {
          priceVal = rawPrice;
        }
        gotPrice = true;
      }
    }
  } catch (e) {}

  if (gotPrice && priceVal > 0) {
    cryptoPriceCache[pairKey] = {
      price: priceVal,
      change24h: changeVal,
      isUp: (changeVal >= 0)
    };
  }
}

async function fetchCryptoLivePrices() {
  if (isCryptoFetching) return;
  isCryptoFetching = true;

  const globalCurr = (currentCryptoCurrency && currentCryptoCurrency.code) ? currentCryptoCurrency.code.toUpperCase() : 'USD';

  try {
    // 1. Ambil estimasi kurs live USDT/IDR dari Indodax / open.er-api secara non-blocking
    try {
      const idrData = await fetchGeocoding('https://indodax.com/api/ticker/usdtidr', 2000).catch(async () => {
        return await fetchGeocoding('https://open.er-api.com/v6/latest/USD', 2000);
      });
      if (idrData && idrData.ticker && idrData.ticker.last) {
        const r = parseFloat(idrData.ticker.last);
        if (r > 10000 && r < 25000) usdToIdrRate = r;
      } else if (idrData && idrData.rates && idrData.rates.IDR) {
        const r = parseFloat(idrData.rates.IDR);
        if (r > 10000 && r < 25000) usdToIdrRate = r;
      }
    } catch (e) {}

    // 2. Fetch parallel semua coin crypto yang dikonfigurasi (maks 5)
    const cryptoFetches = configuredCryptoCoins.map(coin => fetchSingleCryptoPrice(coin, globalCurr));

    // 3. Fetch parallel semua saham yang dikonfigurasi (maks 5) menggunakan globalCurr (USD)
    const stockFetches = configuredStocks.map(stock => fetchSingleStockPrice(stock, globalCurr));

    await Promise.allSettled([...cryptoFetches, ...stockFetches]);

    updateOledCryptoPreview();
    sendAllTickerItemsToRobot();
  } catch (err) {
    console.warn('[TICKER] Gagal mengambil data harga live:', err);
    updateOledCryptoPreview();
    sendAllTickerItemsToRobot();
  } finally {
    isCryptoFetching = false;
  }
}

let cryptoAutoInterval = null;
function startCryptoInterval() {
  if (cryptoAutoInterval) clearInterval(cryptoAutoInterval);
  cryptoAutoInterval = setInterval(() => {
    if (currentOpenDetailFeature === 'crypto' || currentRobotMode === 20) {
      fetchCryptoLivePrices();
    }
  }, 30000); // Sinkronisasi otomatis setiap 30 detik saat aktif
}

let s_cryptoLiveDebounce = null;
function debouncedFetchCrypto() {
  if (s_cryptoLiveDebounce) clearTimeout(s_cryptoLiveDebounce);
  s_cryptoLiveDebounce = setTimeout(() => {
    fetchCryptoLivePrices();
  }, 250);
}

// Live Autocomplete Pencarian Coin Crypto (Pola sama persis Cuaca & Jadwal Sholat)
function searchCryptoCoinSuggestions(query) {
  const dropdown = document.getElementById('cryptoCoinDropdown');
  if (!dropdown) return;

  const clean = (query || '').trim().toUpperCase();
  dropdown.innerHTML = '';

  if (cryptoActiveAbortController) {
    try { cryptoActiveAbortController.abort(); } catch (e) {}
    cryptoActiveAbortController = null;
  }

  let matches = [];
  if (clean.length === 0) {
    matches = CRYPTO_POPULAR_COINS.slice(0, 8);
  } else {
    matches = CRYPTO_POPULAR_COINS.filter(c =>
      c.symbol.toUpperCase().includes(clean) ||
      c.name.toUpperCase().includes(clean)
    ).slice(0, 8);
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="city-item-empty">Tidak ada coin yang cocok</div>';
    dropdown.style.display = 'block';
  } else {
    matches.forEach(item => {
      const row = document.createElement('div');
      row.className = 'city-autocomplete-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'city-item-name';
      nameEl.textContent = item.symbol;

      const descEl = document.createElement('span');
      descEl.className = 'city-item-desc';
      descEl.textContent = item.name;

      row.appendChild(nameEl);
      row.appendChild(descEl);

      row.addEventListener('click', () => {
        selectedCryptoCoin = item;
        const input = document.getElementById('cfgCryptoCoinInput');
        if (input) input.value = item.symbol + ' - ' + item.name;
        dropdown.style.display = 'none';
        triggerHaptic(20);
      });

      dropdown.appendChild(row);
    });
    dropdown.style.display = 'block';
  }

  // Cari seluruh coin di dunia dari CoinGecko jika query >= 2 karakter
  if (clean.length >= 2) {
    const ctrl = new AbortController();
    cryptoActiveAbortController = ctrl;
    const cgSearchUrl = 'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(clean);

    fetch(cgSearchUrl, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(res => res.ok ? res.json() : null)
      .then(res => {
        const currentInput = (document.getElementById('cfgCryptoCoinInput')?.value || '').trim().toUpperCase();
        if (!currentInput.includes(clean)) return;

        if (res && Array.isArray(res.coins) && res.coins.length > 0) {
          if (matches.length === 0) {
            dropdown.innerHTML = '';
          }
          res.coins.slice(0, 5).forEach(c => {
            const sym = c.symbol.toUpperCase();
            if (!matches.some(m => m.symbol.toUpperCase() === sym)) {
              const row = document.createElement('div');
              row.className = 'city-autocomplete-item';

              const nameEl = document.createElement('span');
              nameEl.className = 'city-item-name';
              nameEl.textContent = sym;

              const descEl = document.createElement('span');
              descEl.className = 'city-item-desc';
              descEl.textContent = c.name + (c.market_cap_rank ? (' (Rank #' + c.market_cap_rank + ')') : '');

              row.appendChild(nameEl);
              row.appendChild(descEl);

              row.addEventListener('click', () => {
                selectedCryptoCoin = { symbol: sym, name: c.name, id: c.id };
                const input = document.getElementById('cfgCryptoCoinInput');
                if (input) input.value = sym + ' - ' + c.name;
                dropdown.style.display = 'none';
                triggerHaptic(20);
              });

              dropdown.appendChild(row);
              matches.push({ symbol: sym, name: c.name, id: c.id });
            }
          });
          dropdown.style.display = 'block';
        } else if (matches.length === 0) {
          dropdown.innerHTML = '<div class="city-item-empty">Tidak ada coin yang cocok</div>';
          dropdown.style.display = 'block';
        }
      })
      .catch(() => {
        if (matches.length === 0) {
          dropdown.innerHTML = '<div class="city-item-empty">Tidak ada coin yang cocok</div>';
          dropdown.style.display = 'block';
        }
      });
  }
}

// Live Autocomplete Pencarian Saham (Pola sama persis Cuaca & Jadwal Sholat)
function searchStockSuggestions(query) {
  const dropdown = document.getElementById('stockDropdown');
  if (!dropdown) return;

  const clean = (query || '').trim().toUpperCase();
  dropdown.innerHTML = '';

  if (stockActiveAbortController) {
    try { stockActiveAbortController.abort(); } catch (e) {}
    stockActiveAbortController = null;
  }

  let matches = [];
  if (clean.length === 0) {
    matches = STOCK_POPULAR_LIST.slice(0, 8);
  } else {
    matches = STOCK_POPULAR_LIST.filter(s =>
      s.symbol.toUpperCase().includes(clean) ||
      s.name.toUpperCase().includes(clean) ||
      (s.querySym && s.querySym.toUpperCase().includes(clean))
    ).slice(0, 8);
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="city-item-empty">Tidak ada saham yang cocok</div>';
    dropdown.style.display = 'block';
  } else {
    matches.forEach(item => {
      const row = document.createElement('div');
      row.className = 'city-autocomplete-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'city-item-name';
      nameEl.textContent = item.symbol + (item.market ? (' [' + item.market + ']') : '');

      const descEl = document.createElement('span');
      descEl.className = 'city-item-desc';
      descEl.textContent = item.name;

      row.appendChild(nameEl);
      row.appendChild(descEl);

      row.addEventListener('click', () => {
        selectedStock = item;
        const input = document.getElementById('cfgStockInput');
        if (input) input.value = item.symbol + ' - ' + item.name;
        dropdown.style.display = 'none';
        triggerHaptic(20);
      });

      dropdown.appendChild(row);
    });
    dropdown.style.display = 'block';
  }

  // Cari seluruh saham di dunia dari Yahoo Finance jika query >= 2 karakter
  if (clean.length >= 2) {
    const ctrl = new AbortController();
    stockActiveAbortController = ctrl;
    const yfSearchUrl = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(clean) + '&quotesCount=8&newsCount=0';

    fetch(yfSearchUrl, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(res => res.ok ? res.json() : null)
      .then(res => {
        const currentInput = (document.getElementById('cfgStockInput')?.value || '').trim().toUpperCase();
        if (!currentInput.includes(clean)) return;

        if (res && Array.isArray(res.quotes) && res.quotes.length > 0) {
          if (matches.length === 0) {
            dropdown.innerHTML = '';
          }
          res.quotes.slice(0, 5).forEach(q => {
            if (!q.symbol) return;
            const symClean = q.symbol.toUpperCase();
            const baseSym = symClean.replace(/\.JK$/, '');
            if (!matches.some(m => m.symbol.toUpperCase() === symClean || m.symbol.toUpperCase() === baseSym)) {
              const row = document.createElement('div');
              row.className = 'city-autocomplete-item';

              const nameEl = document.createElement('span');
              nameEl.className = 'city-item-name';
              nameEl.textContent = symClean + (q.exchDisp ? (' [' + q.exchDisp + ']') : '');

              const descEl = document.createElement('span');
              descEl.className = 'city-item-desc';
              descEl.textContent = q.shortname || q.longname || symClean;

              row.appendChild(nameEl);
              row.appendChild(descEl);

              row.addEventListener('click', () => {
                selectedStock = {
                  symbol: baseSym,
                  querySym: symClean,
                  name: q.shortname || q.longname || baseSym,
                  market: symClean.endsWith('.JK') ? 'IDX' : (q.exchDisp || 'GLOBAL'),
                  curr: symClean.endsWith('.JK') ? 'IDR' : 'USD'
                };
                const input = document.getElementById('cfgStockInput');
                if (input) input.value = baseSym + ' - ' + (q.shortname || baseSym);
                dropdown.style.display = 'none';
                triggerHaptic(20);
              });

              dropdown.appendChild(row);
              matches.push({ symbol: baseSym, querySym: symClean, name: q.shortname || baseSym });
            }
          });
          dropdown.style.display = 'block';
        } else if (matches.length === 0) {
          dropdown.innerHTML = '<div class="city-item-empty">Tidak ada saham yang cocok</div>';
          dropdown.style.display = 'block';
        }
      })
      .catch(() => {
        if (matches.length === 0) {
          dropdown.innerHTML = '<div class="city-item-empty">Tidak ada saham yang cocok</div>';
          dropdown.style.display = 'block';
        }
      });
  }
}

// Live Autocomplete Pencarian Mata Uang (Pola sama persis Cuaca & Jadwal Sholat)
function searchCryptoCurrencySuggestions(query) {
  const dropdown = document.getElementById('cryptoCurrencyDropdown');
  if (!dropdown) return;

  const clean = (query || '').trim().toUpperCase();
  dropdown.innerHTML = '';

  let matches = [];
  if (clean.length === 0) {
    matches = CRYPTO_ALL_CURRENCIES.slice(0, 8);
  } else {
    matches = CRYPTO_ALL_CURRENCIES.filter(c =>
      c.code.toUpperCase().includes(clean) ||
      c.name.toUpperCase().includes(clean)
    ).slice(0, 8);
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="city-item-empty">Tidak ada mata uang yang cocok</div>';
    dropdown.style.display = 'block';
    return;
  }

  matches.forEach(item => {
    const row = document.createElement('div');
    row.className = 'city-autocomplete-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'city-item-name';
    nameEl.textContent = item.code + ' (' + item.symbol + ')';

    const descEl = document.createElement('span');
    descEl.className = 'city-item-desc';
    descEl.textContent = item.name;

    row.appendChild(nameEl);
    row.appendChild(descEl);

    row.addEventListener('click', () => {
      selectedCryptoCurrency = item;
      const input = document.getElementById('cfgCryptoCurrencyInput');
      if (input) input.value = item.code + ' - ' + item.name;
      dropdown.style.display = 'none';
      triggerHaptic(20);
    });

    dropdown.appendChild(row);
  });

  dropdown.style.display = 'block';
}

function setCryptoCoinBtnState(state, text) {
  const btn = document.getElementById('btnSearchCryptoCoin');
  const input = document.getElementById('cfgCryptoCoinInput');
  const txt = document.getElementById('txtSearchCryptoCoinBtn');

  if (state === 'loading') {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('disabled', 'is-loading');
      btn.classList.remove('is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.add('is-processing');
      input.readOnly = true;
    }
    if (txt) {
      txt.innerHTML = '<span class="weather-spinner-cyber"></span> MEMPROSES COIN...';
    }
  } else if (state === 'error') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-shaking');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'COIN TIDAK DITEMUKAN';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-shaking');
    }, 450);
    setTimeout(() => {
      if (!isApplyingCryptoCoin && txt) {
        txt.textContent = 'TERAPKAN COIN CRYPTO';
      }
    }, 2400);
  } else if (state === 'success') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'COIN BERHASIL DIATUR';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-success');
    }, 550);
    setTimeout(() => {
      if (!isApplyingCryptoCoin && txt) {
        txt.textContent = 'TERAPKAN COIN CRYPTO';
      }
    }, 2000);
  } else {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading', 'is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = 'TERAPKAN COIN CRYPTO';
    }
  }
}

function setStockBtnState(state, text) {
  const btn = document.getElementById('btnSearchStock');
  const input = document.getElementById('cfgStockInput');
  const txt = document.getElementById('txtSearchStockBtn');

  if (state === 'loading') {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('disabled', 'is-loading');
      btn.classList.remove('is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.add('is-processing');
      input.readOnly = true;
    }
    if (txt) {
      txt.innerHTML = '<span class="weather-spinner-cyber"></span> MEMPROSES SAHAM...';
    }
  } else if (state === 'error') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-shaking');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'SAHAM TIDAK DITEMUKAN';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-shaking');
    }, 450);
    setTimeout(() => {
      if (!isApplyingStock && txt) {
        txt.textContent = 'TERAPKAN SAHAM';
      }
    }, 2400);
  } else if (state === 'success') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'SAHAM BERHASIL DIATUR';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-success');
    }, 550);
    setTimeout(() => {
      if (!isApplyingStock && txt) {
        txt.textContent = 'TERAPKAN SAHAM';
      }
    }, 2000);
  } else {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading', 'is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = 'TERAPKAN SAHAM';
    }
  }
}

function setCryptoCurrencyBtnState(state, text) {
  const btn = document.getElementById('btnSearchCryptoCurrency');
  const input = document.getElementById('cfgCryptoCurrencyInput');
  const txt = document.getElementById('txtSearchCryptoCurrencyBtn');

  if (state === 'loading') {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('disabled', 'is-loading');
      btn.classList.remove('is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.add('is-processing');
      input.readOnly = true;
    }
    if (txt) {
      txt.innerHTML = '<span class="weather-spinner-cyber"></span> MEMPROSES MATA UANG...';
    }
  } else if (state === 'error') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-shaking');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'MATA UANG TIDAK COCOK';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-shaking');
    }, 450);
    setTimeout(() => {
      if (!isApplyingCryptoCurrency && txt) {
        txt.textContent = 'TERAPKAN MATA UANG';
      }
    }, 2400);
  } else if (state === 'success') {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading');
      btn.classList.add('is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = text || 'MATA UANG BERHASIL DIATUR';
    }
    setTimeout(() => {
      if (btn) btn.classList.remove('is-success');
    }, 550);
    setTimeout(() => {
      if (!isApplyingCryptoCurrency && txt) {
        txt.textContent = 'TERAPKAN MATA UANG';
      }
    }, 2000);
  } else {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('disabled', 'is-loading', 'is-shaking', 'is-success');
      btn.blur();
    }
    if (input) {
      input.classList.remove('is-processing');
      input.readOnly = false;
    }
    if (txt) {
      txt.textContent = 'TERAPKAN MATA UANG';
    }
  }
}

async function applyCryptoCoin(isFromCycle = false) {
  if (isApplyingCryptoCoin) return;
  const input = document.getElementById('cfgCryptoCoinInput');
  const raw = (input ? input.value : '').trim();

  let targetCoin = selectedCryptoCoin;
  if (!targetCoin && raw.length > 0) {
    const sym = raw.split(/[-–—/]/)[0].trim().toUpperCase();
    targetCoin = CRYPTO_POPULAR_COINS.find(c => c.symbol.toUpperCase() === sym);
  }

  if (!targetCoin) {
    triggerHaptic(40);
    setCryptoCoinBtnState('error', 'COIN TIDAK DITEMUKAN');
    return;
  }

  currentActiveAssetType = 'crypto';
  try {
    localStorage.setItem('robot_cfg_active_asset_type', 'crypto');
  } catch (e) {}

  isApplyingCryptoCoin = true;
  triggerHaptic(25);
  setCryptoCoinBtnState('loading');

  // Simpan ke slot yang sedang aktif dipilih (1..5)
  configuredCryptoCoins[activeCryptoSlotIndex] = { ...targetCoin };
  currentCryptoCoin = configuredCryptoCoins[activeCryptoSlotIndex];
  saveConfiguredAssets();
  renderCryptoSlotsUI();

  currentVirtualRotationIndex = activeCryptoSlotIndex;
  updateOledCryptoPreview();

  try {
    // Berpindah ke mode 20 di robot dan sinkronkan slot aktif
    sendCommand({ c: 'm', v: 20 }, true);
    sendCommand({ c: 'crypto_cycle', idx: currentVirtualRotationIndex }, true);

    await fetchCryptoLivePrices();
    triggerHaptic(30);
    setCryptoCoinBtnState('success', 'SLOT ' + (activeCryptoSlotIndex + 1) + ': ' + targetCoin.symbol + ' AKTIF');
    showNeonToast('Slot ' + (activeCryptoSlotIndex + 1) + ' Coin Diatur: ' + targetCoin.symbol);
  } catch (e) {
    setCryptoCoinBtnState('error', 'GAGAL MEMUAT HARGA');
  } finally {
    isApplyingCryptoCoin = false;
  }
}

async function applyStock(isFromCycle = false) {
  if (isApplyingStock) return;
  const input = document.getElementById('cfgStockInput');
  const raw = (input ? input.value : '').trim();

  let targetStock = selectedStock;
  if (!targetStock && raw.length > 0) {
    const sym = raw.split(/[-–—/]/)[0].trim().toUpperCase();
    targetStock = STOCK_POPULAR_LIST.find(s => s.symbol.toUpperCase() === sym);
  }

  if (!targetStock) {
    triggerHaptic(40);
    setStockBtnState('error', 'SAHAM TIDAK DITEMUKAN');
    return;
  }

  currentActiveAssetType = 'stock';
  try {
    localStorage.setItem('robot_cfg_active_asset_type', 'stock');
  } catch (e) {}

  isApplyingStock = true;
  triggerHaptic(25);
  setStockBtnState('loading');

  // Simpan ke slot saham yang sedang aktif dipilih (1..5)
  configuredStocks[activeStockSlotIndex] = { ...targetStock };
  currentStock = configuredStocks[activeStockSlotIndex];
  saveConfiguredAssets();
  renderStockSlotsUI();

  currentVirtualRotationIndex = configuredCryptoCoins.length + activeStockSlotIndex;
  updateOledCryptoPreview();

  try {
    // Berpindah ke mode 20 di robot dan sinkronkan slot aktif
    sendCommand({ c: 'm', v: 20 }, true);
    sendCommand({ c: 'crypto_cycle', idx: currentVirtualRotationIndex }, true);

    await fetchCryptoLivePrices();
    triggerHaptic(30);
    setStockBtnState('success', 'SLOT ' + (activeStockSlotIndex + 1) + ': ' + targetStock.symbol + ' AKTIF');
    showNeonToast('Slot ' + (activeStockSlotIndex + 1) + ' Saham Diatur: ' + targetStock.symbol);
  } catch (e) {
    setStockBtnState('error', 'GAGAL MEMUAT HARGA');
  } finally {
    isApplyingStock = false;
  }
}

async function applyCryptoCurrency() {
  if (isApplyingCryptoCurrency) return;
  const input = document.getElementById('cfgCryptoCurrencyInput');
  const raw = (input ? input.value : '').trim();

  let targetCurr = selectedCryptoCurrency;
  if (!targetCurr && raw.length > 0) {
    const code = raw.split(/[-–—/]/)[0].trim().toUpperCase();
    targetCurr = CRYPTO_ALL_CURRENCIES.find(c => c.code.toUpperCase() === code);
  }

  if (!targetCurr) {
    triggerHaptic(40);
    setCryptoCurrencyBtnState('error', 'MATA UANG TIDAK COCOK');
    return;
  }

  isApplyingCryptoCurrency = true;
  triggerHaptic(25);
  setCryptoCurrencyBtnState('loading');

  currentCryptoCurrency = targetCurr;
  CRYPTO_CURRENCY_SYMBOLS[targetCurr.code] = targetCurr.symbol;

  try {
    localStorage.setItem('robot_cfg_crypto_curr_code', targetCurr.code);
    localStorage.setItem('robot_cfg_crypto_curr_name', targetCurr.name);
    localStorage.setItem('robot_cfg_crypto_curr_symbol', targetCurr.symbol);
    await fetchCryptoLivePrices();
    triggerHaptic(30);
    setCryptoCurrencyBtnState('success', targetCurr.code + ' AKTIF');
    showNeonToast('Mata Uang diatur: ' + targetCurr.code);
  } catch (e) {
    setCryptoCurrencyBtnState('error', 'GAGAL MEMUAT HARGA');
  } finally {
    isApplyingCryptoCurrency = false;
  }
}

function cycleCryptoCoinApp() {
  triggerHaptic(30);
  const total = configuredCryptoCoins.length + configuredStocks.length;
  if (total > 1) {
    currentVirtualRotationIndex = (currentVirtualRotationIndex + 1) % total;
    updateOledCryptoPreview();
    sendCommand({ c: 'm', v: 20 }, true);
    sendCommand({ c: 'crypto_cycle', idx: currentVirtualRotationIndex }, true);
  }
}

function startCryptoInterval() {
  if (cryptoRefreshTimer) clearInterval(cryptoRefreshTimer);
  cryptoRefreshTimer = setInterval(() => {
    if (currentOpenDetailFeature === 'crypto' || currentRobotMode === 20) {
      fetchCryptoLivePrices();
    } else {
      clearInterval(cryptoRefreshTimer);
      cryptoRefreshTimer = null;
    }
  }, CRYPTO_AUTO_REFRESH_INTERVAL);
}

function initCryptoFeature() {
  // 1. Muat preferensi tipe aset aktif yang terakhir dipilih
  const savedType = localStorage.getItem('robot_cfg_active_asset_type');
  if (savedType === 'stock' || savedType === 'crypto') {
    currentActiveAssetType = savedType;
  }

  // 2. Render UI slot chips multi-asset
  renderCryptoSlotsUI();
  renderStockSlotsUI();
  updateRotationBadgeUI();

  // 3. Muat preferensi Mata Uang tersimpan
  const savedCurrCode = localStorage.getItem('robot_cfg_crypto_curr_code');
  const savedCurrName = localStorage.getItem('robot_cfg_crypto_curr_name');
  const savedCurrSymbol = localStorage.getItem('robot_cfg_crypto_curr_symbol');
  if (savedCurrCode) {
    currentCryptoCurrency = {
      code: savedCurrCode,
      name: savedCurrName || savedCurrCode,
      symbol: savedCurrSymbol || (savedCurrCode + ' ')
    };
    CRYPTO_CURRENCY_SYMBOLS[savedCurrCode] = currentCryptoCurrency.symbol;
  }

  // 4. Inisialisasi Teks di Ketiga Kotak Input
  const coinInput = document.getElementById('cfgCryptoCoinInput');
  if (coinInput) {
    const curCoin = configuredCryptoCoins[activeCryptoSlotIndex] || configuredCryptoCoins[0];
    if (curCoin) coinInput.value = curCoin.symbol + ' - ' + curCoin.name;
    coinInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (cryptoCoinSearchTimer) clearTimeout(cryptoCoinSearchTimer);
      cryptoCoinSearchTimer = setTimeout(() => {
        searchCryptoCoinSuggestions(q);
      }, 200);
    });
    coinInput.addEventListener('focus', (e) => {
      searchCryptoCoinSuggestions(e.target.value);
    });
    coinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dropdown = document.getElementById('cryptoCoinDropdown');
        if (dropdown) dropdown.style.display = 'none';
        applyCryptoCoin(false);
      }
    });
  }

  const stockInput = document.getElementById('cfgStockInput');
  if (stockInput) {
    const curStock = configuredStocks[activeStockSlotIndex] || configuredStocks[0];
    if (curStock) stockInput.value = curStock.symbol + ' - ' + curStock.name;
    stockInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (stockSearchTimer) clearTimeout(stockSearchTimer);
      stockSearchTimer = setTimeout(() => {
        searchStockSuggestions(q);
      }, 200);
    });
    stockInput.addEventListener('focus', (e) => {
      searchStockSuggestions(e.target.value);
    });
    stockInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dropdown = document.getElementById('stockDropdown');
        if (dropdown) dropdown.style.display = 'none';
        applyStock(false);
      }
    });
  }

  const currInput = document.getElementById('cfgCryptoCurrencyInput');
  if (currInput && currentCryptoCurrency) {
    currInput.value = currentCryptoCurrency.code + ' - ' + currentCryptoCurrency.name;
    currInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (cryptoCurrencySearchTimer) clearTimeout(cryptoCurrencySearchTimer);
      cryptoCurrencySearchTimer = setTimeout(() => {
        searchCryptoCurrencySuggestions(q);
      }, 200);
    });
    currInput.addEventListener('focus', (e) => {
      searchCryptoCurrencySuggestions(e.target.value);
    });
    currInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dropdown = document.getElementById('cryptoCurrencyDropdown');
        if (dropdown) dropdown.style.display = 'none';
        applyCryptoCurrency();
      }
    });
  }

  // 6. Klik di luar dropdown menutup ketiga dropdown
  document.addEventListener('click', (e) => {
    const coinDrop = document.getElementById('cryptoCoinDropdown');
    const coinIn = document.getElementById('cfgCryptoCoinInput');
    if (coinDrop && !coinDrop.contains(e.target) && e.target !== coinIn) {
      coinDrop.style.display = 'none';
    }

    const stockDrop = document.getElementById('stockDropdown');
    const stockIn = document.getElementById('cfgStockInput');
    if (stockDrop && !stockDrop.contains(e.target) && e.target !== stockIn) {
      stockDrop.style.display = 'none';
    }

    const currDrop = document.getElementById('cryptoCurrencyDropdown');
    const currIn = document.getElementById('cfgCryptoCurrencyInput');
    if (currDrop && !currDrop.contains(e.target) && e.target !== currIn) {
      currDrop.style.display = 'none';
    }
  });

  // 7. Cegah tombol tersangkut hover di layar sentuh HP
  ['btnSearchCryptoCoin', 'btnSearchStock', 'btnSearchCryptoCurrency'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('pointerup', function() { btn.blur(); });
      btn.addEventListener('touchend', function() { btn.blur(); });
      btn.addEventListener('mouseleave', function() { btn.blur(); });
    }
  });

  updateOledCryptoPreview();
}

// =======================================================
// PENGATURAN HARDWARE ROBOT (CYBER NEON)
// =======================================================

// 1. Slider Kecerahan Layar OLED
let s_brightnessDebounce = null;
function onBrightnessSliderInput(val) {
  const badge = document.getElementById('txtOledBrightnessVal');
  if (badge) badge.textContent = val + '%';

  const intVal = parseInt(val, 10);
  const rawByte = Math.round((intVal * 255) / 100);

  if (s_brightnessDebounce) clearTimeout(s_brightnessDebounce);
  s_brightnessDebounce = setTimeout(() => {
    sendCommand({ c: 'bright', p: intVal, v: rawByte });
  }, 100);
}

function onBrightnessSliderChange(val) {
  const badge = document.getElementById('txtOledBrightnessVal');
  if (badge) badge.textContent = val + '%';

  const intVal = parseInt(val, 10);
  const rawByte = Math.round((intVal * 255) / 100);

  if (s_brightnessDebounce) clearTimeout(s_brightnessDebounce);
  sendCommand({ c: 'bright', p: intVal, v: rawByte });
  showNeonToast('Kecerahan: ' + val + '%');
  triggerHaptic(15);
}

// 2. Preset Auto-Sleep
function selectSleepPreset(sec, btnEl) {
  document.querySelectorAll('.setting-pill-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const badge = document.getElementById('txtActiveSleepBadge');
  const textVal = sec === 0 ? 'SELALU NYALA' : (sec / 60) + ' MENIT';
  if (badge) badge.textContent = textVal;

  sendCommand({ c: 'sleep_to', sec: sec });
  showNeonToast(sec === 0 ? 'Selalu Nyala' : 'Mode sleep: ' + (sec / 60) + ' Menit');
  triggerHaptic(20);
}

// 3. Custom Auto-Sleep Input (Validasi Ketat Minimal 15 Menit, Maksimal 60 Menit)
function applyCustomSleepSetting() {
  const input = document.getElementById('inputCustomSleepMin');
  if (!input) return;
  let min = parseInt(input.value, 10);
  if (isNaN(min) || min <= 0) {
    showNeonToast('Masukkan menit!');
    return;
  }

  if (min < 15) {
    input.value = 15;
    min = 15;
    showNeonToast('Minimal 15 menit!');
  } else if (min > 60) {
    input.value = 60;
    min = 60;
    showNeonToast('Maksimal 60 menit!');
  }

  const sec = min * 60;

  document.querySelectorAll('.setting-pill-btn').forEach(b => {
    const bSec = parseInt(b.getAttribute('data-sec'), 10);
    b.classList.toggle('active', bSec === sec);
  });

  const badge = document.getElementById('txtActiveSleepBadge');
  if (badge) badge.textContent = min + ' MENIT';

  sendCommand({ c: 'sleep_to', sec: sec });
  showNeonToast('Mode sleep: ' + min + ' Menit');
  triggerHaptic(20);
}

// 4. Tombol Layar Cepat (Tidur / Bangun)
function triggerQuickScreenSleep() {
  sendCommand({ c: 'sleep' });
  showNeonToast('Layar ditidurkan');
  triggerHaptic(20);
}

function triggerQuickScreenWake() {
  sendCommand({ c: 'wake' });
  showNeonToast('Layar dibangunkan');
  triggerHaptic(20);
}

// 5. Volume Buzzer & Getaran
let s_buzzerVolDebounce = null;
function onBuzzerVolumeInput(val) {
  const badge = document.getElementById('txtBuzzerVolumeVal');
  if (badge) badge.textContent = val + '%';
}

function onBuzzerVolumeChange(val) {
  const badge = document.getElementById('txtBuzzerVolumeVal');
  if (badge) badge.textContent = val + '%';
  const intVal = parseInt(val, 10);
  if (s_buzzerVolDebounce) clearTimeout(s_buzzerVolDebounce);
  s_buzzerVolDebounce = setTimeout(() => {
    sendCommand({ c: 'buzz_vol', v: intVal });
    showNeonToast('Volume: ' + val + '%');
    triggerHaptic(15);
  }, 60);
}

// 6. Diagnostik Perangkat Keras
function testHardwareBuzzer() {
  sendCommand({ c: 'buzzer', freq: 2000, dur: 150 });
  showNeonToast('Menguji buzzer...');
  triggerHaptic(20);
}

// 6. Modal Konfirmasi & Eksekusi Reboot
function openRebootConfirmModal() {
  const modal = document.getElementById('modalRebootConfirm');
  if (modal) modal.style.display = 'flex';
  triggerHaptic(20);
}

function closeRebootConfirmModal() {
  const modal = document.getElementById('modalRebootConfirm');
  if (modal) modal.style.display = 'none';
}

let s_rebootTimer = null;
let s_forceSetupGate = false;
function executeRebootCommand(sendBle = true) {
  closeRebootConfirmModal();
  const overlay = document.getElementById('overlayRebootProgress');
  const title = document.querySelector('.reboot-overlay-title');
  const sub = document.getElementById('txtRebootCountdown');

  s_isRebooting = true;
  isBleConnected = false;

  if (overlay) {
    overlay.classList.remove('failed');
    overlay.style.display = 'flex';
  }
  if (title) title.textContent = 'MEMULAI ULANG...';

  // Kirim perintah reboot ke robot (hanya jika sendBle = true)
  if (sendBle) {
    sendCommand({ c: 'reboot' });
  }
  triggerHaptic(40);

  if (s_rebootTimer) clearInterval(s_rebootTimer);

  // FASE 1: Hitung mundur restart hardware robot (6 detik)
  let restartCount = 6;
  if (sub) sub.textContent = `Memulai ulang robot (${restartCount}s)...`;

  s_rebootTimer = setInterval(() => {
    restartCount--;
    if (restartCount > 0) {
      if (sub) sub.textContent = `Memulai ulang robot (${restartCount}s)...`;
    } else {
      clearInterval(s_rebootTimer);
      s_rebootTimer = null;
      // FASE 2: Hubungkan kembali dengan durasi pencarian yang memadai
      attemptReconnectAfterReboot();
    }
  }, 1000);
}

function attemptReconnectAfterReboot() {
  const overlay = document.getElementById('overlayRebootProgress');
  const title = document.querySelector('.reboot-overlay-title');
  const sub = document.getElementById('txtRebootCountdown');

  if (title) title.textContent = 'MENGHUBUNGKAN KEMBALI...';
  if (sub) sub.textContent = 'Mencari koneksi robot...';

  // Panggil perintah connect native AndroidBLE
  if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
  }

  // Berikan waktu realistis 12 detik agar robot selesai booting dan menyalakan BLE
  let attemptSeconds = 12;
  if (s_rebootTimer) clearInterval(s_rebootTimer);

  s_rebootTimer = setInterval(() => {
    // Jika robot sudah berhasil tersambung kembali
    if (isBleConnected) {
      clearInterval(s_rebootTimer);
      s_rebootTimer = null;
      s_isRebooting = false;
      if (overlay) {
        overlay.classList.remove('failed');
        overlay.style.display = 'none';
      }
      showNeonToast('Robot berhasil terhubung kembali');
      triggerHaptic(40);
      return;
    }

    // Ping scan/koneksi ulang setiap 4 detik jika belum terhubung
    if (attemptSeconds % 4 === 0) {
      if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
        window.AndroidBLE.connect();
      }
    }

    attemptSeconds--;
    if (attemptSeconds > 0) {
      if (sub) sub.textContent = `Mencari koneksi robot (${attemptSeconds}s)...`;
    } else {
      clearInterval(s_rebootTimer);
      s_rebootTimer = null;

      // Cek sekali lagi apakah tersambung
      if (isBleConnected) {
        s_isRebooting = false;
        if (overlay) {
          overlay.classList.remove('failed');
          overlay.style.display = 'none';
        }
        showNeonToast('Robot berhasil terhubung kembali');
        triggerHaptic(40);
        return;
      }

      // FASE 3: Jika setelah total waktu habis robot benar-benar tidak merespons
      showRebootFailAndRedirect();
    }
  }, 1000);
}

function showRebootFailAndRedirect() {
  const overlay = document.getElementById('overlayRebootProgress');
  const title = document.querySelector('.reboot-overlay-title');
  const sub = document.getElementById('txtRebootCountdown');

  s_isRebooting = false;

  // Hentikan proses scanning/koneksi background agar tidak tiba-tiba menyambung setelah dinyatakan gagal
  if (window.AndroidBLE && typeof window.AndroidBLE.disconnect === 'function') {
    window.AndroidBLE.disconnect();
  }

  if (overlay) overlay.classList.add('failed');
  if (title) title.textContent = 'GAGAL TERHUBUNG';

  let failCountdown = 3;
  if (sub) sub.textContent = `Robot belum aktif. Ke halaman Bluetooth (${failCountdown}s)...`;

  if (s_rebootTimer) clearInterval(s_rebootTimer);
  s_rebootTimer = setInterval(() => {
    failCountdown--;
    if (failCountdown > 0) {
      if (sub) sub.textContent = `Robot belum aktif. Ke halaman Bluetooth (${failCountdown}s)...`;
    } else {
      clearInterval(s_rebootTimer);
      s_rebootTimer = null;
      if (overlay) {
        overlay.classList.remove('failed');
        overlay.style.display = 'none';
      }

      // Buka halaman Setup Gate Bluetooth agar pengguna bisa melihat status & menghubungkan manual
      const gate = document.getElementById('setupGate');
      if (gate) {
        gate.classList.add('active');
      }
      const isBtOn = (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') ? window.AndroidBLE.isBluetoothEnabled() : true;
      updateSetupGateView(isBtOn);
      showNeonToast('Robot tidak merespons');
    }
  }, 1000);
}

// 7. Modal Konfirmasi & Eksekusi Reset Jaringan WiFi
function openResetWiFiConfirmModal() {
  const modal = document.getElementById('modalResetWiFiConfirm');
  if (modal) modal.style.display = 'flex';
  triggerHaptic(20);
}

function closeResetWiFiConfirmModal() {
  const modal = document.getElementById('modalResetWiFiConfirm');
  if (modal) modal.style.display = 'none';
}

function executeResetWiFiCommand() {
  closeResetWiFiConfirmModal();
  sendCommand({ c: 'reset_wifi' });
  showNeonToast('WiFi dihapus, me-restart robot...');
  triggerHaptic(40);
  // Mulai alur restart di aplikasi agar sinkron dengan reboot otomatis robot
  setTimeout(() => {
    executeRebootCommand(false);
  }, 250);
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
  initPrayerFeature();
  initCryptoFeature();
  initKursFeature();

  const gate = document.getElementById('setupGate');
  const hasSaved = hasSavedRobot();
  if (hasSaved) {
    if (gate) gate.classList.remove('active');
  } else {
    if (gate) gate.classList.add('active');
  }

  // Cek status daya Bluetooth HP & sambungkan kembali ke robot tersimpan
  if (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') {
    const btOn = window.AndroidBLE.isBluetoothEnabled();
    window.onBluetoothPowerState(btOn);
    if (btOn) {
      if (hasSaved) {
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
// SPOTIFY MUSIK & LIRIK REALTIME (LRCLIB + SPOTIFY BROADCAST RECEIVER)
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
let lastSentPlayingState = null;
let lastSentSpotifyPos = -1;
let spotifySyncLoopTimer = null;
let isFetchingLyrics = false;
const lyricsMemoryCache = {}; // Cache lirik instan 0ms

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
      result.push({ timeSec, text });
    }
  }

  result.sort((a, b) => a.timeSec - b.timeSec);
  return result;
}

let currentLyricFetchId = 0;

function executeHttpGet(url, callback) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 3500) : null;

  fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(r => {
      if (timer) clearTimeout(timer);
      return r.ok ? r.text() : null;
    })
    .then(text => {
      if (typeof callback === 'function') callback(text);
    })
    .catch(() => {
      if (timer) clearTimeout(timer);
      if (window.AndroidBLE && typeof window.AndroidBLE.httpGet === 'function') {
        setTimeout(() => {
          try {
            const resp = window.AndroidBLE.httpGet(url);
            if (typeof callback === 'function') callback(resp);
          } catch (e) {
            if (typeof callback === 'function') callback(null);
          }
        }, 0);
      } else {
        if (typeof callback === 'function') callback(null);
      }
    });
}

function fetchLrclibLyrics(title, artist, durationSec) {
  if (!title || title.trim().length === 0) return;
  const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = artist.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const trackKey = (cleanTitle + '::' + cleanArtist).toLowerCase();

  // 1. Cek cache memori instan (0 ms latency)
  if (lyricsMemoryCache[trackKey] && lyricsMemoryCache[trackKey].length > 0) {
    currentLyricsTrackKey = trackKey;
    currentLyricsLines = lyricsMemoryCache[trackKey];
    updateSpotifyDetailUI();
    dispatchRealtimeLyricSync(true);
    return;
  }

  const thisRequestId = ++currentLyricFetchId;
  currentLyricsTrackKey = trackKey;
  currentLyricsLines = [];

  const roundDur = Math.round(durationSec || 0);
  const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;

  const applyLyrics = (lrcString, isPlain = false) => {
    if (thisRequestId !== currentLyricFetchId) return;
    if (!lrcString || lrcString.trim().length === 0) return;

    if (isPlain) {
      const rawLines = lrcString.split('\n').filter(l => l.trim().length > 0);
      currentLyricsLines = rawLines.map((l, idx) => ({ timeSec: idx * 4, text: l.trim() }));
    } else {
      currentLyricsLines = parseLrcLyrics(lrcString);
    }

    if (currentLyricsLines.length > 0) {
      lyricsMemoryCache[trackKey] = currentLyricsLines;
      updateSpotifyDetailUI();
      dispatchRealtimeLyricSync(true);
    }
  };

  const executeSearch = () => {
    executeHttpGet(searchUrl, (searchResp) => {
      if (thisRequestId !== currentLyricFetchId) return;
      if (!searchResp) return;
      try {
        const results = JSON.parse(searchResp);
        if (Array.isArray(results) && results.length > 0) {
          for (let i = 0; i < results.length; i++) {
            if (results[i].syncedLyrics && results[i].syncedLyrics.trim().length > 0) {
              applyLyrics(results[i].syncedLyrics, false);
              return;
            }
          }
          for (let i = 0; i < results.length; i++) {
            if (results[i].plainLyrics && results[i].plainLyrics.trim().length > 0) {
              applyLyrics(results[i].plainLyrics, true);
              return;
            }
          }
        }
      } catch (e) {}
    });
  };

  if (roundDur > 10) {
    const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}&duration=${roundDur}`;
    executeHttpGet(getUrl, (getResp) => {
      if (thisRequestId !== currentLyricFetchId) return;
      if (getResp) {
        try {
          const json = JSON.parse(getResp);
          if (json.syncedLyrics && json.syncedLyrics.trim().length > 0) {
            applyLyrics(json.syncedLyrics, false);
            return;
          } else if (json.plainLyrics && json.plainLyrics.trim().length > 0) {
            applyLyrics(json.plainLyrics, true);
            return;
          }
        } catch (e) {}
      }
      executeSearch();
    });
  } else {
    executeSearch();
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
  // Komponen petunjuk/banner telah dihilangkan sesuai permintaan
}

function openSpotifyPermissionSettings() {
  triggerHaptic(30);
  if (window.AndroidBLE && typeof window.AndroidBLE.openSpotifyApp === 'function') {
    window.AndroidBLE.openSpotifyApp();
  } else {
    showNeonToast('Buka Pengaturan Spotify > Status Siaran Perangkat');
  }
}

function mediaControlAction(action) {
  triggerHaptic(35);
  if (window.AndroidBLE) {
    if (action === 'play_pause' && typeof window.AndroidBLE.mediaPlayPause === 'function') {
      window.AndroidBLE.mediaPlayPause();
      const willPlay = !currentSpotifyState.isPlaying;
      const now = Date.now();
      if (!willPlay) {
        // Bekukan posisi detik saat pause agar waktu tidak meloncat mundur
        const elapsed = (currentSpotifyState.lastUpdateTimestamp > 0)
          ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
          : 0;
        currentSpotifyState.positionSec = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);
      }
      currentSpotifyState.isPlaying = willPlay;
      currentSpotifyState.lastUpdateTimestamp = now;
      updateSpotifyPlayPauseIcon(willPlay);
      dispatchRealtimeLyricSync(true);
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
  const artistName = currentSpotifyState.artist || 'Buka Spotify di HP Anda';
  const isPlaying = currentSpotifyState.isPlaying;

  // Info Box Control
  const infoTrack = document.getElementById('spInfoTrack');
  const infoArtist = document.getElementById('spInfoArtist');
  if (infoTrack) infoTrack.textContent = trackName;
  if (infoArtist) infoArtist.textContent = artistName;

  // Play / Pause Button
  updateSpotifyPlayPauseIcon(isPlaying);

  // Progress & Time
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

  // Panggung Lirik Layar (Expanded, tanpa status bar, tanpa judul)
  const lyricsWrap = document.getElementById('stageSpotifyLyricsWrap');
  const eqWrap = document.getElementById('stageSpotifyEqWrap');
  const lyric1 = document.getElementById('stageSpotifyLyric1');
  const lyric2 = document.getElementById('stageSpotifyLyric2');
  const lyric3 = document.getElementById('stageSpotifyLyric3');

  // Kompensasi latensi visual 150ms agar lirik muncul tepat pada ketukan audio
  const evalPos = curPos + 0.15;
  const activeLyric = getActiveLyricAtTime(evalPos);

  if (activeLyric && activeLyric.length > 0 && currentSpotifyState.title) {
    if (lyricsWrap) lyricsWrap.style.display = 'flex';
    if (eqWrap) eqWrap.style.display = 'none';

    if (activeLyric.includes('\n')) {
      const parts = activeLyric.split('\n');
      if (lyric1) lyric1.textContent = parts[0] || '';
      if (lyric2) lyric2.textContent = parts[1] || '';
      if (lyric3) lyric3.textContent = parts[2] || '';
    } else if (activeLyric.length > 21) {
      let s1 = 21;
      while (s1 > 8 && activeLyric[s1] !== ' ') s1--;
      if (activeLyric[s1] !== ' ') s1 = 21;
      if (lyric1) lyric1.textContent = activeLyric.substring(0, s1).trim();

      const rem1 = activeLyric.substring(s1).trim();
      if (rem1.length > 21) {
        let s2 = 21;
        while (s2 > 8 && rem1[s2] !== ' ') s2--;
        if (rem1[s2] !== ' ') s2 = 21;
        if (lyric2) lyric2.textContent = rem1.substring(0, s2).trim();
        if (lyric3) lyric3.textContent = rem1.substring(s2).trim();
      } else {
        if (lyric2) lyric2.textContent = rem1;
        if (lyric3) lyric3.textContent = '';
      }
    } else {
      if (lyric1) lyric1.textContent = activeLyric;
      if (lyric2) lyric2.textContent = '';
      if (lyric3) lyric3.textContent = '';
    }
  } else {
    if (isPlaying && currentSpotifyState.title) {
      if (lyricsWrap) lyricsWrap.style.display = 'none';
      if (eqWrap) eqWrap.style.display = 'flex';
    } else {
      if (lyricsWrap) lyricsWrap.style.display = 'flex';
      if (eqWrap) eqWrap.style.display = 'none';
      if (lyric1) lyric1.textContent = currentSpotifyState.title ? 'Musik Dijeda' : 'Putar lagu di Spotify';
      if (lyric2) lyric2.textContent = currentSpotifyState.title ? '' : 'Lirik sinkron otomatis';
      if (lyric3) lyric3.textContent = '';
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
    const activeLyric = getActiveLyricAtTime(curPos + 0.15);
    pLyric.textContent = activeLyric || (currentSpotifyState.artist || 'Sentuh utk buka');
  }
}

function dispatchRealtimeLyricSync(forcePriority = false) {
  // Jika berjalan di dalam aplikasi Android native, transmisi BLE lirik ditangani 100% oleh SpotifyLyricSyncEngine di Java Foreground Service
  if (window.AndroidBLE) return;

  if (!isBleConnected || currentRobotMode !== 17) return;

  if (!currentSpotifyState.title || currentSpotifyState.title.length === 0) {
    if (lastSentLyricLine !== '__STANDBY__') {
      sendCommand({
        c: 'spotify',
        t: '',
        a: '',
        l: '',
        p: 0,
        d: 0,
        play: false
      }, true);
      lastSentLyricLine = '__STANDBY__';
      lastSentPlayingState = false;
      lastSentSpotifyPos = 0;
    }
    return;
  }

  const isPlaying = currentSpotifyState.isPlaying;
  const now = Date.now();
  const elapsed = (isPlaying && currentSpotifyState.lastUpdateTimestamp > 0)
    ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
    : 0;
  const curPos = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);
  const evalPos = curPos + 0.15;
  const activeLyric = getActiveLyricAtTime(evalPos);
  const intPos = Math.floor(curPos);

  // Kirim ke ESP32 HANYA jika baris lirik berubah atau status play/pause berubah
  if (forcePriority || activeLyric !== lastSentLyricLine || isPlaying !== lastSentPlayingState) {
    sendCommand({
      c: 'spotify',
      t: currentSpotifyState.title,
      a: currentSpotifyState.artist,
      l: activeLyric,
      p: intPos,
      d: Math.floor(currentSpotifyState.durationSec),
      play: isPlaying
    }, true);
    lastSentLyricLine = activeLyric;
    lastSentPlayingState = isPlaying;
    lastSentSpotifyPos = intPos;
  }
}

function startSpotifySyncLoop() {
  if (spotifySyncLoopTimer) clearInterval(spotifySyncLoopTimer);
  // Interval cepat 100ms untuk presisi tinggi realtime audio-visual
  spotifySyncLoopTimer = setInterval(() => {
    const isPlaying = currentSpotifyState.isPlaying;
    const now = Date.now();
    const elapsed = (isPlaying && currentSpotifyState.lastUpdateTimestamp > 0)
      ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
      : 0;
    const curPos = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);

    if (currentOpenDetailFeature === 'spotify') {
      updateSpotifyDetailUI();
    } else {
      updateSpotifyPreviewCard(curPos);
    }

    dispatchRealtimeLyricSync(false);
  }, 100);
}

window.onMusicStateChanged = function(data) {
  if (!data) return;

  const title = (data.title || '').trim();
  const artist = (data.artist || '').trim();
  const pos = typeof data.pos === 'number' ? data.pos : 0;
  const dur = typeof data.dur === 'number' ? data.dur : 0;
  const isPlaying = !!data.play;

  // Jika title kosong -> Spotify ditutup / musik stop total
  if (title.length === 0) {
    currentSpotifyState.title = '';
    currentSpotifyState.artist = '';
    currentSpotifyState.durationSec = 0;
    currentSpotifyState.positionSec = 0;
    currentSpotifyState.isPlaying = false;
    currentSpotifyState.lastUpdateTimestamp = Date.now();
    currentLyricsLines = [];
    currentLyricsTrackKey = '';
    lastSentLyricLine = '';
    lastSentPlayingState = false;
    lastSentSpotifyPos = -1;

    updateSpotifyDetailUI();

    if (isBleConnected && currentRobotMode === 17) {
      sendCommand({
        c: 'spotify',
        t: '',
        a: '',
        l: '',
        p: 0,
        d: 0,
        play: false
      }, true);
    }
    return;
  }

  const trackChanged = (title !== currentSpotifyState.title || artist !== currentSpotifyState.artist);

  if (trackChanged) {
    currentSpotifyState.title = title;
    currentSpotifyState.artist = artist;
    currentSpotifyState.durationSec = dur;
    currentSpotifyState.positionSec = pos;
    currentSpotifyState.isPlaying = isPlaying;
    currentSpotifyState.lastUpdateTimestamp = Date.now();
    lastSentLyricLine = '__RESET__';
    lastSentSpotifyPos = -1;
    fetchLrclibLyrics(title, artist, dur);
  } else {
    // Lagu yang sama:
    const prevPlaying = currentSpotifyState.isPlaying;
    currentSpotifyState.isPlaying = isPlaying;
    if (dur > 0) currentSpotifyState.durationSec = dur;

    if (!prevPlaying && isPlaying) {
      // RESUME: lagu baru saja kembali diputar setelah dijeda
      if (pos > 0) currentSpotifyState.positionSec = pos;
      currentSpotifyState.lastUpdateTimestamp = Date.now();
    } else if (prevPlaying && !isPlaying) {
      // PAUSE: lagu baru saja dijeda
      // Bekukan posisi detik saat pause tepat di titik terakhir!
      const now = Date.now();
      const elapsed = (currentSpotifyState.lastUpdateTimestamp > 0)
        ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
        : 0;
      currentSpotifyState.positionSec = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);
      currentSpotifyState.lastUpdateTimestamp = now;
    } else if (pos > 0) {
      // Update berkala posisi dari broadcast resmi
      currentSpotifyState.positionSec = pos;
      currentSpotifyState.lastUpdateTimestamp = Date.now();
    }
  }

  updateSpotifyDetailUI();
  dispatchRealtimeLyricSync(true);
};

function initSpotifyFeature() {
  updateSpotifyPermissionUI();
  updateSpotifyDetailUI();
  startSpotifySyncLoop();
  if (window.AndroidBLE && typeof window.AndroidBLE.requestMusicSync === 'function') {
    window.AndroidBLE.requestMusicSync();
  }
}

// Dipicu setiap 150ms oleh Native Android Java agar sinkronisasi lirik tidak pernah mati di latar belakang
window.onBackgroundTick = function() {
  if (currentSpotifyState.isPlaying && currentSpotifyState.title) {
    const now = Date.now();
    const elapsed = (currentSpotifyState.lastUpdateTimestamp > 0)
      ? (now - currentSpotifyState.lastUpdateTimestamp) / 1000
      : 0;
    const curPos = Math.min(currentSpotifyState.positionSec + elapsed, currentSpotifyState.durationSec || 9999);

    if (currentOpenDetailFeature === 'spotify') {
      updateSpotifyDetailUI();
    } else {
      updateSpotifyPreviewCard(curPos);
    }
    dispatchRealtimeLyricSync(false);
  }
};

// ========================================================
// NAVIGASI (INTEGRASI CHRONOS & REALTIME OLED MIRROR)
// ========================================================

// DIPANGGIL KETIKA PENGGUNA MEMBUKA HALAMAN NAVIGASI DI ROBOT DESK
window.onNavPermissionsGranted = function() {
  currentMainTab = 'pageRobot';
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === 'pageRobot');
  });
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-page') === 'pageRobot');
  });

  currentOpenDetailFeature = 'navigation';
  const overview = document.getElementById('robotMainOverview');
  const detailView = document.getElementById('robotFeatureDetailView');

  if (overview) overview.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  document.querySelectorAll('.detail-feature-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('detailViewNavigation');
  if (panel) panel.style.display = 'block';

  // Kirim perintah mode 18 (Navigasi) & minta status navigasi terkini dari ESP32
  if (currentRobotMode !== 18) {
    currentRobotMode = 18;
    sendCommand({ c: 'm', v: 18 });
  }
  sendCommand({ c: 'nav_req' });
  scrollToPageTop();
};

// UPDATE TAMPILAN PANGGUNG OLED (STANDBY vs AKTIF) - REALTIME
function updateOledNavLiveDisplay(actStr, distStr, instStr, streetStr, remStr, timeStr) {
  const stageActive = document.getElementById('stageNavActive');
  const stageStandby = document.getElementById('stageNavStandby');

  if (actStr && actStr !== 'stop' && actStr !== 'standby') {
    if (stageActive) stageActive.style.display = 'flex';
    if (stageStandby) stageStandby.style.display = 'none';

    const distEl = document.getElementById('stageNavDistance');
    const instEl = document.getElementById('stageNavInstruction');
    const streetEl = document.getElementById('stageNavStreet');
    const remEl = document.getElementById('stageNavBottomRem');
    const timeEl = document.getElementById('stageNavBottomTime');
    const arrowSvg = document.getElementById('stageNavArrowSvg');

    if (distEl) distEl.textContent = distStr || '180 m';
    if (instEl) instEl.textContent = instStr || 'Belok Kanan';
    if (streetEl) streetEl.textContent = streetStr || 'Jl. Diponegoro';
    if (remEl) remEl.textContent = remStr || '3.4 km';
    if (timeEl) timeEl.textContent = timeStr || '15m';

    // Perbarui ikon panah SVG belokan di panggung OLED
    if (arrowSvg) {
      const a = (actStr || '').toLowerCase();
      if (a.includes('left')) {
        arrowSvg.innerHTML = '<polyline points="12 19 5 12 12 5"></polyline><line x1="5" y1="12" x2="19" y2="12"></line>';
      } else if (a.includes('right')) {
        arrowSvg.innerHTML = '<polyline points="12 5 19 12 12 19"></polyline><line x1="19" y1="12" x2="5" y2="12"></line>';
      } else if (a.includes('uturn')) {
        arrowSvg.innerHTML = '<path d="M9 14L4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v5.5"></path>';
      } else if (a.includes('roundabout')) {
        arrowSvg.innerHTML = '<circle cx="12" cy="12" r="6"></circle><polyline points="12 2 15 5 12 8"></polyline>';
      } else if (a.includes('arrive')) {
        arrowSvg.innerHTML = '<path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path>';
      } else {
        arrowSvg.innerHTML = '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>';
      }
    }
  } else {
    if (stageActive) stageActive.style.display = 'none';
    if (stageStandby) stageStandby.style.display = 'flex';
  }
}

// ========================================================
// FITUR KURS LIVE (TEPAT 3 MATA UANG • POLA SAMA CUACA)
// ========================================================
const FOREX_POPULAR_CURRENCIES = [
  { code: 'IDR', name: 'Rupiah Indonesia', symbol: 'Rp' },
  { code: 'USD', name: 'Dolar Amerika Serikat', symbol: '$' },
  { code: 'EUR', name: 'Euro Uni Eropa', symbol: '€' },
  { code: 'SAR', name: 'Riyal Arab Saudi', symbol: 'SAR' },
  { code: 'SGD', name: 'Dolar Singapura', symbol: 'S$' },
  { code: 'JPY', name: 'Yen Jepang', symbol: '¥' },
  { code: 'GBP', name: 'Poundsterling Inggris', symbol: '£' },
  { code: 'MYR', name: 'Ringgit Malaysia', symbol: 'RM' },
  { code: 'AUD', name: 'Dolar Australia', symbol: 'A$' },
  { code: 'CNY', name: 'Yuan Tiongkok', symbol: '¥' },
  { code: 'KRW', name: 'Won Korea Selatan', symbol: '₩' },
  { code: 'CAD', name: 'Dolar Kanada', symbol: 'C$' },
  { code: 'CHF', name: 'Franc Swiss', symbol: 'CHF' },
  { code: 'THB', name: 'Baht Thailand', symbol: '฿' },
  { code: 'PHP', name: 'Peso Filipina', symbol: '₱' },
  { code: 'VND', name: 'Dong Vietnam', symbol: '₫' },
  { code: 'AED', name: 'Dirham Uni Emirat Arab', symbol: 'AED' },
  { code: 'TRY', name: 'Lira Turki', symbol: '₺' },
  { code: 'INR', name: 'Rupee India', symbol: '₹' },
  { code: 'BRL', name: 'Real Brasil', symbol: 'R$' },
  { code: 'NZD', name: 'Dolar Selandia Baru', symbol: 'NZ$' },
  { code: 'TWD', name: 'Dolar Taiwan Baru', symbol: 'NT$' },
  { code: 'HKD', name: 'Dolar Hong Kong', symbol: 'HK$' },
  { code: 'ZAR', name: 'Rand Afrika Selatan', symbol: 'R' },
  { code: 'MXN', name: 'Peso Meksiko', symbol: 'Mex$' },
  { code: 'RUB', name: 'Rubel Rusia', symbol: '₽' },
  { code: 'QAR', name: 'Riyal Qatar', symbol: 'QAR' },
  { code: 'KWD', name: 'Dinar Kuwait', symbol: 'KWD' }
];

const DEFAULT_KURS_SLOTS = ['USD', 'EUR', 'SAR']; // Tepat 3 slot (tidak boleh kurang/lebih)
let configuredKursSlots = (() => {
  try {
    const saved = localStorage.getItem('robot_cfg_kurs_slots');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === 3) return parsed.map(s => String(s).toUpperCase());
    }
  } catch (e) {}
  return [...DEFAULT_KURS_SLOTS];
})();

let currentKursTarget = (localStorage.getItem('robot_cfg_kurs_target') || 'IDR').toUpperCase();
let activeKursSlotIndex = 0; // 0, 1, 2
let isKursFetching = false;
let kursAutoInterval = null;
let kursSlotSearchTimer = null;
let kursTargetSearchTimer = null;

let kursRatesCache = {
  'USD_IDR': { price: 18040, change24h: 0.20, isUp: true },
  'EUR_IDR': { price: 20230, change24h: 0.88, isUp: true },
  'SAR_IDR': { price: 4810,  change24h: 0.19, isUp: true },
  'USD_USD': { price: 1.0,   change24h: 0.00, isUp: true },
  'EUR_USD': { price: 1.12,  change24h: 0.68, isUp: true },
  'SAR_USD': { price: 0.27,  change24h: 0.00, isUp: true }
};

function saveConfiguredKurs() {
  try {
    localStorage.setItem('robot_cfg_kurs_slots', JSON.stringify(configuredKursSlots));
    localStorage.setItem('robot_cfg_kurs_target', currentKursTarget);
  } catch (e) {}
}

function renderKursSlotsUI() {
  const bar = document.getElementById('kursSlotsBar');
  if (!bar) return;
  bar.innerHTML = '';
  configuredKursSlots.forEach((code, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip-preset' + (idx === activeKursSlotIndex ? ' active' : '');
    chip.textContent = `Slot ${idx + 1}: ${code}`;
    chip.onclick = () => selectKursSlot(idx);
    bar.appendChild(chip);
  });
}

function selectKursSlot(idx) {
  if (idx < 0 || idx >= 3) return;
  activeKursSlotIndex = idx;
  const input = document.getElementById('cfgKursSlotInput');
  if (input) {
    const found = FOREX_POPULAR_CURRENCIES.find(c => c.code === configuredKursSlots[idx]);
    input.value = found ? (found.code + ' - ' + found.name) : configuredKursSlots[idx];
  }
  renderKursSlotsUI();
}

function formatKursDisplayPrice(price, targetCode) {
  if (typeof price !== 'number' || isNaN(price) || price <= 0) return '0';
  if (targetCode === 'IDR') {
    return 'Rp ' + Math.round(price).toLocaleString('id-ID');
  }
  const curr = FOREX_POPULAR_CURRENCIES.find(c => c.code === targetCode);
  const sym = curr ? (curr.symbol + ' ') : (targetCode + ' ');
  if (price >= 100) return sym + price.toFixed(2);
  if (price >= 1) return sym + price.toFixed(3);
  return sym + price.toFixed(4);
}

async function fetchSingleKursRate(fromCode, toCode) {
  const from = fromCode.toUpperCase();
  const to = toCode.toUpperCase();
  const pairKey = from + '_' + to;

  if (from === to) {
    kursRatesCache[pairKey] = { price: 1.0, change24h: 0.0, isUp: true };
    return;
  }

  let gotData = false;

  // 1. Kasus khusus mata uang terpatok USD (SAR = 3.7500 per USD)
  // Yahoo Finance tidak menyediakan ticker SARIDR=X langsung, sehingga dihitung presisi via USDIDR=X & USDSAR=X
  if (from === 'SAR' && to === 'IDR') {
    try {
      const uIdrUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/USDIDR=X?interval=1d';
      const uSarUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/USDSAR=X?interval=1d';
      const [uIdrRes, uSarRes] = await Promise.allSettled([
        fetchGeocoding(uIdrUrl, 2500),
        fetchGeocoding(uSarUrl, 2500)
      ]);

      let uIdrPrice = 0, uIdrClose = 0;
      let uSarPrice = 3.7535, uSarClose = 3.7533;

      if (uIdrRes.status === 'fulfilled' && uIdrRes.value && uIdrRes.value.chart && uIdrRes.value.chart.result) {
        const m = uIdrRes.value.chart.result[0].meta;
        if (m && typeof m.regularMarketPrice === 'number') {
          uIdrPrice = m.regularMarketPrice;
          uIdrClose = m.chartPreviousClose || uIdrPrice;
          if (uIdrPrice > 10000 && uIdrPrice < 25000) usdToIdrRate = uIdrPrice;
        }
      }

      if (uSarRes.status === 'fulfilled' && uSarRes.value && uSarRes.value.chart && uSarRes.value.chart.result) {
        const m = uSarRes.value.chart.result[0].meta;
        if (m && typeof m.regularMarketPrice === 'number') {
          uSarPrice = m.regularMarketPrice;
          uSarClose = m.chartPreviousClose || uSarPrice;
        }
      }

      if (uIdrPrice > 0 && uSarPrice > 0) {
        const sarPrice = uIdrPrice / uSarPrice;
        const sarClose = uIdrClose / uSarClose;
        const chg = sarClose > 0 ? (((sarPrice - sarClose) / sarClose) * 100) : 0;
        kursRatesCache[pairKey] = {
          price: sarPrice,
          change24h: chg,
          isUp: (chg >= 0)
        };
        gotData = true;
        return;
      }
    } catch (e) {}
  }

  // 2. Ambil dari Yahoo Finance Chart untuk pasangan forex umum
  if (!gotData) {
    let yfSymbol = `${from}${to}=X`;
    try {
      let yfUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yfSymbol) + '?interval=1d';
      let yfData = await fetchGeocoding(yfUrl, 2500);

      if (yfData && yfData.chart && Array.isArray(yfData.chart.result) && yfData.chart.result.length > 0) {
        const meta = yfData.chart.result[0].meta;
        if (meta && typeof meta.regularMarketPrice === 'number') {
          const rawPrice = meta.regularMarketPrice;
          let changeVal = meta.regularMarketChangePercent || 0;
          if (changeVal === 0 && typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0) {
            changeVal = ((rawPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
          }
          kursRatesCache[pairKey] = {
            price: rawPrice,
            change24h: changeVal,
            isUp: (changeVal >= 0)
          };
          if (from === 'USD' && to === 'IDR' && rawPrice > 10000 && rawPrice < 25000) {
            usdToIdrRate = rawPrice;
          }
          gotData = true;
          return;
        }
      }
    } catch (e) {}
  }

  // 3. Sumber Live Global: open.er-api.com (100% Free, CORS Enabled, Real-time Real Market)
  if (!gotData) {
    try {
      const erUrl = 'https://open.er-api.com/v6/latest/' + encodeURIComponent(from);
      const erData = await fetchGeocoding(erUrl, 3000);
      if (erData && erData.rates && typeof erData.rates[to] === 'number') {
        const livePrice = erData.rates[to];
        let chg = 0;
        const prevData = kursRatesCache[pairKey];
        if (prevData && prevData.price > 0 && Math.abs(prevData.price - livePrice) > 0.0001) {
          chg = ((livePrice - prevData.price) / prevData.price) * 100;
        } else if (prevData && typeof prevData.change24h === 'number') {
          chg = prevData.change24h;
        }
        kursRatesCache[pairKey] = {
          price: livePrice,
          change24h: chg,
          isUp: (chg >= 0)
        };
        if (from === 'USD' && to === 'IDR' && livePrice > 10000 && livePrice < 25000) {
          usdToIdrRate = livePrice;
        }
        gotData = true;
        return;
      }
    } catch (e) {}
  }

  // 4. Fallback dengan rate pasar aktual jika jaringan lambat
  if (!gotData && to === 'IDR') {
    const effUsd = (usdToIdrRate > 10000 && usdToIdrRate < 25000) ? usdToIdrRate : 18040;
    if (from === 'USD') {
      kursRatesCache[pairKey] = { price: effUsd, change24h: 0.20, isUp: true };
    } else if (from === 'EUR') {
      kursRatesCache[pairKey] = { price: effUsd * 1.1214, change24h: 0.88, isUp: true };
    } else if (from === 'SAR') {
      kursRatesCache[pairKey] = { price: effUsd / 3.7535, change24h: 0.19, isUp: true };
    } else if (from === 'SGD') {
      kursRatesCache[pairKey] = { price: effUsd * 0.7825, change24h: 0.56, isUp: true };
    } else if (from === 'JPY') {
      kursRatesCache[pairKey] = { price: effUsd / 158.3, change24h: 0.54, isUp: true };
    }
  }
}

async function fetchKursLiveRates() {
  if (isKursFetching) return;
  isKursFetching = true;

  try {
    // Pastikan usdToIdrRate terupdate untuk kalkulasi lokal
    if (currentKursTarget === 'IDR') {
      await fetchSingleKursRate('USD', 'IDR').catch(() => {});
    }

    const fetches = configuredKursSlots.map(code => fetchSingleKursRate(code, currentKursTarget));
    await Promise.allSettled(fetches);

    updateOledKursPreview();
    sendKursDataToRobot();
  } catch (err) {
    console.warn('[KURS] Gagal mengambil data kurs live:', err);
    updateOledKursPreview();
    sendKursDataToRobot();
  } finally {
    isKursFetching = false;
  }
}

function updateOledKursPreview() {
  const target = currentKursTarget;
  const pTarget = document.getElementById('previewKursTarget');
  if (pTarget) pTarget.textContent = target;

  configuredKursSlots.forEach((sym, idx) => {
    const pairKey = sym + '_' + target;
    const data = kursRatesCache[pairKey] || { price: 0, change24h: 0, isUp: true };
    const priceStr = formatKursDisplayPrice(data.price, target);
    const arrowStr = data.isUp ? '▲' : '▼';
    const chgNum = (data.isUp ? '+' : '') + Math.abs(data.change24h).toFixed(1) + '%';

    // 1. Pratinjau di Card Halaman Robot
    const prevPrice = document.getElementById(`previewKursPrice${idx}`);
    const prevChg = document.getElementById(`previewKursChg${idx}`);
    if (prevPrice) prevPrice.textContent = priceStr;
    if (prevChg) prevChg.textContent = `${arrowStr} ${chgNum}`;

    // 2. Layar Stage Virtual OLED di Detail View
    const stageSym = document.getElementById(`stageKursSym${idx}`);
    const stagePrice = document.getElementById(`stageKursPrice${idx}`);
    const stageChg = document.getElementById(`stageKursChg${idx}`);
    if (stageSym) stageSym.textContent = sym;
    if (stagePrice) stagePrice.textContent = priceStr;
    if (stageChg) stageChg.textContent = `${arrowStr} ${chgNum}`;
  });
}

function sendKursDataToRobot() {
  configuredKursSlots.forEach((sym, idx) => {
    const pairKey = sym + '_' + currentKursTarget;
    const data = kursRatesCache[pairKey] || { price: 0, change24h: 0, isUp: true };
    const priceStr = formatKursDisplayPrice(data.price, currentKursTarget);
    const chgStr = (data.isUp ? '+' : '') + Math.abs(data.change24h).toFixed(1) + '%';

    sendCommand({
      c: 'kurs',
      slot: idx,
      sym: sym,
      price: priceStr,
      chg: chgStr,
      is_up: data.isUp
    }, false);
  });
}

function startKursInterval() {
  if (kursAutoInterval) clearInterval(kursAutoInterval);
  kursAutoInterval = setInterval(() => {
    if (currentOpenDetailFeature === 'kurs' || currentRobotMode === 21) {
      fetchKursLiveRates();
    }
  }, 60000);
}

// Live Autocomplete Pencarian Mata Uang Tujuan (Target)
function searchKursTargetSuggestions(query) {
  const dropdown = document.getElementById('kursTargetDropdown');
  if (!dropdown) return;
  const clean = (query || '').trim().toUpperCase();
  dropdown.innerHTML = '';

  let matches = [];
  if (clean.length === 0) {
    matches = FOREX_POPULAR_CURRENCIES.slice(0, 8);
  } else {
    matches = FOREX_POPULAR_CURRENCIES.filter(c =>
      c.code.toUpperCase().includes(clean) ||
      c.name.toUpperCase().includes(clean)
    ).slice(0, 8);
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="city-item-empty">Tidak ada mata uang cocok</div>';
    dropdown.style.display = 'block';
    return;
  }

  matches.forEach(item => {
    const row = document.createElement('div');
    row.className = 'city-autocomplete-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'city-item-name';
    nameEl.textContent = item.code;
    const descEl = document.createElement('span');
    descEl.className = 'city-item-desc';
    descEl.textContent = item.name;
    row.appendChild(nameEl);
    row.appendChild(descEl);
    row.addEventListener('click', () => {
      const input = document.getElementById('cfgKursTargetInput');
      if (input) input.value = item.code + ' - ' + item.name;
      dropdown.style.display = 'none';
      triggerHaptic(20);
    });
    dropdown.appendChild(row);
  });
  dropdown.style.display = 'block';
}

// Live Autocomplete Pencarian Mata Uang Slot
function searchKursSlotSuggestions(query) {
  const dropdown = document.getElementById('kursSlotDropdown');
  if (!dropdown) return;
  const clean = (query || '').trim().toUpperCase();
  dropdown.innerHTML = '';

  let matches = [];
  if (clean.length === 0) {
    matches = FOREX_POPULAR_CURRENCIES.slice(0, 8);
  } else {
    matches = FOREX_POPULAR_CURRENCIES.filter(c =>
      c.code.toUpperCase().includes(clean) ||
      c.name.toUpperCase().includes(clean)
    ).slice(0, 8);
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="city-item-empty">Tidak ada mata uang cocok</div>';
    dropdown.style.display = 'block';
    return;
  }

  matches.forEach(item => {
    const row = document.createElement('div');
    row.className = 'city-autocomplete-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'city-item-name';
    nameEl.textContent = item.code;
    const descEl = document.createElement('span');
    descEl.className = 'city-item-desc';
    descEl.textContent = item.name;
    row.appendChild(nameEl);
    row.appendChild(descEl);
    row.addEventListener('click', () => {
      const input = document.getElementById('cfgKursSlotInput');
      if (input) input.value = item.code + ' - ' + item.name;
      dropdown.style.display = 'none';
      triggerHaptic(20);
    });
    dropdown.appendChild(row);
  });
  dropdown.style.display = 'block';
}

async function applyKursTarget() {
  const input = document.getElementById('cfgKursTargetInput');
  const raw = (input ? input.value : '').trim();
  const code = raw.split(/[-–—/]/)[0].trim().toUpperCase();
  if (!code || code.length < 2) {
    triggerHaptic(40);
    showNeonToast('Masukkan kode mata uang tujuan!');
    return;
  }

  const found = FOREX_POPULAR_CURRENCIES.find(c => c.code === code);
  if (!found) {
    triggerHaptic(40);
    showNeonToast('Mata uang tidak ditemukan!');
    return;
  }

  triggerHaptic(25);
  currentKursTarget = code;
  saveConfiguredKurs();

  const btn = document.getElementById('btnApplyKursTarget');
  const txt = document.getElementById('txtApplyKursTargetBtn');
  if (txt) txt.textContent = 'MEMUAT...';
  if (btn) btn.classList.add('loading');

  try {
    await fetchKursLiveRates();
    triggerHaptic(30);
    showNeonToast('Mata Uang Tujuan Diatur: ' + code);
  } finally {
    if (txt) txt.textContent = 'TERAPKAN MATA UANG TUJUAN';
    if (btn) btn.classList.remove('loading');
  }
}

async function applyKursSlot() {
  const input = document.getElementById('cfgKursSlotInput');
  const raw = (input ? input.value : '').trim();
  const code = raw.split(/[-–—/]/)[0].trim().toUpperCase();
  if (!code || code.length < 2) {
    triggerHaptic(40);
    showNeonToast('Masukkan kode mata uang slot!');
    return;
  }

  const found = FOREX_POPULAR_CURRENCIES.find(c => c.code === code);
  if (!found) {
    triggerHaptic(40);
    showNeonToast('Mata uang tidak ditemukan!');
    return;
  }

  triggerHaptic(25);
  configuredKursSlots[activeKursSlotIndex] = code;
  saveConfiguredKurs();
  renderKursSlotsUI();

  const btn = document.getElementById('btnApplyKursSlot');
  const txt = document.getElementById('txtApplyKursSlotBtn');
  if (txt) txt.textContent = 'MEMUAT...';
  if (btn) btn.classList.add('loading');

  try {
    await fetchKursLiveRates();
    triggerHaptic(30);
    showNeonToast(`Slot ${activeKursSlotIndex + 1} Diatur: ` + code);
  } finally {
    if (txt) txt.textContent = 'SIMPAN KE SLOT TERPILIH';
    if (btn) btn.classList.remove('loading');
  }
}

function initKursFeature() {
  renderKursSlotsUI();

  const targetInput = document.getElementById('cfgKursTargetInput');
  if (targetInput) {
    const foundTarget = FOREX_POPULAR_CURRENCIES.find(c => c.code === currentKursTarget);
    targetInput.value = foundTarget ? (foundTarget.code + ' - ' + foundTarget.name) : currentKursTarget;
    targetInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (kursTargetSearchTimer) clearTimeout(kursTargetSearchTimer);
      kursTargetSearchTimer = setTimeout(() => searchKursTargetSuggestions(q), 200);
    });
  }

  const slotInput = document.getElementById('cfgKursSlotInput');
  if (slotInput) {
    const curSlotCode = configuredKursSlots[activeKursSlotIndex] || 'USD';
    const foundSlot = FOREX_POPULAR_CURRENCIES.find(c => c.code === curSlotCode);
    slotInput.value = foundSlot ? (foundSlot.code + ' - ' + foundSlot.name) : curSlotCode;
    slotInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (kursSlotSearchTimer) clearTimeout(kursSlotSearchTimer);
      kursSlotSearchTimer = setTimeout(() => searchKursSlotSuggestions(q), 200);
    });
  }

  document.addEventListener('click', (e) => {
    const dTarget = document.getElementById('kursTargetDropdown');
    const iTarget = document.getElementById('cfgKursTargetInput');
    if (dTarget && !dTarget.contains(e.target) && e.target !== iTarget) {
      dTarget.style.display = 'none';
    }

    const dSlot = document.getElementById('kursSlotDropdown');
    const iSlot = document.getElementById('cfgKursSlotInput');
    if (dSlot && !dSlot.contains(e.target) && e.target !== iSlot) {
      dSlot.style.display = 'none';
    }
  });

  updateOledKursPreview();
  setTimeout(() => {
    fetchKursLiveRates();
  }, 1000);
}

