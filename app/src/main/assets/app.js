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

function setDeviceFound(found) {
  isDeviceFound = found;
  const btnConnect = document.getElementById('btnConnectRobot');
  if (btnConnect) {
    btnConnect.disabled = !found;
    if (found) {
      btnConnect.classList.remove('disabled');
    } else {
      btnConnect.classList.add('disabled');
    }
  }
}

function connectToFoundRobot() {
  if (!isDeviceFound) {
    showNeonToast('Robot Desk belum ditemukan');
    return;
  }
  if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
    showNeonToast('Menghubungkan...');
  } else {
    showNeonToast('Menghubungkan (Mock)');
    setTimeout(() => window.onBLEStatus(true, 'Tersambung (Mock)'), 1000);
  }
  triggerHaptic(30);
}

function requestEnableBluetooth() {
  if (window.AndroidBLE && typeof window.AndroidBLE.enableBluetooth === 'function') {
    window.AndroidBLE.enableBluetooth();
    showNeonToast('Meminta Izin Bluetooth');
  } else {
    showNeonToast('Bluetooth Aktif (Mock)');
    window.onBluetoothPowerState(true);
  }
  triggerHaptic(30);
}

function retryAutoScan() {
  setDeviceFound(false);
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');
  if (txtScan) txtScan.textContent = 'Memindai Robot Desk...';
  if (spinner) spinner.style.display = 'block';

  if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
    showNeonToast('Memindai Robot Desk');
  } else {
    showNeonToast('Memindai (Mock)');
    setTimeout(() => {
      setDeviceFound(true);
      if (txtScan) txtScan.textContent = 'Robot Desk Ditemukan';
      if (spinner) spinner.style.display = 'none';
    }, 2000);
  }
  triggerHaptic(30);
}

// BLUETOOTH POWER STATE CALLBACK FROM NATIVE ANDROID
window.onBluetoothPowerState = function(enabled) {
  const txtBt = document.getElementById('txtBtPower');
  const btnEnable = document.getElementById('btnEnableBt');
  const boxBt = document.getElementById('boxBtPower');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');

  if (enabled) {
    if (txtBt) {
      txtBt.textContent = 'AKTIF';
      txtBt.className = 'status-card-state success';
    }
    if (btnEnable) btnEnable.style.display = 'none';
    if (boxBt) boxBt.classList.add('ready');
    if (txtScan && !isBleConnected) txtScan.textContent = 'Memindai Robot Desk...';
    if (spinner && !isBleConnected) spinner.style.display = 'block';
  } else {
    setDeviceFound(false);
    if (txtBt) {
      txtBt.textContent = 'TIDAK AKTIF';
      txtBt.className = 'status-card-state warning';
    }
    if (btnEnable) btnEnable.style.display = 'block';
    if (boxBt) boxBt.classList.remove('ready');
    if (txtScan) txtScan.textContent = 'Nyalakan Bluetooth untuk mulai';
    if (spinner) spinner.style.display = 'none';

    // Strict Lock dashboard when Bluetooth is off
    const gate = document.getElementById('setupGate');
    if (gate) gate.classList.add('active');
  }
};

// BLE CONNECTION STATUS CALLBACK FROM NATIVE ANDROID
window.onBLEStatus = function(connected, message) {
  isBleConnected = connected;
  const dot = document.getElementById('bleDot');
  const label = document.getElementById('bleStatusLabel');
  const gate = document.getElementById('setupGate');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');

  if (connected) {
    setDeviceFound(true);
    if (dot) dot.className = 'pulse-dot online';
    if (label) label.textContent = 'BLE TERHUBUNG';
    if (gate) gate.classList.remove('active'); // BUKA DASHBOARD UTAMA
    showNeonToast('Robot Tersambung');
    syncClockQuiet();
    // Request initial telemetry
    setTimeout(() => sendCommand({ c: 's' }), 400);
  } else {
    const isNotFound = message && message.toLowerCase().includes('tidak ditemukan');
    const isFound = message && (message.toLowerCase().includes('ditemukan') || message.toLowerCase().includes('menghubungkan ke'));

    if (isFound) {
      setDeviceFound(true);
      if (spinner) spinner.style.display = 'none';
    } else if (isNotFound) {
      setDeviceFound(false);
      if (spinner) spinner.style.display = 'none';
    } else {
      setDeviceFound(false);
      if (spinner) spinner.style.display = 'block';
    }

    if (dot) dot.className = 'pulse-dot';
    if (label) label.textContent = 'BLE TERPUTUS';
    if (gate) gate.classList.add('active'); // KUNCI TOTAL DASHBOARD
    if (txtScan) txtScan.textContent = message ? message : 'Memindai Robot Desk...';
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

// ================= 7. PENGATURAN (SETTING) =================

// Pengaturan Kota Cuaca
function saveCitySetting() {
  const input = document.getElementById('cfgCityInput');
  const city = (input ? input.value.trim() : '') || 'Jakarta';
  localStorage.setItem('robot_cfg_city', city);
  showNeonToast('Kota Disimpan: ' + city);
  triggerHaptic(30);
}

function setPresetCity(name) {
  const input = document.getElementById('cfgCityInput');
  if (input) input.value = name;
  saveCitySetting();
}

// Kirim Subtitle Teks Berjalan
function sendCustomSubtitle() {
  const input = document.getElementById('cfgSubtitleInput');
  const text = (input ? input.value.trim() : '');
  if (!text) {
    showNeonToast('Ketik Teks Dulu');
    return;
  }
  const ok = sendCommand({ c: 'msg', text: text, source: 'HP' });
  if (ok) {
    showNeonToast('Teks Ditampilkan');
    triggerHaptic(30);
  }
}

// Pengaturan Alarm
function saveAlarmSettings() {
  const hour = parseInt(document.getElementById('alarmHour').value, 10) || 0;
  const min = parseInt(document.getElementById('alarmMin').value, 10) || 0;
  const en = document.getElementById('alarmEnabledToggle').checked;
  const daily = document.getElementById('alarmDailyToggle').checked;

  const ok = sendCommand({
    cmd: 'alarm',
    hour: Math.max(0, Math.min(23, hour)),
    min: Math.max(0, Math.min(59, min)),
    en: en,
    daily: daily
  });

  if (ok) {
    showNeonToast(en ? 'Alarm Diaktifkan' : 'Alarm Dimatikan');
    triggerHaptic(35);
  }
}

function testAlarmBuzzer() {
  const ok = sendCommand({ cmd: 'alarm_test' });
  if (ok) {
    showNeonToast('Tes Bunyi Alarm');
    triggerHaptic(40);
  }
}

// Sinkronisasi Jam HP
function syncClock() {
  const epochSec = Math.floor(Date.now() / 1000);
  const ok = sendCommand({ cmd: 'time', epoch: epochSec });
  if (ok) {
    showNeonToast('Jam Disinkronkan');
    triggerHaptic(35);
  }
}

function syncClockQuiet() {
  const epochSec = Math.floor(Date.now() / 1000);
  sendCommand({ cmd: 'time', epoch: epochSec });
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
  }

  // Cek status daya Bluetooth HP secara native
  if (window.AndroidBLE && typeof window.AndroidBLE.isBluetoothEnabled === 'function') {
    const btOn = window.AndroidBLE.isBluetoothEnabled();
    window.onBluetoothPowerState(btOn);
    if (btOn) {
      window.AndroidBLE.connect();
    }
  }
});
