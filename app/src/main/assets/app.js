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
let scanStartTime = Date.now();
let scanMinTimerId = null;
const MIN_SCAN_ANIMATION_MS = 2500; // Minimal durasi animasi pindai ulang 2.5 detik

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
  if (isScanAnimating) return;
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

  const btnScan = document.getElementById('btnManualScan');
  const scanSpinner = document.getElementById('scanCornerSpinner');
  const scanLabel = document.getElementById('scanCornerLabel');
  const scanningBox = document.getElementById('deviceScanningBox');
  const itemBox = document.getElementById('deviceItemBox');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');

  // Matikan dan nonaktifkan tombol PINDAI ULANG agar tidak bisa dipencet saat sedang mencari
  if (btnScan) {
    btnScan.disabled = true;
    btnScan.classList.add('scanning', 'disabled');
  }
  if (scanSpinner) scanSpinner.style.display = 'inline-block';
  if (scanLabel) scanLabel.textContent = 'PINDAI ULANG';

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
    }, 1800);
  }
}

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
    const btnScan = document.getElementById('btnManualScan');
    const scanSpinner = document.getElementById('scanCornerSpinner');
    const scanLabel = document.getElementById('scanCornerLabel');

    if (nameEl) nameEl.textContent = name || 'Robot Desk';
    if (subEl) subEl.textContent = address ? `Bluetooth (${address})` : 'Bluetooth Siap Terhubung';

    if (btnScan) {
      btnScan.disabled = false;
      btnScan.classList.remove('scanning', 'disabled');
    }
    if (scanSpinner) scanSpinner.style.display = 'none';
    if (scanLabel) scanLabel.textContent = 'PINDAI ULANG';
    isScanAnimating = false;

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
    const btnScan = document.getElementById('btnManualScan');
    const scanSpinner = document.getElementById('scanCornerSpinner');
    const scanLabel = document.getElementById('scanCornerLabel');

    if (btnScan) {
      btnScan.disabled = false;
      btnScan.classList.remove('scanning', 'disabled');
    }
    if (scanSpinner) scanSpinner.style.display = 'none';
    if (scanLabel) scanLabel.textContent = 'PINDAI ULANG';
    isScanAnimating = false;
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
    }
  } catch (e) {
    console.error('Failed to parse incoming BLE JSON', e);
  }
};

// ================= 5. FEATURE ACTION HANDLERS =================

// Ganti Ekspresi Wajah (0..12)
function sendFace(faceIndex, elem) {
  currentFaceIndex = faceIndex;
  document.querySelectorAll('.face-card').forEach(c => c.classList.remove('active'));
  if (elem) elem.classList.add('active');

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

// AKTIVASI KARTU LAYAR OLED INTERAKTIF
function activateOledScreen(mode, elem) {
  document.querySelectorAll('.oled-screen-card').forEach(c => c.classList.remove('active'));
  if (elem) elem.classList.add('active');

  if (typeof mode === 'number') {
    sendDeviceMode(mode);
    const titles = { 0: 'Mode Wajah Robot', 1: 'Mode Jam Digital', 2: 'Mode Cuaca', 5: 'Mode Arcade Game' };
    showNeonToast(titles[mode] || 'Layar Diaktifkan');
  } else if (mode === 'msg') {
    const text = prompt('Ketik pesan untuk ditampilkan di layar Robot Desk:', 'HELLO ROBOT DESK!');
    if (text) {
      sendCommand({ c: 'msg', text: text, source: 'HP' });
      const preview = document.getElementById('oledMsgPreview');
      if (preview) preview.textContent = text.toUpperCase();
      showNeonToast('Pesan Dikirim ke Layar');
      triggerHaptic(30);
    }
  } else if (mode === 'pet') {
    sendPetting();
  }
}

// JAM DIGITAL OLED DENGAN ZONA WAKTU & FORMAT
let currentTimeFormat = 24;
let currentTimezoneOffset = 7;
let currentTempUnit = 'C';

function updateOledClockTick() {
  const clockEl = document.getElementById('oledClockPreview');
  const dateEl = document.getElementById('oledDatePreview');
  if (!clockEl && !dateEl) return;

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const targetTime = new Date(utc + (3600000 * currentTimezoneOffset));

  let hours = targetTime.getHours();
  const minutes = String(targetTime.getMinutes()).padStart(2, '0');

  let timeStr = '';
  if (currentTimeFormat === 12) {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    timeStr = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  } else {
    timeStr = `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  if (clockEl) clockEl.textContent = timeStr;

  if (dateEl) {
    const days = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
    const dayName = days[targetTime.getDay()];
    const dateNum = String(targetTime.getDate()).padStart(2, '0');
    const monthName = months[targetTime.getMonth()];
    dateEl.textContent = `${dayName}, ${dateNum} ${monthName}`;
  }
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

// Pengaturan Satuan Suhu (°C / °F)
function setTempUnit(unit) {
  currentTempUnit = unit;
  const btnC = document.getElementById('btnTempC');
  const btnF = document.getElementById('btnTempF');
  if (btnC) btnC.classList.toggle('active', unit === 'C');
  if (btnF) btnF.classList.toggle('active', unit === 'F');

  const tempPreview = document.getElementById('oledTempPreview');
  if (tempPreview) tempPreview.textContent = unit === 'C' ? '29°C' : '84°F';

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

  const cityPreview = document.getElementById('oledCityPreview');
  if (cityPreview) cityPreview.textContent = city.toUpperCase();

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
