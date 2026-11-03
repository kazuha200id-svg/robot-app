/* ========================================================
   ROBOT DESK APP CONTROLLER (STRICT BLUETOOTH GATE)
   ======================================================== */

let isBleConnected = false;
let currentFaceIndex = 0;
let currentMainTab = 'pageMenu';
let toastTimeout = null;

// ================= 1. TOAST NOTIFICATION (STRICT SINGLE LINE) =================
function showNeonToast(message) {
  const toast = document.getElementById('neonToast');
  const txt = document.getElementById('toastText');
  if (!toast || !txt) return;

  txt.textContent = message;
  toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);

  triggerHaptic(20);
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

  // Refresh telemetry on robot tab
  if (pageId === 'pageRobot' && isBleConnected) {
    sendCommand({ c: 's' });
  }

  triggerHaptic(15);
}

// ARCADE SUBVIEW SWITCHER (Faces vs Games)
function switchArcadeSubView(view) {
  const facesView = document.getElementById('subViewFaces');
  const gamesView = document.getElementById('subViewGames');
  const btnFaces = document.getElementById('btnSubFaces');
  const btnGames = document.getElementById('btnSubGames');

  if (view === 'faces') {
    if (facesView) facesView.classList.add('active');
    if (gamesView) gamesView.classList.remove('active');
    if (btnFaces) btnFaces.classList.add('active');
    if (btnGames) btnGames.classList.remove('active');
  } else {
    if (facesView) facesView.classList.remove('active');
    if (gamesView) gamesView.classList.add('active');
    if (btnFaces) btnFaces.classList.remove('active');
    if (btnGames) btnGames.classList.add('active');
  }

  triggerHaptic(15);
}

// ================= 3. BLE COMMAND DISPATCH =================
function sendCommand(cmdObject) {
  const jsonStr = JSON.stringify(cmdObject);
  if (window.AndroidBLE && typeof window.AndroidBLE.send === 'function') {
    const res = window.AndroidBLE.send(jsonStr);
    if (res === 'OK' || res === true) {
      return true;
    } else {
      showNeonToast(res || 'Gagal Kirim');
      return false;
    }
  } else {
    console.log('[MOCK BLE SEND]', jsonStr);
    showNeonToast('Perintah Terkirim');
    return true;
  }
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

// BLUETOOTH POWER STATE CALLBACK FROM NATIVE ANDROID
window.onBluetoothPowerState = function(enabled) {
  const txtBt = document.getElementById('txtBtPower');
  const btnEnable = document.getElementById('btnEnableBt');
  const boxBt = document.getElementById('boxBtPower');
  const boxDetected = document.getElementById('boxDetectedDevices');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');
  const gate = document.getElementById('setupGate');

  if (enabled) {
    if (txtBt) {
      txtBt.textContent = 'AKTIF';
      txtBt.className = 'status-card-state success';
    }
    if (btnEnable) btnEnable.style.display = 'none';
    if (boxBt) boxBt.classList.add('ready');
    if (boxDetected) boxDetected.style.display = 'flex';
    if (txtScan && !isBleConnected && !isDeviceFound) {
      txtScan.textContent = 'Mencari Robot Desk...';
      if (spinner) spinner.style.display = 'block';
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
    if (boxDetected) boxDetected.style.display = 'none';

    const scanningBox = document.getElementById('deviceScanningBox');
    const itemBox = document.getElementById('deviceItemBox');
    if (scanningBox) scanningBox.style.display = 'flex';
    if (itemBox) {
      itemBox.style.display = 'none';
      itemBox.classList.remove('selected');
    }
    if (txtScan) txtScan.textContent = 'Nyalakan Bluetooth untuk mulai';
    if (spinner) spinner.style.display = 'none';

    updateConnectButtonState();

    if (gate) gate.classList.add('active');
  }
};

// BLE CONNECTION STATUS CALLBACK FROM NATIVE ANDROID
window.onBLEStatus = function(connected, message) {
  isBleConnected = connected;
  const dot = document.getElementById('bleDot');
  const label = document.getElementById('bleStatusLabel');
  const gate = document.getElementById('setupGate');

  if (connected) {
    if (dot) dot.className = 'pulse-dot online';
    if (label) label.textContent = 'BLE TERHUBUNG';

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
    if (data.mode_name) {
      const modeEl = document.getElementById('teleActiveMode');
      if (modeEl) modeEl.textContent = data.mode_name;
    }
    if (typeof data.mode === 'number') {
      const modeBtnMap = {
        0: 'btnMenuFace',
        1: 'btnMenuClock',
        2: 'btnMenuWeather',
        3: 'btnMenuSubtitle',
        4: 'btnMenuGame',
        7: 'btnMenuStopwatch',
        8: 'btnMenuAlarm'
      };
      const activeId = modeBtnMap[data.mode];
      if (activeId) {
        document.querySelectorAll('.menu-action-card').forEach(c => c.classList.remove('active'));
        const el = document.getElementById(activeId);
        if (el) el.classList.add('active');
      }
    }
    if (typeof data.asleep === 'boolean') {
      const sleepEl = document.getElementById('teleSleepState');
      if (sleepEl) sleepEl.textContent = data.asleep ? 'Robot Tidur' : 'Robot Aktif (Bangun)';
    }

    // Alarm config sync
    if (data.alarm) {
      if (typeof data.alarm.hour === 'number') {
        const hEl = document.getElementById('alarmHour');
        if (hEl) hEl.value = String(data.alarm.hour).padStart(2, '0');
      }
      if (typeof data.alarm.min === 'number') {
        const mEl = document.getElementById('alarmMin');
        if (mEl) mEl.value = String(data.alarm.min).padStart(2, '0');
      }
      if (typeof data.alarm.enabled === 'boolean') {
        const enEl = document.getElementById('alarmEnabledToggle');
        if (enEl) enEl.checked = data.alarm.enabled;
      }
      if (typeof data.alarm.daily === 'boolean') {
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

function updateOledFacePreview(idx) {
  const item = OLED_FACES[idx] || OLED_FACES[0];
  const wrap = document.getElementById('oledFaceSvgWrap');
  const label = document.getElementById('oledFaceMoodLabel');
  if (wrap) {
    wrap.innerHTML = `<svg viewBox="0 0 100 50" class="oled-face-svg">${item.svg}</svg>`;
  }
  if (label) {
    label.textContent = `MOOD: ${item.name}`;
  }
}

// PILIH FITUR DI MENU ROBOT -> LAYAR ESP32 OTOMATIS BERPINDAH KE HALAMAN FITUR TERSEBUT
function selectRobotMenuFeature(featureKey, btnEl) {
  if (!isBleConnected) {
    showNeonToast('Wajib Terhubung Robot');
    return;
  }

  // Berikan visual active state pada kartu menu yang dipilih
  document.querySelectorAll('.menu-action-card').forEach(c => c.classList.remove('active'));
  if (btnEl) {
    btnEl.classList.add('active');
  }

  triggerHaptic(35);

  if (featureKey === 'face') {
    // Mode Animasi (0) dan kirim ekspresi wajah ke layar fisik OLED ESP32
    sendCommand({ c: 'm', v: 0 });
    sendCommand({ c: 'f', v: currentFaceIndex || 0 });
    showNeonToast('Layar ESP32: Expresi Wajah');
  } else if (featureKey === 'clock') {
    // Mode Jam Digital (1)
    sendCommand({ c: 'm', v: 1 });
    showNeonToast('Layar ESP32: Jam Digital');
  } else if (featureKey === 'alarm') {
    // Mode Alarm (8)
    sendCommand({ c: 'm', v: 8 });
    showNeonToast('Layar ESP32: Alarm');
  } else if (featureKey === 'stopwatch') {
    // Mode Stopwatch (7)
    sendCommand({ c: 'm', v: 7 });
    showNeonToast('Layar ESP32: Stopwatch');
  } else if (featureKey === 'weather') {
    // Mode Info Cuaca (2)
    sendCommand({ c: 'm', v: 2 });
    showNeonToast('Layar ESP32: Info Cuaca');
  } else if (featureKey === 'subtitle') {
    // Mode Subtitle (3)
    sendCommand({ c: 'm', v: 3 });
    showNeonToast('Layar ESP32: Subtitle');
  } else if (featureKey === 'game') {
    // Mode Menu Game Arcade (4)
    sendCommand({ c: 'm', v: 4 });
    showNeonToast('Layar ESP32: Menu Game');
  }
}

// Ganti Ekspresi Wajah (0..12)
function sendFace(faceIndex, elem) {
  currentFaceIndex = faceIndex;
  document.querySelectorAll('.face-card').forEach(c => c.classList.remove('active'));
  if (elem) elem.classList.add('active');

  // Update tampilan layar OLED robot secara langsung
  updateOledFacePreview(faceIndex);

  const ok = sendCommand({ c: 'f', v: faceIndex });
  if (ok) {
    showNeonToast('Ekspresi Diganti');
    triggerHaptic(25);
  }
}

// Ganti Mode Robot (Jam, Cuaca, Game, dll)
function sendDeviceMode(modeIndex) {
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

  const timeEl = document.getElementById('oledAlarmTimePreview');
  const badgeEl = document.getElementById('oledAlarmBadgePreview');
  const stageTimeEl = document.getElementById('stageAlarmDigits');
  const stageBadgeEl = document.getElementById('stageAlarmBadge');

  if (h && m) {
    const hh = String(parseInt(h.value, 10) || 0).padStart(2, '0');
    const mm = String(parseInt(m.value, 10) || 0).padStart(2, '0');
    const timeText = `${hh}:${mm}`;
    if (timeEl) timeEl.textContent = timeText;
    if (stageTimeEl) stageTimeEl.textContent = timeText;
  }
  if (en && daily) {
    const isEn = en.checked;
    const isDaily = daily.checked;
    const badgeText = `${isEn ? 'ON' : 'OFF'} \u2022 ${isDaily ? 'TIAP HARI' : 'SEKALI'}`;
    if (badgeEl) {
      badgeEl.textContent = badgeText;
      badgeEl.style.opacity = isEn ? '1' : '0.45';
    }
    if (stageBadgeEl) {
      stageBadgeEl.textContent = badgeText;
      stageBadgeEl.style.opacity = isEn ? '1' : '0.45';
    }
  }
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

  localStorage.setItem('robot_cfg_alarm_h', String(h));
  localStorage.setItem('robot_cfg_alarm_m', String(m));
  localStorage.setItem('robot_cfg_alarm_en', enabled ? '1' : '0');
  localStorage.setItem('robot_cfg_alarm_daily', daily ? '1' : '0');

  updateOledAlarmPreview();

  const ok = sendCommand({
    cmd: 'alarm',
    hour: h,
    min: m,
    enabled: enabled,
    daily: daily
  });
  if (ok) {
    showNeonToast('Alarm Disimpan: ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    triggerHaptic(30);
  }
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

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc + (3600000 * currentTimezoneOffset));

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

  if (clockEl) clockEl.textContent = timeStr;
  if (stageClockEl) stageClockEl.textContent = timeStr;

  const days = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
  const dayName = days[targetTime.getDay()];
  const dateNum = String(targetTime.getDate()).padStart(2, '0');
  const monthName = months[targetTime.getMonth()];
  const dateStr = `${dayName}, ${dateNum} ${monthName}`;

  if (dateEl) dateEl.textContent = dateStr;
  if (stageDateEl) stageDateEl.textContent = dateStr;

  const sel = document.getElementById('selTimezoneWorld');
  const selectedText = sel ? sel.options[sel.selectedIndex]?.text : '';
  const tzCode = selectedText ? selectedText.split(' ')[0] : 'WIB';
  if (stageTzEl) stageTzEl.textContent = tzCode;
}

setInterval(updateOledClockTick, 1000);

// ================= 7. PENGATURAN (SETTING) =================

// Pengaturan Format Waktu (24 vs 12 Jam)
function setTimeFormat(fmt) {
  currentTimeFormat = fmt;
  const btn24 = document.getElementById('btnFmt24');
  const btn12 = document.getElementById('btnFmt12');
  if (btn24) btn24.classList.toggle('active', fmt === 24);
  if (btn12) btn12.classList.toggle('active', fmt === 12);
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

// Sinkronisasi Jam HP & Timezone ke Robot Desk
function syncClock() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc + (3600000 * currentTimezoneOffset));
  const epochSec = Math.floor(targetTime.getTime() / 1000);

  const ok = sendCommand({
    cmd: 'time',
    epoch: epochSec,
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
  const epochSec = Math.floor(targetTime.getTime() / 1000);
  sendCommand({ cmd: 'time', epoch: epochSec, tz: currentTimezoneOffset, fmt: currentTimeFormat });
}

// SINKRONISASI TAMPILAN CUACA OLED
function updateOledWeatherPreview(city) {
  const cityEl = document.getElementById('oledCityPreview');
  const tempEl = document.getElementById('oledTempPreview');
  const stageCityEl = document.getElementById('stageWeatherCity');
  const stageTempEl = document.getElementById('stageWeatherTemp');
  const cityInput = document.getElementById('cfgCityInput');
  const cityName = (city || (cityInput ? cityInput.value : 'JAKARTA')).toUpperCase();
  const tempText = currentTempUnit === 'F' ? '84°F' : '29°C';

  if (cityEl) cityEl.textContent = cityName;
  if (stageCityEl) stageCityEl.textContent = cityName;
  if (tempEl) tempEl.textContent = tempText;
  if (stageTempEl) stageTempEl.textContent = tempText;
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

  updateOledFacePreview(0);
  updateOledAlarmPreview();
  updateOledClockTick();

  // Cek status daya Bluetooth HP secara native
  if (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') {
    const btOn = window.AndroidBLE.isBluetoothEnabled();
    window.onBluetoothPowerState(btOn);
    if (btOn) {
      window.AndroidBLE.connect();
    }
  }
});
