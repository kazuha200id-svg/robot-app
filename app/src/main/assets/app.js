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
let isConnectingState = false;

function toggleSelectDevice() {
  if (!isDeviceFound) return;
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
  const icon = document.getElementById('btnConnectIcon');
  if (!btn) return;

  if (isConnectingState) {
    btn.disabled = true;
    btn.className = 'neon-btn-action full mt-10 btn-state-connecting';
    if (label) label.textContent = 'MENYAMBUNGKAN...';
    if (icon) icon.innerHTML = '<div class="neon-btn-spinner"></div>';
  } else if (isDeviceFound && isDeviceSelected) {
    btn.disabled = false;
    btn.className = 'neon-btn-action full mt-10';
    if (label) label.textContent = 'HUBUNGKAN';
    if (icon) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:6px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
    }
  } else {
    btn.disabled = true;
    btn.className = 'neon-btn-action full mt-10 disabled';
    if (label) label.textContent = 'HUBUNGKAN';
    if (icon) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:6px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
    }
  }
}

function connectToFoundRobot() {
  if (!isDeviceFound || !isDeviceSelected) {
    showNeonToast('Pilih Robot Desk terlebih dahulu');
    return;
  }

  isConnectingState = true;
  updateConnectButtonState();
  triggerHaptic(30);

  if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
  } else {
    // Mock simulation
    setTimeout(() => {
      window.onBLEStatus(true, 'Tersambung (Mock)');
    }, 1500);
  }
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
  isDeviceFound = false;
  isDeviceSelected = false;
  isConnectingState = false;

  const scanningBox = document.getElementById('deviceScanningBox');
  const itemBox = document.getElementById('deviceItemBox');
  const txtScan = document.getElementById('txtScanState');
  const spinner = document.getElementById('scanSpinner');

  if (scanningBox) scanningBox.style.display = 'flex';
  if (itemBox) {
    itemBox.style.display = 'none';
    itemBox.classList.remove('selected');
  }
  if (txtScan) txtScan.textContent = 'Memindai Robot Desk...';
  if (spinner) spinner.style.display = 'block';

  updateConnectButtonState();
  triggerHaptic(30);

  if (window.AndroidBLE && typeof window.AndroidBLE.startScan === 'function') {
    window.AndroidBLE.startScan();
    showNeonToast('Memindai Robot Desk');
  } else if (window.AndroidBLE && typeof window.AndroidBLE.connect === 'function') {
    window.AndroidBLE.connect();
    showNeonToast('Memindai Robot Desk');
  } else {
    showNeonToast('Memindai (Mock)');
    setTimeout(() => {
      window.onDeviceDiscovered('Robot Desk', 'Siap Terhubung');
    }, 1800);
  }
}

// CALLBACK: DISCOVERED DEVICE
window.onDeviceDiscovered = function(name, address) {
  isDeviceFound = true;
  const scanningBox = document.getElementById('deviceScanningBox');
  const itemBox = document.getElementById('deviceItemBox');
  const nameEl = document.getElementById('detectedDevName');
  const subEl = document.getElementById('detectedDevSub');

  if (nameEl) nameEl.textContent = name || 'Robot Desk';
  if (subEl) subEl.textContent = address ? `Bluetooth (${address})` : 'Bluetooth Siap Terhubung';

  if (scanningBox) scanningBox.style.display = 'none';
  if (itemBox) {
    itemBox.style.display = 'flex';
  }

  updateConnectButtonState();
};

// BLUETOOTH POWER STATE CALLBACK FROM NATIVE ANDROID
window.onBluetoothPowerState = function(enabled) {
  const txtBt = document.getElementById('txtBtPower');
  const btnEnable = document.getElementById('btnEnableBt');
  const boxBt = document.getElementById('boxBtPower');
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
    if (txtScan && !isBleConnected && !isDeviceFound) {
      txtScan.textContent = 'Memindai Robot Desk...';
      if (spinner) spinner.style.display = 'block';
    }
  } else {
    isDeviceFound = false;
    isDeviceSelected = false;
    isConnectingState = false;

    if (txtBt) {
      txtBt.textContent = 'TIDAK AKTIF';
      txtBt.className = 'status-card-state warning';
    }
    if (btnEnable) btnEnable.style.display = 'block';
    if (boxBt) boxBt.classList.remove('ready');

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

    // Strict Lock dashboard when Bluetooth is off
    if (gate) gate.classList.add('active');
  }
};

// BLE CONNECTION STATUS CALLBACK FROM NATIVE ANDROID
window.onBLEStatus = function(connected, message) {
  isBleConnected = connected;
  const dot = document.getElementById('bleDot');
  const label = document.getElementById('bleStatusLabel');
  const gate = document.getElementById('setupGate');
  const btn = document.getElementById('btnConnectRobot');
  const btnLabel = document.getElementById('btnConnectLabel');
  const btnIcon = document.getElementById('btnConnectIcon');

  if (connected) {
    isConnectingState = false;
    if (dot) dot.className = 'pulse-dot online';
    if (label) label.textContent = 'BLE TERHUBUNG';

    // Animasi BERHASIL pada tombol
    if (btn) {
      btn.disabled = true;
      btn.className = 'neon-btn-action full mt-10 btn-state-success';
      if (btnLabel) btnLabel.textContent = 'BERHASIL';
      if (btnIcon) {
        btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#00FF88" stroke-width="3" style="vertical-align:middle;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }
    }

    triggerHaptic(40);
    showNeonToast('Robot Tersambung');

    // Masuk ke aplikasi setelah jeda ~600ms
    setTimeout(() => {
      if (gate) gate.classList.remove('active');
      syncClockQuiet();
      setTimeout(() => sendCommand({ c: 's' }), 400);
    }, 600);

  } else {
    if (dot) dot.className = 'pulse-dot';
    if (label) label.textContent = 'BLE TERPUTUS';
    if (gate) gate.classList.add('active'); // Kunci total dashboard jika terputus

    if (isConnectingState) {
      isConnectingState = false;
      if (btn) {
        btn.disabled = true;
        btn.className = 'neon-btn-action full mt-10 btn-state-failed';
        if (btnLabel) btnLabel.textContent = 'GAGAL TERHUBUNG';
        if (btnIcon) {
          btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#FF3366" stroke-width="2.5" style="vertical-align:middle;margin-right:6px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        }
      }
      triggerHaptic(50);
      showNeonToast(message || 'Gagal Menghubungkan');

      // Setelah 2 detik, kembalikan tombol ke keadaan HUBUNGKAN (tetap terpilih agar mudah coba lagi)
      setTimeout(() => {
        updateConnectButtonState();
      }, 2000);

    } else {
      const isNotFound = message && message.toLowerCase().includes('tidak ditemukan');
      const txtScan = document.getElementById('txtScanState');
      const spinner = document.getElementById('scanSpinner');

      if (isNotFound) {
        if (txtScan) txtScan.textContent = 'Robot Desk Tidak Ditemukan';
        if (spinner) spinner.style.display = 'none';
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
