/* ========================================================
   ROBOT COMPANION APP CONTROLLER (LOGIC-SYNCHRONIZED)
   ======================================================== */

let isBleConnected = false;
let currentFaceIndex = 0;
let currentActivePage = 'pageFaces';

// TOAST NOTIFICATION HELPER
function showNeonToast(message) {
  const toast = document.getElementById('neonToast');
  if (!toast) return;
  document.getElementById('toastText').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
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

// MULTI-PAGE NAVIGATION (NON-SCROLLABLE FULL VIEWPORT)
function switchPage(pageId) {
  currentActivePage = pageId;

  // Toggle pages
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === pageId);
  });

  // Toggle bottom nav tab states
  document.querySelectorAll('.nav-tab').forEach(tab => {
    const fn = tab.getAttribute('onclick');
    tab.classList.toggle('active', fn && fn.includes(pageId));
  });

  triggerHaptic(15);
}

// NATIVE BLE DISPATCH WRAPPER
function sendCommand(cmdObject) {
  const jsonStr = JSON.stringify(cmdObject);
  if (window.AndroidBLE && typeof window.AndroidBLE.send === 'function') {
    const success = window.AndroidBLE.send(jsonStr);
    if (!success && !isBleConnected) {
      showNeonToast('Bluetooth Belum Terhubung');
    }
    return success;
  } else {
    // Mock for browser testing
    console.log('[MOCK BLE SEND]', jsonStr);
    showNeonToast('Perintah Terkirim (Mock)');
    return true;
  }
}

// TOGGLE BLE CONNECTION
function toggleBleConnection() {
  if (isBleConnected) {
    if (window.AndroidBLE && typeof window.AndroidBLE.disconnect === 'function') {
      window.AndroidBLE.disconnect();
      showNeonToast('Memutuskan Bluetooth...');
    }
  } else {
    if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
      window.AndroidBLE.connect();
      showNeonToast('Memindai Robot ESP32...');
    } else {
      showNeonToast('Modul BLE Siap');
    }
  }
  triggerHaptic(30);
}

// BLE CALLBACK FROM ANDROID JAVA
window.onBLEStatus = function(connected, message) {
  isBleConnected = connected;
  const dot = document.getElementById('bleDot');
  const label = document.getElementById('bleStatusLabel');
  const btnText = document.getElementById('btnBleText');

  if (connected) {
    dot.className = 'pulse-dot online';
    label.textContent = 'BLE TERHUBUNG';
    btnText.textContent = 'PUTUSKAN';
    showNeonToast('Robot Tersambung');
    // Sinkronkan jam otomatis saat pertama kali tersambung
    syncClockQuiet();
  } else {
    dot.className = 'pulse-dot';
    label.textContent = message ? message.toUpperCase() : 'BLE TERPUTUS';
    btnText.textContent = 'SAMBUNGKAN';
  }
};

window.onBLEReceived = function(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data.alarm) {
      if (typeof data.alarm.hour === 'number') document.getElementById('alarmHour').value = data.alarm.hour;
      if (typeof data.alarm.min === 'number') document.getElementById('alarmMin').value = data.alarm.min;
      if (typeof data.alarm.enabled === 'boolean') document.getElementById('alarmEnabledToggle').checked = data.alarm.enabled;
      if (typeof data.alarm.daily === 'boolean') document.getElementById('alarmDailyToggle').checked = data.alarm.daily;
    }
  } catch (e) {
    console.error('Failed to parse incoming BLE JSON', e);
  }
};

// ================= ACTION HANDLERS =================

// 1. Ganti Ekspresi Wajah OLED (0..12)
function sendFace(faceIndex, elem) {
  currentFaceIndex = faceIndex;
  document.querySelectorAll('.face-card').forEach(c => c.classList.remove('active'));
  if (elem) elem.classList.add('active');

  sendCommand({ cmd: 'face', val: faceIndex });
  showNeonToast('Ekspresi Diganti');
  triggerHaptic(25);
}

// 2. Ganti Mode Robot (Game, Jam, Cuaca, dll)
function sendDeviceMode(modeIndex) {
  sendCommand({ cmd: 'mode', val: modeIndex });
  showNeonToast('Mode Robot Diaktifkan');
  triggerHaptic(30);
}

// 3. Tombol Aksi Game (Virtual Action / Jump Tap)
function sendActionTap() {
  sendCommand({ cmd: 'action' });
  triggerHaptic(40);
}

// 4. Sinkronisasi Jam HP ke ESP32
function syncClock() {
  const epochSec = Math.floor(Date.now() / 1000);
  sendCommand({ cmd: 'time', epoch: epochSec });
  showNeonToast('Jam Berhasil Disinkronkan');
  triggerHaptic(35);
}

function syncClockQuiet() {
  const epochSec = Math.floor(Date.now() / 1000);
  sendCommand({ cmd: 'time', epoch: epochSec });
}

// 5. Simpan Pengaturan Alarm
function saveAlarmSettings() {
  const hour = parseInt(document.getElementById('alarmHour').value, 10) || 0;
  const min = parseInt(document.getElementById('alarmMin').value, 10) || 0;
  const en = document.getElementById('alarmEnabledToggle').checked;
  const daily = document.getElementById('alarmDailyToggle').checked;

  sendCommand({
    cmd: 'alarm',
    hour: Math.max(0, Math.min(23, hour)),
    min: Math.max(0, Math.min(59, min)),
    en: en,
    daily: daily
  });

  showNeonToast(en ? 'Alarm Disimpan & Aktif' : 'Alarm Dinonaktifkan');
  triggerHaptic(35);
}

// 6. Tes Buzzer Alarm
function testAlarmBuzzer() {
  sendCommand({ cmd: 'alarm_test' });
  showNeonToast('Menguji Suara Alarm');
  triggerHaptic(40);
}

// 7. Interaksi Fisik Virtual (Tepuk, Elus, Goyang)
function sendTouchTap() {
  sendCommand({ cmd: 'tap' });
  showNeonToast('Tepuk Kepala Virtual');
  triggerHaptic(30);
}

function sendPetting() {
  sendCommand({ cmd: 'pet' });
  showNeonToast('Elus Sayang Robot');
  triggerHaptic(45);
}

function sendShake() {
  sendCommand({ cmd: 'tilt' });
  showNeonToast('Goyang Robot Virtual');
  triggerHaptic(50);
}

// 8. Manajemen Tidur & Bangun
function sendSleep() {
  sendCommand({ cmd: 'sleep' });
  showNeonToast('Robot Masuk Mode Tidur');
  triggerHaptic(30);
}

function sendWake() {
  sendCommand({ cmd: 'wake' });
  showNeonToast('Robot Dibangunkan');
  triggerHaptic(35);
}

// 9. Tes Suara Buzzer Umum
function testBuzzerSound() {
  sendCommand({ cmd: 'buzzer', freq: 2400, dur: 120 });
  showNeonToast('Bunyi Nada Buzzer');
  triggerHaptic(30);
}

// 10. Restart Robot
function restartRobot() {
  if (confirm('Restart mikrokontroler ESP32 sekarang?')) {
    sendCommand({ cmd: 'restart' });
    showNeonToast('Robot Sedang Restart...');
    triggerHaptic(60);
  }
}
