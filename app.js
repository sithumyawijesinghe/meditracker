/* app.js - Medi Tracker application core */

const defaultFirebaseConfig = {
  apiKey: 'AIzaSyCm6P6hbK2tiNWhJiJCGwTvvLFSj2xcKYU',
  authDomain: 'meditracker-system.firebaseapp.com',
  databaseURL: 'https://meditracker-system-default-rtdb.firebaseio.com',
  projectId: 'meditracker-system',
  storageBucket: 'meditracker-system.firebasestorage.app',
  messagingSenderId: '1077297128468',
  appId: '1:1077297128468:web:8d597ed5b86ee2da00b301'
};
const savedFirebaseConfig = JSON.parse(localStorage.getItem('firebase_config') || 'null');
const savedPatientProfile = JSON.parse(localStorage.getItem('patient_profile') || 'null');
let firebaseDb = null;
let firebaseListenersAttached = false;

// Default Application State
const state = {
  currentUser: JSON.parse(localStorage.getItem('dispenser_user')) || null,
  patientProfile: savedPatientProfile || null,
  activeTab: 'dashboard',
  wifiConfig: {
    ssid: 'ESW',
    password: 'Bpps.kjM',
    ip: localStorage.getItem('esp32_ip') || '192.168.8.20',
    status: 'Connected'
  },
  containers: [
    { id: 1, name: 'Paracetamol 500mg', morning: true, lunch: false, night: true, stock: 12, maxStock: 20, dosage: 1 },
    { id: 2, name: 'Amoxicillin 250mg', morning: true, lunch: true, night: true, stock: 8, maxStock: 20, dosage: 1 },
    { id: 3, name: 'Vitamin C 1000mg', morning: true, lunch: false, night: false, stock: 4, maxStock: 20, dosage: 1 },
    { id: 4, name: 'Aspirin 81mg', morning: false, lunch: false, night: true, stock: 15, maxStock: 20, dosage: 1 }
  ],
  liquid: {
    name: 'Cough Syrup (Benadryl)',
    morning: true,
    lunch: true,
    night: false,
    level: 65, // percentage
    volumeMl: 130,
    maxVolumeMl: 200,
    doseMl: 10,
    calib_ms: Number(localStorage.getItem('liquid_calib_ms')) || 250
  },
  telemetry: {
    online: false,
    liquidMl: null,
    irPillDetected: false,
    rssi: null,
    lastSeen: null
  },
  firebase: { ...defaultFirebaseConfig, ...(savedFirebaseConfig || {}), cloudSync: savedFirebaseConfig?.cloudSync ?? true },
  history: JSON.parse(localStorage.getItem('dispenser_history')) || [
    { timestamp: '2026-09-29 08:00:00', type: 'Tablet', item: 'Paracetamol 500mg (Container 1)', timeSlot: 'Morning', status: 'Dispensed Successfully' },
    { timestamp: '2026-09-29 08:00:05', type: 'Liquid', item: 'Cough Syrup 10ml', timeSlot: 'Morning', status: 'Dispensed Successfully' },
    { timestamp: '2026-09-29 12:00:00', type: 'Tablet', item: 'Amoxicillin 250mg (Container 2)', timeSlot: 'Lunch', status: 'Dispensed Successfully' }
  ]
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  setupAudioSynth();
  initFirebaseConfigUI();
  startStatusPolling();

  playSplashScreen();

  // Auto-schedule simulator to check morning/lunch/night alarms
  setInterval(checkAutomatedSchedules, 10000);
});

function playSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) {
    revealInitialView();
    return;
  }

  const finish = () => {
    if (splash.dataset.finished === 'true') return;
    splash.dataset.finished = 'true';
    splash.classList.add('fade-out');
    window.setTimeout(() => {
      if (splash.dataset.revealed === 'true') return;
      splash.style.display = 'none';
      splash.dataset.revealed = 'true';
      revealInitialView();
    }, 800);
  };

  splash.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'opacity') {
      if (splash.dataset.revealed === 'true') return;
      splash.style.display = 'none';
      splash.dataset.revealed = 'true';
      revealInitialView();
    }
  }, { once: true });

  window.setTimeout(finish, 2700);
}

function revealInitialView() {
  if (state.currentUser) {
    showMainApp();
  } else {
    showAuthView('login');
  }
}

// Setup Web Audio API sound generator for alerts
let audioCtx;
function setupAudioSynth() {
  window.playAlertSound = (type = 'dispense') => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'dispense') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      } else if (type === 'alert') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
      }
    } catch (e) {
      console.log('Audio playback prevented or unsupported', e);
    }
  };
}

function initUI() {
  // Navigation Event Listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  const activeContent = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.style.display = 'block';
}

// Authentication Handlers
function showAuthView(viewMode) {
  document.getElementById('app-main').style.display = 'none';
  document.getElementById('auth-section').style.display = 'flex';

  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  if (viewMode === 'login') {
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
  } else {
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
  }
}

function doLogin() {
  const nameInput = document.getElementById('login-name');
  const phoneInput = document.getElementById('login-phone');
  
  const name = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : 'Patient';
  const phone = (phoneInput && phoneInput.value.trim()) ? phoneInput.value.trim() : '9876543210';

  state.currentUser = state.patientProfile
    ? { ...state.patientProfile }
    : { name, mobile: phone, age: 'N/A', email: 'N/A' };
  localStorage.setItem('dispenser_user', JSON.stringify(state.currentUser));
  showToast('Welcome!', `Logged in as ${name}`, 'info');
  showMainApp();
}

function handleLogin(event) {
  if (event && event.preventDefault) event.preventDefault();
  doLogin();
}

function handleSignup(event) {
  event.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const age = Number(document.getElementById('signup-age').value);
  const bloodGroup = document.getElementById('signup-blood-group').value;
  const phone = document.getElementById('signup-phone').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const hasAllergies = document.getElementById('signup-has-allergies').checked;
  const allergies = document.getElementById('signup-allergies').value.trim();
  const hasOtherCondition = document.getElementById('condition-other-toggle').checked;
  const otherConditions = document.getElementById('signup-other-conditions').value.trim();

  if (!name || !Number.isInteger(age) || age < 1 || age > 120 || !bloodGroup || !phone || !email) {
    showToast('Registration Error', 'Please complete all required fields.', 'danger');
    return;
  }
  if (hasAllergies && !allergies) {
    showToast('Registration Error', 'Please specify the known allergies or uncheck the allergy option.', 'danger');
    return;
  }
  if (hasOtherCondition && !otherConditions) {
    showToast('Registration Error', 'Please specify the other condition or uncheck the option.', 'danger');
    return;
  }

  const conditions = [];
  if (document.getElementById('condition-diabetes').checked) conditions.push('Diabetes');
  if (document.getElementById('condition-hypertension').checked) conditions.push('Hypertension / Blood Pressure');
  if (document.getElementById('condition-cholesterol').checked) conditions.push('High Cholesterol');
  if (document.getElementById('condition-gerd').checked) conditions.push('Gastric / GERD');
  if (hasOtherCondition) conditions.push(otherConditions);

  state.patientProfile = {
    name,
    age,
    bloodGroup,
    mobile: phone,
    email,
    hasAllergies,
    allergies: hasAllergies ? allergies : '',
    conditions,
    medicalNotes: document.getElementById('signup-medical-notes').value.trim(),
    updatedAt: new Date().toISOString()
  };
  state.currentUser = { ...state.patientProfile };
  localStorage.setItem('dispenser_user', JSON.stringify(state.currentUser));
  localStorage.setItem('patient_profile', JSON.stringify(state.patientProfile));
  writeFirebase('patient_profile', state.patientProfile);
  showToast('Account Created!', 'Registration successful. Welcome to IoT Dispenser.', 'info');
  showMainApp();
}

function handleLogout() {
  state.currentUser = null;
  localStorage.removeItem('dispenser_user');
  showAuthView('login');
  showToast('Logged Out', 'You have been logged out.', 'info');
}

function showMainApp() {
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('app-main').style.display = 'block';

  // Update header profile display
  document.getElementById('header-user-name').innerText = state.currentUser.name;

  renderPatientOverview();
  renderContainers();
  renderLiquidModule();
  renderHistoryTable();
  switchTab('dashboard');
}

function toggleProfileField(field) {
  const mapping = {
    allergies: ['signup-has-allergies', 'signup-allergies-wrap', 'signup-allergies'],
    'other-conditions': ['condition-other-toggle', 'signup-other-conditions-wrap', 'signup-other-conditions']
  };
  const values = mapping[field];
  if (!values) return;
  const toggle = document.getElementById(values[0]);
  const wrapper = document.getElementById(values[1]);
  const input = document.getElementById(values[2]);
  const enabled = Boolean(toggle?.checked);
  if (wrapper) wrapper.hidden = !enabled;
  if (input) {
    input.required = enabled;
    if (!enabled) input.value = '';
    if (enabled) input.focus();
  }
}

function renderPatientOverview() {
  const overview = document.getElementById('patient-overview');
  if (!overview) return;
  const profile = state.patientProfile || state.currentUser || {};
  const conditions = Array.isArray(profile.conditions) ? profile.conditions.filter(Boolean) : [];
  const hasAllergies = Boolean(profile.hasAllergies && profile.allergies);
  const allergyMarkup = hasAllergies
    ? `<span class="patient-allergy-badge"><i class="fa-solid fa-triangle-exclamation"></i> Allergies: ${escapeHtml(profile.allergies)}</span>`
    : '<span class="patient-allergy-badge patient-allergy-clear"><i class="fa-solid fa-shield-heart"></i> No known allergies</span>';
  const conditionMarkup = conditions.length
    ? conditions.map(condition => `<span class="patient-condition-tag">${escapeHtml(condition)}</span>`).join('')
    : '<span class="patient-overview-muted">No conditions recorded</span>';
  const notes = profile.medicalNotes || 'No special clinical notes added.';

  overview.innerHTML = `
    <div class="patient-overview-primary">
      <div class="patient-avatar"><i class="fa-solid fa-user-injured"></i></div>
      <div>
        <p class="patient-overview-kicker">Patient Profile</p>
        <h2 id="patient-overview-title">Welcome, ${escapeHtml(profile.name || 'Patient')}</h2>
        <div class="patient-summary-badges">
          <span class="patient-summary-badge">Age ${escapeHtml(profile.age ?? 'N/A')}</span>
          <span class="patient-summary-badge">${escapeHtml(profile.bloodGroup || 'Blood group pending')}</span>
          <span class="patient-status-badge"><i class="fa-solid fa-circle"></i> Active</span>
        </div>
      </div>
    </div>
    <div class="patient-overview-conditions">
      <p class="patient-overview-label">Active Medical Conditions</p>
      <div class="patient-condition-list">${conditionMarkup}</div>
      ${allergyMarkup}
    </div>
    <div class="patient-overview-notes">
      <p class="patient-overview-label"><i class="fa-solid fa-notes-medical"></i> Special Clinical Notes</p>
      <p>${escapeHtml(notes)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

// Render Tablet Containers (4 Containers matching UI screenshot)
function renderContainers() {
  const containerGrid = document.getElementById('containers-grid');
  if (!containerGrid) return;

  containerGrid.innerHTML = state.containers.map(c => {
      const isLow = c.stock <= 5;
    const stockPercent = Math.round((c.stock / c.maxStock) * 100);

    return `
      <div class="container-card ${isLow ? 'low-stock' : ''}">
        <div class="card-header">
          <span class="container-number">Container ${c.id}</span>
          <span class="badge ${isLow ? 'badge-warning' : 'badge-success'}">
            ${isLow ? 'Low Pills' : 'Ready'}
          </span>
        </div>
        
        <div class="form-group">
          <label>Medicine Name</label>
          <input id="medicine-name-${c.id}" type="text" class="form-control" value="${c.name}" onchange="updateMedicineName(${c.id}, this.value)">
        </div>

        <div class="form-group">
          <label for="dosage-${c.id}">Dosage per dispense</label>
          <select id="dosage-${c.id}" class="form-control" onchange="updateDosage(${c.id}, this.value)">
            ${[1, 2, 3, 4, 5].map(count => `<option value="${count}" ${c.dosage === count ? 'selected' : ''}>${count} tablet${count === 1 ? '' : 's'}</option>`).join('')}
          </select>
        </div>

        <div class="time-checkboxes">
          <label class="time-option">
            <input id="schedule-${c.id}-morning" type="checkbox" ${c.morning ? 'checked' : ''} onchange="toggleTimeSlot(${c.id}, 'morning', this.checked)">
            Morning
          </label>
          <label class="time-option">
            <input id="schedule-${c.id}-lunch" type="checkbox" ${c.lunch ? 'checked' : ''} onchange="toggleTimeSlot(${c.id}, 'lunch', this.checked)">
            Lunch
          </label>
          <label class="time-option">
            <input id="schedule-${c.id}-night" type="checkbox" ${c.night ? 'checked' : ''} onchange="toggleTimeSlot(${c.id}, 'night', this.checked)">
            Night
          </label>
        </div>

        <div class="stock-meter">
          <div class="meter-label">
            <span>Tablet Stock: <strong>${c.stock}/${c.maxStock}</strong></span>
            <span>${stockPercent}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${isLow ? 'warning' : ''}" style="width: ${stockPercent}%"></div>
          </div>
        </div>

        <div class="container-card-actions">
          <button class="btn btn-primary" onclick="saveContainerConfiguration(${c.id})">
            <i class="fa-solid fa-floppy-disk"></i> Save
          </button>
          <button class="btn btn-secondary" onclick="clearContainerConfiguration(${c.id})">
            <i class="fa-solid fa-eraser"></i> Clear
          </button>
          <button class="btn btn-secondary" onclick="refillContainer(${c.id})">
            <i class="fa-solid fa-plus"></i> Refill
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Render Liquid Dispenser Module
function renderLiquidModule() {
  const liquidCard = document.getElementById('liquid-card-content');
  if (!liquidCard) return;

  const liq = state.liquid;
  const sensorVolume = state.telemetry.online && state.telemetry.liquidMl !== null
    ? state.telemetry.liquidMl
    : liq.volumeMl;
  const displayedLevel = Math.min(100, Math.max(0, Math.round((sensorVolume / liq.maxVolumeMl) * 100)));
  const isLow = displayedLevel <= 20;

  liquidCard.innerHTML = `
    <div class="liquid-visual">
      <div class="bottle-graphic">
        <div class="liquid-fill" style="height: ${displayedLevel}%"></div>
      </div>
      <span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">
        ${isLow ? 'CRITICAL LOW LIQUID' : 'Liquid Volume Normal'}
      </span>
      <div style="margin-top: 0.5rem; font-size: 0.9rem; font-weight: 600;">
        ${sensorVolume} ml / ${liq.maxVolumeMl} ml (${displayedLevel}%, ${state.telemetry.online ? 'ultrasonic sensor' : 'local estimate'})
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="section-title">
        <i class="fa-solid fa-bottle-droplet" style="color: #60a5fa;"></i> Liquid Medicine Dispenser Settings
      </div>

      <div class="form-group">
        <label>Liquid Medicine Name</label>
        <input type="text" class="form-control" value="${liq.name}" onchange="state.liquid.name = this.value">
      </div>

      <div class="form-group">
        <label>Dispensary Dosage (ml)</label>
        <input id="liquid-dose-input" type="number" class="form-control" value="${liq.doseMl ?? ''}" min="1" max="100" step="1" placeholder="1 - 100" onchange="state.liquid.doseMl = this.value === '' ? null : parseInt(this.value, 10)">
      </div>

      <div class="calibration-panel">
        <div class="panel-label">Pump calibration <span>${liq.calib_ms} ms/ml</span></div>
        <div class="calibration-presets">
          ${[
            ['Water', 250],
            ['Light Syrup', 350],
            ['Thick Syrup', 500]
          ].map(([label, value]) => `<button class="calibration-preset ${liq.calib_ms === value ? 'selected' : ''}" onclick="setLiquidCalibration(${value})">${label}<small>${value} ms/ml</small></button>`).join('')}
        </div>
        <label class="range-label" for="calibration-slider">Custom: <strong id="calibration-value">${liq.calib_ms} ms/ml</strong></label>
        <input id="calibration-slider" type="range" min="100" max="800" step="10" value="${liq.calib_ms}" oninput="setLiquidCalibration(this.value, false)">
      </div>

      <div class="refill-panel">
        <div class="section-title"><i class="fa-solid fa-fill-drip" style="color: var(--primary);"></i> Refill Bottle / Set Total Liquid (ml)</div>
        <div class="refill-form">
          <input id="liquid-refill-volume" class="form-control" type="number" min="50" max="500" step="1" placeholder="200" value="${liq.maxVolumeMl}">
          <button class="btn btn-primary" type="button" onclick="refillLiquidBottle()">
            <i class="fa-solid fa-check"></i> Confirm Refill / Update Level
          </button>
        </div>
        <span class="config-help">Enter the total volume after physically refilling the bottle. Valid range: 50–500 ml.</span>
      </div>

      <div class="time-checkboxes" style="grid-template-columns: repeat(3, 1fr);">
        <label class="time-option">
          <input id="liquid-schedule-morning" type="checkbox" ${liq.morning ? 'checked' : ''} onchange="state.liquid.morning = this.checked">
          Morning (8 AM)
        </label>
        <label class="time-option">
          <input id="liquid-schedule-lunch" type="checkbox" ${liq.lunch ? 'checked' : ''} onchange="state.liquid.lunch = this.checked">
          Lunch (12 PM)
        </label>
        <label class="time-option">
          <input id="liquid-schedule-night" type="checkbox" ${liq.night ? 'checked' : ''} onchange="state.liquid.night = this.checked">
          Night (8 PM)
        </label>
      </div>

      <div class="container-card-actions liquid-card-actions">
        <button class="btn btn-primary" onclick="saveLiquidConfiguration()">
          <i class="fa-solid fa-floppy-disk"></i> Save Config
        </button>
        <button class="btn btn-secondary" onclick="clearLiquidConfiguration()">
          <i class="fa-solid fa-eraser"></i> Clear
        </button>
        <button class="btn btn-secondary" onclick="refillLiquidBottle()">
          <i class="fa-solid fa-arrows-rotate"></i> Fill Liquid Bottle
        </button>
      </div>
    </div>
  `;
}

// Send HTTP signal to physical ESP32 Microcontroller over Wi-Fi
async function sendESP32Command(endpoint) {
  const ip = state.wifiConfig.ip || '192.168.8.25';
  console.log(`[HTTP] Sending command to ESP32 at http://${ip}${endpoint}`);

  const response = await fetch(`http://${ip}${endpoint}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error('The dispenser returned an unreadable response.');
  }
  if (!response.ok || result.error || result.status === 'EMPTY_OR_JAMMED') {
    const rawMessage = result.error || result.message || result.status || '';
    const friendlyMessage = rawMessage === 'EMPTY_OR_JAMMED'
      ? 'Tablet Not Detected. Please check the container and chute.'
      : rawMessage === 'INSUFFICIENT_STOCK'
        ? 'Not enough tablets are available for this dose.'
        : rawMessage === 'LOW_LIQUID_LEVEL'
          ? 'There is not enough liquid for this dose. Please refill the bottle.'
          : rawMessage || 'The dispenser could not complete the request.';
    const error = new Error(friendlyMessage);
    error.code = result.message || result.status;
    throw error;
  }
  return result;
}

// Tablet Dispense Logic & ESP32 Hardware Signal
async function dispenseTablet(containerId, requestedCount) {
  const c = state.containers.find(x => x.id === containerId);
  if (!c) return;

  const count = Number(requestedCount || c.dosage || 1);
  if (c.stock <= 0) {
    showToast('Empty Container - Refill Required', `Container ${containerId} (${c.name}) has no pills remaining.`, 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
    return;
  }
  if (c.stock < count) {
    showToast('Insufficient Stock', `Need ${count} tablet${count === 1 ? '' : 's'}, but ${c.name} has only ${c.stock}.`, 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
    return;
  }

  try {
    syncDispenseTrigger({
      type: 'tablet',
      container: containerId,
      count,
      requestedAt: getFirebaseTimestamp()
    });
    const result = await sendESP32Command(`/dispense?container=${containerId}&count=${count}`);
    c.stock -= count;
    syncInventoryStock(containerId, c.stock);
    renderContainers();
    addDispenseHistory('Tablet', `${c.name} (Container ${c.id}, ${count} tablet${count === 1 ? '' : 's'})`, 'Dispensed Successfully');
    if (window.playAlertSound) window.playAlertSound('dispense');
    showToast('Tablet Dispensed!', `${count} tablet${count === 1 ? '' : 's'} dispensed successfully.`, 'info');
    sendMobilePushNotification('Tablet Dispensed Notification', `Take ${count} tablet${count === 1 ? '' : 's'} of ${c.name}.`);
    if (c.stock <= 3) {
      showToast('Low Tablet Warning!', `Container ${c.id} has only ${c.stock} pills remaining.`, 'warning');
    }
    return result;
  } catch (error) {
    if (error.code === 'EMPTY_CONTAINER') {
      showToast('Empty Container - Refill Required', `Container ${containerId} is empty.`, 'danger');
    } else if (error.code === 'EMPTY_OR_JAMMED') {
      showToast('Tablet Not Detected', 'Tablet Not Detected. Please check the container and chute.', 'danger');
    } else {
      showToast('Dispenser Offline', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    }
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

// Liquid Dispense Logic & ESP32 Pump Signal
async function dispenseLiquid() {
  const liq = state.liquid;
  if (!Number.isInteger(liq.doseMl) || liq.doseMl < 1 || liq.doseMl > 100) {
    showToast('Liquid Dosage Not Configured', 'Save a valid liquid dosage before dispensing.', 'warning');
    return;
  }
  if (liq.volumeMl < liq.doseMl) {
    showToast('Liquid Container Low!', 'Not enough liquid to dispense dose. Please fill bottle!', 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
    return;
  }

  try {
    syncDispenseTrigger({
      type: 'liquid',
      dose: liq.doseMl,
      calib_ms: liq.calib_ms,
      requestedAt: getFirebaseTimestamp()
    });
    await sendESP32Command(`/dispense_liquid?dose=${liq.doseMl}&calib_ms=${liq.calib_ms}`);
    liq.volumeMl -= liq.doseMl;
    liq.level = Math.round((liq.volumeMl / liq.maxVolumeMl) * 100);
    syncLiquidVolume(liq.volumeMl);
    renderLiquidModule();
    addDispenseHistory('Liquid', `${liq.name} (${liq.doseMl} ml)`, 'Dispensed Successfully');
    if (window.playAlertSound) window.playAlertSound('dispense');
    showToast('Liquid Dispensed!', `${liq.doseMl} ml of ${liq.name} poured.`, 'info');
    sendMobilePushNotification('Liquid Medicine Notification', `${liq.doseMl} ml of ${liq.name} is ready.`);
    if (liq.level <= 20) showToast('Low Liquid Warning!', `Liquid level is down to ${liq.level}%.`, 'warning');
  } catch (error) {
    showToast('Liquid Dispense Failed', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

async function testDispenseTablet(containerId) {
  const container = state.containers.find(item => item.id === containerId);
  if (!container) return;
  if (container.stock <= 0) {
    showToast('Empty Container - Refill Required', `Container ${containerId} has no pills available for testing.`, 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
    return;
  }

  try {
    syncDispenseTrigger({
      type: 'diagnostic_tablet',
      container: containerId,
      count: 1,
      requestedAt: getFirebaseTimestamp()
    });
    await sendESP32Command(`/dispense?container=${containerId}&count=1`);
    container.stock -= 1;
    syncInventoryStock(containerId, container.stock);
    renderContainers();
    addDispenseHistory(
      'System Diagnostic Test',
      `${container.name || `Container ${containerId}`} (Container ${containerId})`,
      'Verified'
    );
    showToast('Diagnostic Test Verified', `Container ${containerId} dispensed one tablet.`, 'info');
  } catch (error) {
    if (error.code === 'EMPTY_CONTAINER' || error.code === 'INSUFFICIENT_STOCK') {
      showToast('Empty Container - Refill Required', `Container ${containerId} cannot complete the diagnostic test.`, 'danger');
    } else if (error.code === 'EMPTY_OR_JAMMED') {
      showToast('Diagnostic Test Failed', 'Tablet Not Detected. Please check the container and chute.', 'danger');
    } else {
      showToast('Diagnostic Test Failed', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    }
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

async function testDispenseLiquid() {
  const liq = state.liquid;
  if (!Number.isInteger(liq.doseMl) || liq.doseMl < 1 || liq.doseMl > 100) {
    showToast('Liquid Dosage Not Configured', 'Save a valid liquid dosage before running the pump test.', 'warning');
    return;
  }
  if (liq.volumeMl < liq.doseMl) {
    showToast('Liquid Container Low', 'Refill the liquid bottle before running the pump test.', 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
    return;
  }

  try {
    syncDispenseTrigger({
      type: 'diagnostic_liquid',
      dose: liq.doseMl,
      calib_ms: liq.calib_ms,
      requestedAt: getFirebaseTimestamp()
    });
    await sendESP32Command(`/dispense_liquid?dose=${liq.doseMl}&calib_ms=${liq.calib_ms}`);
    liq.volumeMl -= liq.doseMl;
    liq.level = Math.round((liq.volumeMl / liq.maxVolumeMl) * 100);
    syncLiquidVolume(liq.volumeMl);
    renderLiquidModule();
    addDispenseHistory('System Diagnostic Test', `Liquid Pump (${liq.doseMl} ml)`, 'Verified');
    showToast('Diagnostic Test Verified', `${liq.doseMl} ml pump test completed.`, 'info');
  } catch (error) {
    showToast('Pump Test Failed', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

async function refillLiquidBottle() {
  const input = document.getElementById('liquid-refill-volume');
  const volume = Number(input && input.value);
  if (!Number.isInteger(volume) || volume < 50 || volume > 500) {
    showToast('Invalid Refill Volume', 'Enter a whole-number volume from 50 ml to 500 ml.', 'danger');
    return;
  }

  const liq = state.liquid;
  const previous = {
    volumeMl: liq.volumeMl,
    maxVolumeMl: liq.maxVolumeMl,
    level: liq.level
  };
  liq.volumeMl = volume;
  liq.maxVolumeMl = volume;
  liq.level = 100;
  renderLiquidModule();

  try {
    const result = await sendESP32Command(`/refill_liquid?volume=${volume}`);
    syncLiquidVolume(volume);
    addDispenseHistory('Refill', `Liquid Refill: +${volume} ml`, 'Liquid bottle level updated');
    showToast('Liquid Refilled', `${volume} ml set as the new total bottle volume.`, 'info');
    return result;
  } catch (error) {
    liq.volumeMl = previous.volumeMl;
    liq.maxVolumeMl = previous.maxVolumeMl;
    liq.level = previous.level;
    renderLiquidModule();
    showToast('Refill Failed', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

// Refill Operations
let activeRefillContainerId = null;
let refillModalCloseTimer = null;

function refillModalElements() {
  return {
    modal: document.getElementById('custom-refill-modal'),
    containerId: document.getElementById('refill-container-id'),
    input: document.getElementById('refill-stock-input'),
    error: document.getElementById('refill-modal-error'),
    form: document.getElementById('refill-modal-form')
  };
}

function refillContainer(containerId) {
  const c = state.containers.find(x => x.id === containerId);
  if (!c) return;

  const elements = refillModalElements();
  if (!elements.modal || !elements.input) {
    showToast('Refill Unavailable', 'The refill dialog could not be opened.', 'danger');
    return;
  }

  activeRefillContainerId = containerId;
  elements.containerId.textContent = containerId;
  elements.input.value = '';
  elements.input.setAttribute('aria-invalid', 'false');
  elements.error.textContent = '';
  elements.form?.querySelectorAll('.refill-chip').forEach(chip => chip.classList.remove('selected'));

  window.clearTimeout(refillModalCloseTimer);
  elements.modal.hidden = false;
  requestAnimationFrame(() => {
    elements.modal.classList.add('is-open');
    elements.input.focus();
  });
}

function selectRefillQuantity(quantity) {
  const { input, error } = refillModalElements();
  if (!input) return;
  input.value = quantity;
  input.setAttribute('aria-invalid', 'false');
  if (error) error.textContent = '';
  document.querySelectorAll('.refill-chip').forEach(chip => {
    chip.classList.toggle('selected', Number(chip.dataset.refillValue) === quantity);
  });
  input.focus();
}

function closeRefillModal() {
  const { modal, input, error } = refillModalElements();
  if (!modal || modal.hidden) return;

  modal.classList.remove('is-open');
  activeRefillContainerId = null;
  refillModalCloseTimer = window.setTimeout(() => {
    modal.hidden = true;
    if (input) {
      input.value = '';
      input.setAttribute('aria-invalid', 'false');
    }
    if (error) error.textContent = '';
  }, 220);
}

async function confirmRefill(event) {
  event.preventDefault();
  const containerId = activeRefillContainerId;
  const { input, error } = refillModalElements();
  if (!containerId || !input || !error) return;

  const stock = Number(input.value);
  if (!Number.isInteger(stock) || stock < 1 || stock > 20) {
    error.textContent = 'Enter a whole number from 1 to 20 pills.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }

  closeRefillModal();
  const c = state.containers.find(x => x.id === containerId);
  if (!c) return;

  try {
    await sendESP32Command(`/refill_tablet?container=${containerId}&stock=${stock}`);
    c.stock = stock;
    syncInventoryStock(containerId, c.stock);
    renderContainers();
    addDispenseHistory(
      'Refill',
      `Container ${containerId} Refilled: +${stock} pills`,
      'Stock updated on dispenser'
    );
    showToast('Container Refilled', `Container ${containerId} now has ${stock} pills.`, 'info');
  } catch (error) {
    if (error.code === 'INVALID_STOCK' || error.code === 'INVALID_CONTAINER') {
      showToast('Refill Rejected', 'Please check the container and stock quantity.', 'danger');
    } else {
      showToast('Stock Sync Failed', 'Dispenser Offline. Please check device power and Wi-Fi connection.', 'danger');
    }
    if (window.playAlertSound) window.playAlertSound('alert');
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeRefillContainerId !== null) {
    closeRefillModal();
  }
});

function refillLiquid() {
  state.liquid.volumeMl = state.liquid.maxVolumeMl;
  state.liquid.level = 100;
  syncLiquidVolume(state.liquid.volumeMl);
  renderLiquidModule();
  showToast('Liquid Bottle Refilled', 'Liquid container filled to 100% (200ml).', 'info');

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  state.history.unshift({
    timestamp: nowStr,
    type: 'Refill',
    item: `Liquid Medicine (${state.liquid.name})`,
    timeSlot: 'Manual',
    status: 'Volume refilled to 200ml'
  });
  saveHistory();
  renderHistoryTable();
}

function updateMedicineName(id, name) {
  const c = state.containers.find(x => x.id === id);
  if (c) c.name = name;
}

function updateDosage(id, value) {
  const c = state.containers.find(x => x.id === id);
  if (c) c.dosage = Math.min(5, Math.max(1, Number(value)));
}

function getContainerConfigurationFromCard(containerId) {
  const nameInput = document.getElementById(`medicine-name-${containerId}`);
  const dosageInput = document.getElementById(`dosage-${containerId}`);
  const morningInput = document.getElementById(`schedule-${containerId}-morning`);
  const lunchInput = document.getElementById(`schedule-${containerId}-lunch`);
  const nightInput = document.getElementById(`schedule-${containerId}-night`);
  const name = nameInput ? nameInput.value.trim() : '';
  const dosage = dosageInput ? Number(dosageInput.value) : NaN;

  if (!name) {
    showToast('Medicine Name Required', `Enter a medicine name for Container ${containerId}.`, 'warning');
    nameInput?.focus();
    return null;
  }
  if (!Number.isInteger(dosage) || dosage < 1 || dosage > 5) {
    showToast('Invalid Dosage', 'Dosage must be a whole number from 1 to 5 tablets.', 'warning');
    dosageInput?.focus();
    return null;
  }

  return {
    name,
    dosage,
    morning: Boolean(morningInput?.checked),
    lunch: Boolean(lunchInput?.checked),
    night: Boolean(nightInput?.checked)
  };
}

function saveContainerConfiguration(containerId) {
  const container = state.containers.find(item => item.id === containerId);
  const configuration = getContainerConfigurationFromCard(containerId);
  if (!container || !configuration) return;

  Object.assign(container, configuration);
  writeFirebase(`configurations/containers/c${containerId}`, configuration);
  renderContainers();
  showToast('Configuration Saved', `Container ${containerId} settings were synchronized.`, 'info');
}

function clearContainerConfiguration(containerId) {
  const container = state.containers.find(item => item.id === containerId);
  if (!container) return;

  Object.assign(container, {
    name: '',
    dosage: 1,
    morning: false,
    lunch: false,
    night: false
  });
  writeFirebase(`configurations/containers/c${containerId}`, {
    name: '',
    dosage: 1,
    morning: false,
    lunch: false,
    night: false
  });
  renderContainers();
  showToast('Configuration Cleared', `Container ${containerId} is ready for new settings.`, 'info');
}

function toggleTimeSlot(id, slot, checked) {
  const c = state.containers.find(x => x.id === id);
  if (c) c[slot] = checked;
}

function addDispenseHistory(type, item, status) {
  const entry = {
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    type,
    item,
    timeSlot: getCurrentTimeSlot(),
    status
  };
  state.history.unshift(entry);
  saveHistory();
  renderHistoryTable();
  syncHistoryEntry(entry);
}

function setLiquidCalibration(value, render = true) {
  const calibration = Math.min(800, Math.max(100, Number(value)));
  state.liquid.calib_ms = calibration;
  localStorage.setItem('liquid_calib_ms', String(calibration));
  if (render) renderLiquidModule();
  const valueLabel = document.getElementById('calibration-value');
  if (valueLabel) valueLabel.textContent = `${calibration} ms/ml`;
}

function getLiquidConfigurationFromCard() {
  const doseInput = document.getElementById('liquid-dose-input');
  const calibrationSlider = document.getElementById('calibration-slider');
  const morningInput = document.getElementById('liquid-schedule-morning');
  const lunchInput = document.getElementById('liquid-schedule-lunch');
  const nightInput = document.getElementById('liquid-schedule-night');
  const doseMl = doseInput && doseInput.value.trim() !== ''
    ? Number(doseInput.value)
    : NaN;
  const calibMs = calibrationSlider ? Number(calibrationSlider.value) : NaN;

  if (!Number.isInteger(doseMl) || doseMl < 1 || doseMl > 100) {
    showToast('Invalid Liquid Dosage', 'Enter a whole-number dosage from 1 ml to 100 ml.', 'warning');
    doseInput?.focus();
    return null;
  }
  if (!Number.isInteger(calibMs) || calibMs < 100 || calibMs > 800) {
    showToast('Invalid Pump Calibration', 'Calibration must be a whole number from 100 to 800 ms/ml.', 'warning');
    calibrationSlider?.focus();
    return null;
  }

  return {
    doseMl,
    calib_ms: calibMs,
    morning: Boolean(morningInput?.checked),
    lunch: Boolean(lunchInput?.checked),
    night: Boolean(nightInput?.checked)
  };
}

function saveLiquidConfiguration() {
  const configuration = getLiquidConfigurationFromCard();
  if (!configuration) return;

  Object.assign(state.liquid, configuration);
  localStorage.setItem('liquid_calib_ms', String(configuration.calib_ms));
  writeFirebase('configurations/liquid', configuration);
  renderLiquidModule();
  showToast('Liquid Configuration Saved', 'Dosage, calibration, and schedule were synchronized.', 'info');
}

function clearLiquidConfiguration() {
  const configuration = {
    doseMl: null,
    calib_ms: 300,
    morning: false,
    lunch: false,
    night: false
  };
  Object.assign(state.liquid, configuration);
  localStorage.setItem('liquid_calib_ms', String(configuration.calib_ms));
  writeFirebase('configurations/liquid', configuration);
  renderLiquidModule();
  showToast('Liquid Configuration Cleared', 'Dosage and schedule settings were reset.', 'info');
}

function updateTelemetryUI() {
  const badge = document.getElementById('esp32-status-badge');
  const label = document.getElementById('esp32-status-label');
  const liquidMl = document.getElementById('telemetry-liquid-ml');
  const liquidBar = document.getElementById('telemetry-liquid-bar');
  const liquidPercent = document.getElementById('telemetry-liquid-percent');
  const irStatus = document.getElementById('telemetry-ir-status');
  const rssi = document.getElementById('telemetry-rssi');
  const lastSeen = document.getElementById('telemetry-last-seen');
  if (!badge || !label) return;

  badge.classList.toggle('connected', state.telemetry.online);
  badge.classList.toggle('offline', !state.telemetry.online);
  label.textContent = state.telemetry.online ? 'Dispenser Online' : 'Dispenser Offline';
  if (state.telemetry.liquidMl !== null) {
    const percent = Math.min(100, Math.max(0, Math.round((state.telemetry.liquidMl / state.liquid.maxVolumeMl) * 100)));
    liquidMl.textContent = `${state.telemetry.liquidMl} ml`;
    liquidBar.style.width = `${percent}%`;
    liquidPercent.textContent = `${percent}% of calibrated 200 ml capacity`;
  } else {
    liquidMl.textContent = '-- ml';
    liquidBar.style.width = '0%';
    liquidPercent.textContent = 'Waiting for sensor data';
  }
  irStatus.textContent = state.telemetry.online
    ? (state.telemetry.irPillDetected ? 'Beam Cut' : 'Active')
    : 'Idle';
  irStatus.className = `badge ${state.telemetry.irPillDetected ? 'badge-warning' : state.telemetry.online ? 'badge-success' : 'badge-muted'}`;
  rssi.textContent = state.telemetry.rssi === null ? '-- dBm' : `${state.telemetry.rssi} dBm`;
  lastSeen.textContent = state.telemetry.lastSeen
    ? `Last seen ${state.telemetry.lastSeen.toLocaleTimeString()}`
    : 'Device not yet polled';
}

async function pollEsp32Status() {
  const ip = state.wifiConfig.ip.trim();
  if (!ip) return;
  try {
    const response = await fetch(`http://${ip}/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Status request failed (${response.status}).`);
    const status = await response.json();
    state.telemetry.online = true;
    state.telemetry.liquidMl = Number.isFinite(Number(status.liquid_ml)) ? Number(status.liquid_ml) : null;
    state.telemetry.irPillDetected = status.ir_pill_detected === true;
    state.telemetry.rssi = Number.isFinite(Number(status.wifi_rssi)) ? Number(status.wifi_rssi) : null;
    state.telemetry.lastSeen = new Date();
  } catch (error) {
    state.telemetry.online = false;
    state.telemetry.liquidMl = null;
    state.telemetry.rssi = null;
  }
  updateTelemetryUI();
  if (document.getElementById('liquid-card-content')) renderLiquidModule();
}

function startStatusPolling() {
  pollEsp32Status();
  window.setInterval(pollEsp32Status, 3000);
}

function initFirebaseConfigUI() {
  const config = state.firebase;
  const apiKey = document.getElementById('firebase-api-key');
  const databaseURL = document.getElementById('firebase-database-url');
  const projectId = document.getElementById('firebase-project-id');
  const toggle = document.getElementById('cloud-sync-toggle');
  if (apiKey) apiKey.value = config.apiKey;
  if (databaseURL) databaseURL.value = config.databaseURL;
  if (projectId) projectId.value = config.projectId;
  if (toggle) toggle.checked = config.cloudSync;
  updateSyncModeLabel();
  if (config.cloudSync) initializeFirebase();
}

function saveFirebaseConfig() {
  state.firebase.apiKey = document.getElementById('firebase-api-key').value.trim();
  state.firebase.databaseURL = document.getElementById('firebase-database-url').value.trim();
  state.firebase.projectId = document.getElementById('firebase-project-id').value.trim();
  localStorage.setItem('firebase_config', JSON.stringify(state.firebase));
  if (state.firebase.cloudSync) initializeFirebase();
  showToast('Firebase Settings Saved', 'Configuration is ready for optional Realtime Database sync.', 'info');
}

function updateSyncModeLabel() {
  const label = document.getElementById('sync-mode-label');
  if (label) label.textContent = state.firebase.cloudSync ? 'Cloud Sync' : 'Local Dispenser';
}

function toggleCloudSync(enabled) {
  state.firebase.cloudSync = enabled;
  localStorage.setItem('firebase_config', JSON.stringify(state.firebase));
  updateSyncModeLabel();
  if (enabled && (!state.firebase.apiKey || !state.firebase.databaseURL || !state.firebase.projectId)) {
    showToast('Cloud Setup Incomplete', 'Enter all cloud project details before enabling cloud sync.', 'warning');
    document.getElementById('cloud-sync-toggle').checked = false;
    state.firebase.cloudSync = false;
    localStorage.setItem('firebase_config', JSON.stringify(state.firebase));
    updateSyncModeLabel();
    return;
  }
  initializeFirebase();
}

function initializeFirebase() {
  if (!state.firebase.cloudSync || !window.firebase || !state.firebase.databaseURL) return;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(state.firebase);
    }
    firebaseDb = firebase.database();
    attachFirebaseListeners();
    showToast('Cloud Sync Ready', 'Live telemetry and history synchronization are active.', 'info');
  } catch (error) {
    firebaseDb = null;
    showToast('Cloud Sync Unavailable', 'The dashboard will continue using direct dispenser mode.', 'danger');
  }
}

function firebaseSyncEnabled() {
  return Boolean(state.firebase.cloudSync && firebaseDb);
}

function getFirebaseTimestamp() {
  return window.firebase && firebaseDb
    ? firebase.database.ServerValue.TIMESTAMP
    : Date.now();
}

function writeFirebase(path, value) {
  if (!firebaseSyncEnabled()) return;
  firebaseDb.ref(path).set(value).catch(error => {
    console.warn(`[Firebase] Could not write ${path}:`, error);
  });
}

function syncInventoryStock(containerId, stock) {
  writeFirebase(`inventory/c${containerId}_stock`, stock);
}

function syncLiquidVolume(volumeMl) {
  writeFirebase('inventory/liquid_ml', volumeMl);
}

function syncHistoryEntry(entry) {
  if (!firebaseSyncEnabled()) return;
  firebaseDb.ref('history').push(entry).catch(error => {
    console.warn('[Firebase] Could not append history:', error);
  });
}

function syncDispenseTrigger(command) {
  // The browser also sends a direct ESP32 HTTP command. Mark this cloud audit
  // record so the firmware does not execute the same request a second time.
  writeFirebase('dispense_trigger', { ...command, source: 'web_http' });
}

function attachFirebaseListeners() {
  if (!firebaseSyncEnabled() || firebaseListenersAttached) return;
  firebaseListenersAttached = true;

  firebaseDb.ref('patient_profile').on('value', snapshot => {
    const profile = snapshot.val();
    if (!profile || typeof profile !== 'object') return;
    state.patientProfile = profile;
    state.currentUser = { ...state.currentUser, ...profile };
    localStorage.setItem('patient_profile', JSON.stringify(profile));
    localStorage.setItem('dispenser_user', JSON.stringify(state.currentUser));
    const headerName = document.getElementById('header-user-name');
    if (headerName) headerName.textContent = profile.name || 'Patient';
    renderPatientOverview();
  }, error => {
    console.warn('[Firebase] Patient profile listener failed:', error);
  });

  firebaseDb.ref('inventory').on('value', snapshot => {
    const inventory = snapshot.val() || {};
    state.containers.forEach(container => {
      const remoteStock = Number(inventory[`c${container.id}_stock`]);
      if (Number.isInteger(remoteStock) && remoteStock >= 0 && remoteStock <= container.maxStock) {
        container.stock = remoteStock;
      }
    });
    const remoteLiquid = Number(inventory.liquid_ml);
    if (Number.isFinite(remoteLiquid) && remoteLiquid >= 0) {
      state.liquid.volumeMl = remoteLiquid;
      state.liquid.level = Math.min(100, Math.max(0, Math.round((remoteLiquid / state.liquid.maxVolumeMl) * 100)));
    }
    renderContainers();
    if (document.getElementById('liquid-card-content')) renderLiquidModule();
  }, error => {
    console.warn('[Firebase] Inventory listener failed:', error);
  });

  firebaseDb.ref('device_status').on('value', snapshot => {
    const status = snapshot.val() || {};
    if (typeof status.online === 'boolean') state.telemetry.online = status.online;
    if (Number.isFinite(Number(status.wifi_rssi))) state.telemetry.rssi = Number(status.wifi_rssi);
    if (typeof status.ir_pill_detected === 'boolean') state.telemetry.irPillDetected = status.ir_pill_detected;
    if (Number.isFinite(Number(status.liquid_ml))) state.telemetry.liquidMl = Number(status.liquid_ml);
    state.telemetry.lastSeen = new Date();
    updateTelemetryUI();
  }, error => {
    console.warn('[Firebase] Device status listener failed:', error);
  });

  firebaseDb.ref('configurations/liquid').on('value', snapshot => {
    const configuration = snapshot.val();
    if (!configuration || typeof configuration !== 'object') return;

    const doseMl = Number(configuration.doseMl);
    const calibMs = Number(configuration.calib_ms);
    if (configuration.doseMl === null) {
      state.liquid.doseMl = null;
    } else if (Number.isInteger(doseMl) && doseMl >= 1 && doseMl <= 100) {
      state.liquid.doseMl = doseMl;
    }
    if (Number.isInteger(calibMs) && calibMs >= 100 && calibMs <= 800) {
      state.liquid.calib_ms = calibMs;
      localStorage.setItem('liquid_calib_ms', String(calibMs));
    }
    ['morning', 'lunch', 'night'].forEach(slot => {
      if (typeof configuration[slot] === 'boolean') {
        state.liquid[slot] = configuration[slot];
      }
    });
    if (document.getElementById('liquid-card-content')) renderLiquidModule();
  }, error => {
    console.warn('[Firebase] Liquid configuration listener failed:', error);
  });
}

function getCurrentTimeSlot() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 11) return 'Morning (8 AM)';
  if (hr >= 11 && hr < 17) return 'Lunch (12 PM)';
  return 'Night (8 PM)';
}

// Mobile Push Notification helper (with Web Notifications API fallback)
function sendMobilePushNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/3063/3063823.png' });
  }
}

// Request Notification Permission
function requestNotificationAccess() {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showToast('Push Enabled', 'Mobile App Push Notifications active.', 'info');
      }
    });
  }
}

// Render History Log Table
function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  if (state.history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No history records available yet.</td></tr>`;
    renderAdherenceWidget();
    return;
  }

  tbody.innerHTML = state.history.map(item => `
    <tr>
      <td><span style="font-family: monospace; font-size: 0.85rem;">${item.timestamp}</span></td>
      <td>
        <span class="badge ${item.type === 'Tablet' ? 'badge-success' : item.type === 'Liquid' ? 'badge-warning' : 'badge-danger'}">
          ${item.type}
        </span>
      </td>
      <td><strong>${item.item}</strong></td>
      <td>${item.timeSlot}</td>
      <td>
        <span class="badge ${
          item.type === 'System Diagnostic Test'
            ? 'badge-diagnostic'
            : item.type === 'Refill'
              ? 'badge-muted'
              : 'badge-success'
        }">
          ${
            item.type === 'System Diagnostic Test'
              ? 'Diagnostic Check'
              : item.type === 'Refill'
                ? 'Refill Recorded'
                : item.type === 'Tablet' || item.type === 'Liquid'
                  ? 'Taken'
                  : 'Recorded'
          }
        </span>
      </td>
      <td>${getDispenserLabel(item)}</td>
    </tr>
  `).join('');
  renderAdherenceWidget();
}

function saveHistory() {
  localStorage.setItem('dispenser_history', JSON.stringify(state.history));
}

function exportHistoryCSV() {
  const patientRecords = state.history.filter(row =>
    row.type === 'Tablet' || row.type === 'Liquid'
  );
  let csv = 'Date,Time,Medicine Name,Type,Time Slot,Status\n';
  patientRecords.forEach(row => {
    const [date = '', time = ''] = String(row.timestamp || '').split(' ');
    csv += [
      date,
      time,
      row.item,
      row.type,
      row.timeSlot,
      'Taken'
    ].map(csvEscape).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', `iot_dispenser_history_${Date.now()}.csv`);
  a.click();
  window.URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function getDispenserLabel(item) {
  if (item.type === 'Liquid' || item.item.includes('Liquid Pump')) return 'Liquid Pump';
  const containerMatch = String(item.item).match(/Container\s+(\d+)/i);
  if (containerMatch) return `Container ${containerMatch[1]}`;
  if (item.type === 'Refill' && item.item.includes('Liquid')) return 'Liquid Pump';
  return 'Medi Tracker';
}

function renderAdherenceWidget() {
  const takenPercentElement = document.getElementById('adherence-taken-percent');
  const takenLabelElement = document.getElementById('adherence-taken-label');
  const missedPercentElement = document.getElementById('adherence-missed-percent');
  const missedLabelElement = document.getElementById('adherence-missed-label');
  const takenRing = document.getElementById('adherence-taken-ring');
  const missedRing = document.getElementById('adherence-missed-ring');
  if (!takenPercentElement || !takenLabelElement || !missedPercentElement || !missedLabelElement) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysElapsed = now.getDate();
  const hasSchedule = state.containers.some(container =>
    container.morning || container.lunch || container.night
  ) || state.liquid.morning || state.liquid.lunch || state.liquid.night;
  const scheduledDays = hasSchedule ? daysElapsed : 0;
  const takenDates = new Set(
    state.history
      .filter(row => row.type === 'Tablet' || row.type === 'Liquid')
      .map(row => String(row.timestamp || '').slice(0, 10))
      .filter(date => {
        const parsed = new Date(`${date}T00:00:00`);
        return parsed.getFullYear() === year && parsed.getMonth() === month;
      })
  );
  const completedDays = Math.min(scheduledDays, takenDates.size);
  const missedDays = Math.max(0, scheduledDays - completedDays);
  const takenPercent = scheduledDays ? Math.round((completedDays / scheduledDays) * 100) : 0;
  const missedPercent = scheduledDays ? Math.round((missedDays / scheduledDays) * 100) : 0;

  takenPercentElement.textContent = `${takenPercent}%`;
  takenLabelElement.textContent = `${completedDays} / ${scheduledDays} Days Completed`;
  missedPercentElement.textContent = `${missedPercent}%`;
  missedLabelElement.textContent = `${missedDays} ${missedDays === 1 ? 'Day' : 'Days'} Missed`;

  updateAdherenceRing(takenRing, takenPercent);
  updateAdherenceRing(missedRing, missedPercent);
}

function updateAdherenceRing(ring, percent) {
  if (!ring) return;
  const radius = Number(ring.getAttribute('r'));
  const circumference = 2 * Math.PI * radius;
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference}`;
  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = `${circumference * (1 - percent / 100)}`;
  });
}

// Toast Notification Manager
function showToast(title, message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${message}</div>
    </div>
    <i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="this.parentElement.remove()"></i>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4500);
}

function checkAutomatedSchedules() {
  const now = new Date();
  const hours = now.getHours();
  const mins = now.getMinutes();

  // Morning trigger (8:00 AM)
  if (hours === 8 && mins === 0) {
    triggerScheduledDispense('morning');
  }
  // Lunch trigger (12:00 PM)
  else if (hours === 12 && mins === 0) {
    triggerScheduledDispense('lunch');
  }
  // Night trigger (8:00 PM / 20:00)
  else if (hours === 20 && mins === 0) {
    triggerScheduledDispense('night');
  }
}

function triggerScheduledDispense(slot) {
  showToast('Scheduled Dose Time', `Preparing your ${slot.toUpperCase()} medicines...`, 'info');
  state.containers.filter(c => c[slot]).forEach(c => {
    dispenseTablet(c.id, c.dosage);
  });
  if (state.liquid[slot]) {
    dispenseLiquid();
  }
}

function updateEsp32Ip(ip) {
  state.wifiConfig.ip = ip.trim();
  localStorage.setItem('esp32_ip', ip.trim());
  const currentIp = document.getElementById('esp32-current-ip');
  if (currentIp) currentIp.textContent = ip.trim();
  showToast('Dispenser Address Updated', 'The dashboard will connect to the configured dispenser.', 'info');
  pollEsp32Status();
}

const esp32IpInput = document.getElementById('esp32-ip-input');
if (esp32IpInput) esp32IpInput.value = state.wifiConfig.ip;

// Export functions to global scope
window.handleLogin = handleLogin;
window.doLogin = doLogin;
window.handleSignup = handleSignup;
window.handleLogout = handleLogout;
window.showAuthView = showAuthView;
window.switchTab = switchTab;
window.dispenseTablet = dispenseTablet;
window.dispenseLiquid = dispenseLiquid;
window.testDispenseTablet = testDispenseTablet;
window.testDispenseLiquid = testDispenseLiquid;
window.refillLiquidBottle = refillLiquidBottle;
window.refillContainer = refillContainer;
window.selectRefillQuantity = selectRefillQuantity;
window.confirmRefill = confirmRefill;
window.closeRefillModal = closeRefillModal;
window.refillLiquid = refillLiquid;
window.updateMedicineName = updateMedicineName;
window.toggleTimeSlot = toggleTimeSlot;
window.exportHistoryCSV = exportHistoryCSV;
window.requestNotificationAccess = requestNotificationAccess;
window.updateEsp32Ip = updateEsp32Ip;
window.updateDosage = updateDosage;
window.saveContainerConfiguration = saveContainerConfiguration;
window.clearContainerConfiguration = clearContainerConfiguration;
window.saveLiquidConfiguration = saveLiquidConfiguration;
window.clearLiquidConfiguration = clearLiquidConfiguration;
window.setLiquidCalibration = setLiquidCalibration;
window.saveFirebaseConfig = saveFirebaseConfig;
window.toggleCloudSync = toggleCloudSync;
