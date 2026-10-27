/*
  ================================================================================
  MEDI TRACKER - ESP32 STANDALONE FIRMWARE
  Final Year Project Code

  Hotspot Fallback:
    SSID: ESP32_Medicine_Dispenser
    PASSWORD: 12345678
    Access App at: http://192.168.4.1
  ================================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <time.h>
#include <Preferences.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// Forward Declarations for C++ Compiler
void handleRoot();
void handleDispenseTablet();
void handleDispenseLiquid();
void handleRefillLiquid();
void handleRefillTablet();
void handleStatus();
void handleWifiConfig();
void handleNotFound();
void dispenseTabletHardware(int id, int count, int &dispensedCount);
void dispenseLiquidHardware(int doseMl, int calibMs);
void triggerBuzzerAlert(int count);
void checkTimeSchedules();
int readUltrasonicLiquidMl();
float readUltrasonicDistanceCm();
bool waitForPillDrop(unsigned long timeoutMs);
Servo *getContainerServo(int id);
void showDisplay(const char *title, const String &detail);
uint8_t findOledAddress();
void setPumpRelay(bool enabled);
void loadWifiCredentials();
void saveWifiCredentials(const String &newSsid, const String &newPassword);
bool connectToConfiguredWifi();
void startFallbackAccessPoint();
void sendJson(int statusCode, const String &body);
void initializeFirebaseBridge();
void pollFirebaseTrigger();
void pollFirebaseConfiguration();
void loadFirebaseInventory();
void publishFirebaseStatus();
void syncFirebaseInventory();
void syncFirebaseHistory(const String &type, const String &item, const String &status);
void processCloudDispense(const String &payload);
bool firebaseRequest(const char *method, const String &path, const String &payload, String *responseBody);
String extractJsonString(const String &json, const String &key);
long extractJsonLong(const String &json, const String &key, long fallback);
bool extractJsonBool(const String &json, const String &key, bool fallback);
String jsonEscape(const String &value);

// Wi-Fi credentials are provisioned through Firebase or /wifi-config and stored in NVS.
Preferences wifiPreferences;
String configuredWifiSsid;
String configuredWifiPassword;

// Hardware Pin Definitions
#define SERVO_1_PIN 13
#define SERVO_2_PIN 12
#define SERVO_3_PIN 14
#define SERVO_4_PIN 27
#define PUMP_RELAY_PIN 26
#define PUMP_RELAY_ACTIVE_LOW true
#define BUZZER_PIN 25
#define LED_WIFI_PIN 2

// Sensor Pins
#define US_TRIG_PIN 5  // Ultrasonic Liquid Level Sensor Trig
#define US_ECHO_PIN 18 // Ultrasonic Liquid Level Sensor Echo
#define IR_PILL_PIN 19 // IR Sensor for Tablet Drop Detection

// Servo Objects
Servo servo1;
Servo servo2;
Servo servo3;
Servo servo4;

// Web Server on port 80
WebServer server(80);
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool displayReady = false;

// NTP Time Client Settings
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // GMT+5:30 (India Standard Time)
const int daylightOffset_sec = 0;

// Container Stock Tracking
int stock[4] = {0};
int liquidLevelMl = 0;
int liquidCapacityMl = 0;
int containerDosage[4] = {0};
bool containerMorning[4] = {false};
bool containerLunch[4] = {false};
bool containerNight[4] = {false};
const int MAX_CONTAINER_PILLS = 30;
bool liquidMorning = false;
bool liquidLunch = false;
bool liquidNight = false;
const int MAX_LIQUID_ML = 500;
const float EMPTY_REFERENCE_DISTANCE_CM = 15.0f;
float fullReferenceDistanceCm = 3.0f;
const int IR_DROP_TIMEOUT_MS = 1500;
const int ULTRASONIC_SAMPLE_COUNT = 5;

// Firebase Realtime Database REST bridge. The database rules must permit the
// device to read dispense_trigger and write inventory/device_status/history.
const char *firebaseDatabaseUrl = "https://meditracker-system-default-rtdb.firebaseio.com";
const char *firebaseDevicePath = "/devices/esp32_device_01";
bool firebaseReady = false;
bool firebaseInventoryLoaded = false;
unsigned long lastFirebaseTriggerPoll = 0;
unsigned long lastFirebaseStatusPublish = 0;
unsigned long lastFirebaseConfigurationPoll = 0;
String lastProcessedTriggerSignature;
const unsigned long FIREBASE_TRIGGER_POLL_MS = 1500;
const unsigned long FIREBASE_STATUS_PUBLISH_MS = 5000;
const unsigned long FIREBASE_CONFIGURATION_POLL_MS = 10000;
int configuredLiquidDoseMl = 0;
int configuredLiquidCalibMs = 0;

// Embedded Mobile Application HTML UI
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Medi Tracker</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --primary: #10b981; --accent: #3b82f6; --text: #f8fafc; --muted: #94a3b8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding-bottom: 2rem; }
    header { background: rgba(15,23,42,0.9); padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top:0; z-index:100; }
    .brand { display: flex; align-items: center; gap: 0.5rem; font-family: 'Outfit'; font-size: 1.2rem; font-weight: 700; color: var(--primary); }
    .container { max-width: 600px; margin: 1.5rem auto; padding: 0 1rem; }
    .card { background: var(--card); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.2rem; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .btn { width: 100%; padding: 0.8rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; background: var(--primary); color: white; margin-top: 0.8rem; font-size: 0.95rem; }
    .btn-accent { background: var(--accent); }
    .btn-sec { background: rgba(255,255,255,0.1); color: white; }
    .input { width: 100%; padding: 0.75rem; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white; margin-top: 0.4rem; outline: none; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .tabs { display: flex; gap: 0.5rem; background: #1e293b; padding: 0.4rem; border-radius: 12px; margin-bottom: 1.5rem; }
    .tab { flex: 1; padding: 0.6rem; text-align: center; border: none; background: transparent; color: var(--muted); font-weight: 600; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
    .tab.active { background: var(--primary); color: white; }
    .badge { padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; background: rgba(16,185,129,0.2); color: #34d399; }
    .toast { position: fixed; bottom: 1.5rem; right: 1.5rem; left: 1.5rem; max-width: 400px; margin: 0 auto; background: #1e293b; border-left: 4px solid var(--primary); padding: 1rem; border-radius: 8px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); display: none; z-index: 1000; }
  </style>
</head>
<body>

  <header>
    <div class="brand"><i class="fa-solid fa-capsules"></i> Medi Tracker</div>
    <span class="badge"><i class="fa-solid fa-wifi"></i> ESP32 Online</span>
  </header>

  <div class="container">
    
    <!-- LOGIN SCREEN -->
    <div id="view-login" class="card">
      <h2 id="auth-title" style="font-family:'Outfit'; text-align:center; margin-bottom: 0.5rem;">Patient Login</h2>
      <p id="auth-subtitle" style="color:var(--muted); text-align:center; font-size:0.85rem; margin-bottom:1.5rem;">Sign in to Medi Tracker</p>

      <div id="login-form">
        <div style="margin-bottom: 1rem;">
          <label for="login-phone" style="font-size:0.85rem; color:var(--muted);">Mobile Number</label>
          <input type="tel" id="login-phone" class="input" placeholder="Mobile Number" autocomplete="tel">
        </div>
        <div style="margin-bottom: 1rem;">
          <label for="login-password" style="font-size:0.85rem; color:var(--muted);">Password</label>
          <input type="password" id="login-password" class="input" placeholder="Password" autocomplete="current-password">
        </div>
        <button class="btn" onclick="doLogin()">Login</button>
        <button class="btn btn-sec" onclick="toggleAuthMode('signup')">Create Account</button>
      </div>

      <div id="signup-form" style="display:none;">
        <div style="margin-bottom: 1rem;">
          <label for="signup-name" style="font-size:0.85rem; color:var(--muted);">Name</label>
          <input type="text" id="signup-name" class="input" placeholder="Your name" autocomplete="name">
        </div>
        <div style="margin-bottom: 1rem;">
          <label for="signup-phone" style="font-size:0.85rem; color:var(--muted);">Mobile Number</label>
          <input type="tel" id="signup-phone" class="input" placeholder="Mobile Number" autocomplete="tel">
        </div>
        <div style="margin-bottom: 1rem;">
          <label for="signup-password" style="font-size:0.85rem; color:var(--muted);">Create Password</label>
          <input type="password" id="signup-password" class="input" placeholder="At least 6 characters" autocomplete="new-password">
        </div>
        <button class="btn" onclick="createAccount()">Sign Up</button>
        <button class="btn btn-sec" onclick="toggleAuthMode('login')">Back to Login</button>
      </div>
    </div>

    <!-- MAIN APP SCREEN -->
    <div id="view-app" style="display:none;">
      
      <div class="tabs">
        <button class="tab active" onclick="switchTab('containers')">4 Containers</button>
        <button class="tab" onclick="switchTab('liquid')">Liquid Medicine</button>
        <button class="tab" onclick="switchTab('history')">History Log</button>
      </div>

      <!-- TAB 1: CONTAINERS -->
      <div id="tab-containers">
        <div class="grid">
          
          <div class="card">
            <h3>Container 1</h3>
            <input type="text" class="input" value="" placeholder="Medicine name from Firebase" style="font-size:0.8rem;">
            <div style="font-size:0.8rem; margin: 0.5rem 0; color:var(--muted);">Stock: <strong id="stock-1">--</strong></div>
            <button class="btn" onclick="dispensePill(1)">Dispense Now</button>
          </div>

          <div class="card">
            <h3>Container 2</h3>
            <input type="text" class="input" value="" placeholder="Medicine name from Firebase" style="font-size:0.8rem;">
            <div style="font-size:0.8rem; margin: 0.5rem 0; color:var(--muted);">Stock: <strong id="stock-2">--</strong></div>
            <button class="btn" onclick="dispensePill(2)">Dispense Now</button>
          </div>

          <div class="card">
            <h3>Container 3</h3>
            <input type="text" class="input" value="" placeholder="Medicine name from Firebase" style="font-size:0.8rem;">
            <div style="font-size:0.8rem; margin: 0.5rem 0; color:var(--muted);">Stock: <strong id="stock-3">--</strong></div>
            <button class="btn" onclick="dispensePill(3)">Dispense Now</button>
          </div>

          <div class="card">
            <h3>Container 4</h3>
            <input type="text" class="input" value="" placeholder="Medicine name from Firebase" style="font-size:0.8rem;">
            <div style="font-size:0.8rem; margin: 0.5rem 0; color:var(--muted);">Stock: <strong id="stock-4">--</strong></div>
            <button class="btn" onclick="dispensePill(4)">Dispense Now</button>
          </div>

        </div>
      </div>

      <!-- TAB 2: LIQUID -->
      <div id="tab-liquid" style="display:none;">
        <div class="card">
          <h3><i class="fa-solid fa-bottle-droplet" style="color:#60a5fa;"></i> Liquid Medicine Dispenser</h3>
          <input type="text" class="input" value="" placeholder="Liquid medicine name from Firebase">
          <div style="margin: 1rem 0; font-size:0.9rem;">
            Dosage: <strong>-- ml</strong>
          </div>
          <button class="btn btn-accent" onclick="pourLiquid()">Pour Liquid</button>
        </div>
      </div>

      <!-- TAB 3: HISTORY -->
      <div id="tab-history" style="display:none;">
        <div class="card">
          <h3><i class="fa-solid fa-list-check"></i> Dispensing Log</h3>
          <div id="history-log" style="font-size:0.8rem; margin-top: 1rem; color:var(--muted);">
            No actions logged yet.
          </div>
        </div>
      </div>

    </div>

  </div>

  <div id="toast" class="toast">
    <div id="toast-title" style="font-weight:700;"></div>
    <div id="toast-msg" style="font-size:0.85rem; color:var(--muted);"></div>
  </div>

  <script>
    let historyData = [];

    function toggleAuthMode(mode) {
      const signingUp = mode === 'signup';
      document.getElementById('login-form').style.display = signingUp ? 'none' : 'block';
      document.getElementById('signup-form').style.display = signingUp ? 'block' : 'none';
      document.getElementById('auth-title').innerText = signingUp ? 'Create Account' : 'Patient Login';
      document.getElementById('auth-subtitle').innerText = signingUp ? 'Create your Medi Tracker account' : 'Sign in to Medi Tracker';
    }

    function createAccount() {
      const name = document.getElementById('signup-name').value.trim();
      const phone = document.getElementById('signup-phone').value.trim();
      const password = document.getElementById('signup-password').value;

      if (!name || !phone || password.length < 6) {
        showToast('Check your details', 'Enter your name, mobile number, and a password of at least 6 characters.');
        return;
      }
      syncFirebaseInventory();

      localStorage.setItem('meditracker_account', JSON.stringify({ name, phone, password }));
      document.getElementById('login-phone').value = phone;
      document.getElementById('login-password').value = '';
      toggleAuthMode('login');
      showToast('Account Created', 'Log in with your mobile number and password.');
    }

    function doLogin() {
      let account;
      try {
        account = JSON.parse(localStorage.getItem('meditracker_account') || 'null');
      } catch (error) {
        account = null;
      }

      if (!account) {
        showToast('Create an account', 'Tap Create Account before logging in.');
        return;
      }

      const phone = document.getElementById('login-phone').value.trim();
      const password = document.getElementById('login-password').value;
      if (phone !== account.phone || password !== account.password) {
        showToast('Login failed', 'Check your mobile number and password.');
        return;
      }

      document.getElementById('view-login').style.display = 'none';
      document.getElementById('view-app').style.display = 'block';
      showToast('Logged In', 'Welcome to Medi Tracker, ' + account.name);
    }

    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');

      document.getElementById('tab-containers').style.display = (name === 'containers') ? 'block' : 'none';
      document.getElementById('tab-liquid').style.display = (name === 'liquid') ? 'block' : 'none';
      document.getElementById('tab-history').style.display = (name === 'history') ? 'block' : 'none';
    }

    function dispensePill(id) {
      const stockEl = document.getElementById('stock-' + id);
      let stock = parseInt(stockEl.innerText);
      if (stock > 0) stockEl.innerText = stock - 1;

      showToast('Tablet Dispensing', 'Triggered Container ' + id);
      addLog('Tablet', 'Container ' + id + ' Dispensed');

      fetch('/dispense?container=' + id + '&count=1')
        .then(r => r.json())
        .then(d => console.log('Dispense OK:', d))
        .catch(e => console.log('Fetch err:', e));
    }

    function pourLiquid() {
      showToast('Liquid Dispensing', 'Sending the configured liquid dose...');
      addLog('Liquid', 'Configured liquid dose requested');

      fetch('/dispense_liquid')
        .then(r => r.json())
        .then(d => console.log('Liquid OK:', d))
        .catch(e => console.log('Fetch err:', e));
    }

    function addLog(type, msg) {
      const time = new Date().toLocaleTimeString();
      historyData.unshift(time + ' - [' + type + '] ' + msg);
      document.getElementById('history-log').innerHTML = historyData.map(l => '<div>' + l + '</div>').join('');
    }

    function showToast(title, msg) {
      document.getElementById('toast-title').innerText = title;
      document.getElementById('toast-msg').innerText = msg;
      const t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }
  </script>
</body>
</html>
)rawliteral";

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG,
                 0); // Disable brownout detector for USB power stability
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("=============================================");
  Serial.println("  Medi Tracker Starting... ");
  Serial.println("=============================================");

  // Initialize Pins
  digitalWrite(PUMP_RELAY_PIN, PUMP_RELAY_ACTIVE_LOW ? HIGH : LOW);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_WIFI_PIN, OUTPUT);
  pinMode(US_TRIG_PIN, OUTPUT);
  pinMode(US_ECHO_PIN, INPUT);
  pinMode(IR_PILL_PIN, INPUT);

  Wire.begin(21, 22);
  uint8_t oledAddress = findOledAddress();
  if (oledAddress != 0) {
    displayReady = display.begin(SSD1306_SWITCHCAPVCC, oledAddress);
  }
  if (displayReady) {
    showDisplay("Medi Tracker", "Starting...");
  } else {
    Serial.println("OLED not found at I2C address 0x3C or 0x3D.");
  }

  setPumpRelay(false);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_WIFI_PIN, LOW);

  // Staggered Servo Motor Initialization (prevents USB power drop)
  servo1.setPeriodHertz(50);
  servo1.attach(SERVO_1_PIN, 500, 2400);
  servo1.write(0);
  delay(100);

  servo2.setPeriodHertz(50);
  servo2.attach(SERVO_2_PIN, 500, 2400);
  servo2.write(0);
  delay(100);

  servo3.setPeriodHertz(50);
  servo3.attach(SERVO_3_PIN, 500, 2400);
  servo3.write(0);
  delay(100);

  servo4.setPeriodHertz(50);
  servo4.attach(SERVO_4_PIN, 500, 2400);
  servo4.write(0);
  delay(100);

  // Connect to Wi-Fi
  loadWifiCredentials();
  showDisplay("Connecting...", "Please Wait");

  if (connectToConfiguredWifi()) {
    digitalWrite(LED_WIFI_PIN, HIGH);
    Serial.println("\n[Wi-Fi CONNECTED SUCCESS]");
    Serial.print("ESP32 Station IP Address: ");
    Serial.println(WiFi.localIP());
    showDisplay("Network Ready", "Dispenser Online");
  } else {
    startFallbackAccessPoint();
  }

  // Sync NTP Time
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  initializeFirebaseBridge();

  // Configure REST Web Server Endpoints
  server.enableCORS(true);
  server.on("/", handleRoot);
  server.on("/dispense", handleDispenseTablet);
  server.on("/dispense_liquid", handleDispenseLiquid);
  server.on("/refill_liquid", handleRefillLiquid);
  server.on("/refill_tablet", handleRefillTablet);
  server.on("/wifi-config", HTTP_POST, handleWifiConfig);
  server.on("/status", handleStatus);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("HTTP REST Web Server Started on Port 80.");

  // Startup Sound Alert (2 short beeps)
  triggerBuzzerAlert(2);
}

void loop() {
  server.handleClient();
  pollFirebaseTrigger();
  pollFirebaseConfiguration();
  publishFirebaseStatus();

  // Periodic NTP Time Schedule Check for 8 AM, 12 PM, 8 PM
  checkTimeSchedules();
  delay(10);
}

void loadWifiCredentials() {
  wifiPreferences.begin("wifi", true);
  configuredWifiSsid = wifiPreferences.getString("ssid", "");
  configuredWifiPassword = wifiPreferences.getString("password", "");
  wifiPreferences.end();
  Serial.print("[Wi-Fi] Stored SSID: ");
  Serial.println(configuredWifiSsid.length() > 0 ? configuredWifiSsid : "Not configured");
}

void saveWifiCredentials(const String &newSsid, const String &newPassword) {
  configuredWifiSsid = newSsid;
  configuredWifiPassword = newPassword;
  wifiPreferences.begin("wifi", false);
  wifiPreferences.putString("ssid", configuredWifiSsid);
  wifiPreferences.putString("password", configuredWifiPassword);
  wifiPreferences.end();
}

bool connectToConfiguredWifi() {
  if (configuredWifiSsid.length() == 0 || configuredWifiPassword.length() == 0) return false;

  WiFi.mode(WIFI_AP_STA);
  WiFi.disconnect(true, true);
  delay(100);
  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(configuredWifiSsid);
  WiFi.begin(configuredWifiSsid.c_str(), configuredWifiPassword.c_str());

  for (int attempt = 0; attempt < 30 && WiFi.status() != WL_CONNECTED; attempt++) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_WIFI_PIN, !digitalRead(LED_WIFI_PIN));
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void startFallbackAccessPoint() {
  Serial.println("[Wi-Fi] Credentials unavailable or connection failed; starting setup AP.");
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("ESP32_Medicine_Dispenser", "12345678");
  Serial.print("ESP32 Hotspot IP Address: ");
  Serial.println(WiFi.softAPIP());
  showDisplay("Setup Mode", "Connect To Device");
  digitalWrite(LED_WIFI_PIN, HIGH);
}

void handleWifiConfig() {
  if (!server.hasArg("ssid") || !server.hasArg("password")) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_WIFI_CONFIG\"}");
    return;
  }

  String newSsid = server.arg("ssid");
  String newPassword = server.arg("password");
  newSsid.trim();
  if (newSsid.length() == 0 || newPassword.length() == 0 || newSsid.length() > 32 || newPassword.length() > 63) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_WIFI_CONFIG\"}");
    return;
  }

  saveWifiCredentials(newSsid, newPassword);
  sendJson(200, "{\"status\":\"SUCCESS\",\"message\":\"WIFI_CONFIG_SAVED\"}");
  delay(250);
  if (connectToConfiguredWifi()) {
    firebaseReady = false;
    initializeFirebaseBridge();
  } else {
    startFallbackAccessPoint();
  }
}

// REST Endpoint: Root (Serves Standalone Web Mobile App directly from ESP32!)
void handleRoot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (server.method() == HTTP_OPTIONS) {
    server.send(204, "application/json", "{}");
    return;
  }
  server.send(200, "text/html", INDEX_HTML);
}

void sendJson(int statusCode, const String &body) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  server.send(statusCode, "application/json", body);
}

String jsonEscape(const String &value) {
  String escaped;
  escaped.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); i++) {
    char character = value.charAt(i);
    if (character == '"' || character == '\\') escaped += '\\';
    if (character == '\n') {
      escaped += "\\n";
    } else if (character != '\r') {
      escaped += character;
    }
  }
  return escaped;
}

String extractJsonString(const String &json, const String &key) {
  String token = "\"" + key + "\"";
  int keyIndex = json.indexOf(token);
  if (keyIndex < 0) return "";
  int colonIndex = json.indexOf(':', keyIndex + token.length());
  int startQuote = json.indexOf('"', colonIndex + 1);
  if (colonIndex < 0 || startQuote < 0) return "";
  int endQuote = startQuote + 1;
  while (endQuote < json.length()) {
    if (json.charAt(endQuote) == '"' && json.charAt(endQuote - 1) != '\\') break;
    endQuote++;
  }
  if (endQuote >= json.length()) return "";
  return json.substring(startQuote + 1, endQuote);
}

long extractJsonLong(const String &json, const String &key, long fallback) {
  String token = "\"" + key + "\"";
  int keyIndex = json.indexOf(token);
  if (keyIndex < 0) return fallback;
  int colonIndex = json.indexOf(':', keyIndex + token.length());
  if (colonIndex < 0) return fallback;
  int valueStart = colonIndex + 1;
  while (valueStart < json.length() && (json.charAt(valueStart) == ' ' || json.charAt(valueStart) == '\t')) {
    valueStart++;
  }
  int valueEnd = valueStart;
  while (valueEnd < json.length() && (json.charAt(valueEnd) == '-' || isDigit(json.charAt(valueEnd)))) {
    valueEnd++;
  }
  if (valueEnd == valueStart) return fallback;
  return json.substring(valueStart, valueEnd).toInt();
}

bool extractJsonBool(const String &json, const String &key, bool fallback) {
  String token = "\"" + key + "\"";
  int keyIndex = json.indexOf(token);
  if (keyIndex < 0) return fallback;
  int colonIndex = json.indexOf(':', keyIndex + token.length());
  if (colonIndex < 0) return fallback;
  String value = json.substring(colonIndex + 1);
  value.trim();
  return value.startsWith("true") ? true : value.startsWith("false") ? false : fallback;
}

bool firebaseRequest(const char *method, const String &path, const String &payload, String *responseBody) {
  if (!firebaseReady || WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = String(firebaseDatabaseUrl) + String(firebaseDevicePath) + path + ".json";
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");

  int result = -1;
  if (strcmp(method, "GET") == 0) {
    result = http.GET();
  } else if (strcmp(method, "PUT") == 0) {
    result = http.PUT(payload);
  } else if (strcmp(method, "PATCH") == 0) {
    result = http.sendRequest("PATCH", payload);
  } else if (strcmp(method, "POST") == 0) {
    result = http.POST(payload);
  }

  if (responseBody) *responseBody = result > 0 ? http.getString() : "";
  http.end();
  return result >= 200 && result < 300;
}

void initializeFirebaseBridge() {
  firebaseReady = WiFi.status() == WL_CONNECTED;
  if (firebaseReady) {
    Serial.println("[FIREBASE] REST bridge ready.");
    String existingTrigger;
    if (firebaseRequest("GET", "/dispense_trigger", "", &existingTrigger)) {
      // Do not replay a command that was already present before this boot.
      lastProcessedTriggerSignature = existingTrigger;
    }
    loadFirebaseInventory();
    lastFirebaseConfigurationPoll = millis() - FIREBASE_CONFIGURATION_POLL_MS;
    pollFirebaseConfiguration();
    syncFirebaseInventory();
    publishFirebaseStatus();
  } else {
    Serial.println("[FIREBASE] Offline; direct ESP32 HTTP mode remains active.");
  }
}

void loadFirebaseInventory() {
  String payload;
  if (!firebaseRequest("GET", "/inventory", "", &payload)) return;

  bool foundValue = false;
  bool correctedStock = false;
  for (int index = 0; index < 4; index++) {
    long remoteStock = extractJsonLong(payload, "c" + String(index + 1) + "_stock", -1);
    if (remoteStock >= 0) {
      if (remoteStock > MAX_CONTAINER_PILLS) correctedStock = true;
      stock[index] = constrain((int)remoteStock, 0, MAX_CONTAINER_PILLS);
      foundValue = true;
    }
  }

  long remoteLiquid = extractJsonLong(payload, "liquid_ml", -1);
  if (remoteLiquid >= 0 && remoteLiquid <= MAX_LIQUID_ML) {
    liquidLevelMl = (int)remoteLiquid;
    foundValue = true;
  }
  long remoteCapacity = extractJsonLong(payload, "liquid_capacity_ml", -1);
  if (remoteCapacity >= 50 && remoteCapacity <= MAX_LIQUID_ML) {
    liquidCapacityMl = (int)remoteCapacity;
  }
  firebaseInventoryLoaded = foundValue;
  if (correctedStock) syncFirebaseInventory();
}

void syncFirebaseInventory() {
  if (!firebaseReady || !firebaseInventoryLoaded) return;
  for (int index = 0; index < 4; index++) {
    stock[index] = constrain(stock[index], 0, MAX_CONTAINER_PILLS);
  }
  firebaseRequest("PUT", "/inventory/c1_stock", String(stock[0]), NULL);
  firebaseRequest("PUT", "/inventory/c2_stock", String(stock[1]), NULL);
  firebaseRequest("PUT", "/inventory/c3_stock", String(stock[2]), NULL);
  firebaseRequest("PUT", "/inventory/c4_stock", String(stock[3]), NULL);
  firebaseRequest("PUT", "/inventory/liquid_ml", String(liquidLevelMl), NULL);
  if (liquidCapacityMl > 0) {
    firebaseRequest("PUT", "/inventory/liquid_capacity_ml", String(liquidCapacityMl), NULL);
  }
}

void publishFirebaseStatus() {
  if (!firebaseReady || millis() - lastFirebaseStatusPublish < FIREBASE_STATUS_PUBLISH_MS) return;
  lastFirebaseStatusPublish = millis();
  int liquidMl = readUltrasonicLiquidMl();
  String payload = "{";
  payload += "\"online\":true,";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"stock_c1\":" + String(stock[0]) + ",";
  payload += "\"stock_c2\":" + String(stock[1]) + ",";
  payload += "\"stock_c3\":" + String(stock[2]) + ",";
  payload += "\"stock_c4\":" + String(stock[3]) + ",";
  payload += "\"liquid_sensor_ml\":" + String(liquidMl) + ",";
  payload += "\"ir_pill_detected\":" + String(digitalRead(IR_PILL_PIN) == LOW ? "true" : "false");
  payload += "}";
  firebaseRequest("PUT", "/device_status", payload, NULL);
}

void syncFirebaseHistory(const String &type, const String &item, const String &status) {
  if (!firebaseReady) return;
  String payload = "{";
  payload += "\"timestamp\":" + String((unsigned long)millis()) + ",";
  payload += "\"type\":\"" + jsonEscape(type) + "\",";
  payload += "\"item\":\"" + jsonEscape(item) + "\",";
  payload += "\"timeSlot\":\"System Diagnostic\",";
  payload += "\"status\":\"" + jsonEscape(status) + "\"";
  payload += "}";
  firebaseRequest("POST", "/history", payload, NULL);
}

void processCloudDispense(const String &payload) {
  String source = extractJsonString(payload, "source");
  if (source == "web_http") return;

  String type = extractJsonString(payload, "type");
  long requestedAt = extractJsonLong(payload, "requestedAt", 0);
  String signature = payload;
  if (signature == lastProcessedTriggerSignature || type.length() == 0) return;
  if (payload.indexOf("\"handledBy\":\"esp32\"") >= 0) return;
  lastProcessedTriggerSignature = signature;

  bool diagnostic = type == "diagnostic_tablet" || type == "diagnostic_liquid";
  if (type == "tablet" || type == "diagnostic_tablet") {
    long requestedContainer = extractJsonLong(payload, "container", 0);
    long requestedCount = extractJsonLong(payload, "count", 1);
    if (requestedContainer < 1 || requestedContainer > 4 ||
        requestedCount < 1 || requestedCount > 5) return;
    int id = (int)requestedContainer;
    int count = (int)requestedCount;
    if (stock[id - 1] < count) return;
    int dispensed = 0;
    dispenseTabletHardware(id, count, dispensed);
    if (dispensed == count) {
      syncFirebaseInventory();
      syncFirebaseHistory(diagnostic ? "System Diagnostic Test" : "Tablet",
                          "Container " + String(id), diagnostic ? "Verified" : "Dispensed Successfully");
    }
  } else if (type == "liquid" || type == "diagnostic_liquid") {
    long requestedDose = extractJsonLong(payload, "dose", configuredLiquidDoseMl);
    long requestedCalibration = extractJsonLong(payload, "calib_ms", configuredLiquidCalibMs);
    if (requestedDose < 1 || requestedDose > 100 ||
        requestedCalibration < 100 || requestedCalibration > 800) return;
    int dose = (int)requestedDose;
    int calibration = (int)requestedCalibration;
    if (liquidLevelMl < dose) return;
    int sensorLiquidMl = readUltrasonicLiquidMl();
    if (liquidCapacityMl > 0 && sensorLiquidMl >= 0 && sensorLiquidMl < dose) return;
    dispenseLiquidHardware(dose, calibration);
    syncFirebaseInventory();
    syncFirebaseHistory(diagnostic ? "System Diagnostic Test" : "Liquid",
                        "Liquid Pump", diagnostic ? "Verified" : "Dispensed Successfully");
  }
}

void pollFirebaseConfiguration() {
  if (!firebaseReady || millis() - lastFirebaseConfigurationPoll < FIREBASE_CONFIGURATION_POLL_MS) return;
  lastFirebaseConfigurationPoll = millis();
  loadFirebaseInventory();

  String payload;
  String wifiPayload;
  if (firebaseRequest("GET", "/configurations/wifi", "", &wifiPayload)) {
    String cloudSsid = extractJsonString(wifiPayload, "ssid");
    String cloudPassword = extractJsonString(wifiPayload, "password");
    if (cloudSsid.length() > 0 && cloudPassword.length() > 0 &&
        (cloudSsid != configuredWifiSsid || cloudPassword != configuredWifiPassword)) {
      saveWifiCredentials(cloudSsid, cloudPassword);
      if (connectToConfiguredWifi()) {
        firebaseReady = true;
      } else {
        firebaseReady = false;
        startFallbackAccessPoint();
      }
    }
  }

  if (firebaseRequest("GET", "/configurations/liquid", "", &payload)) {
    long dose = extractJsonLong(payload, "doseMl", configuredLiquidDoseMl);
    long calibration = extractJsonLong(payload, "calib_ms", configuredLiquidCalibMs);
    if (dose >= 1 && dose <= 100) configuredLiquidDoseMl = (int)dose;
    if (calibration >= 100 && calibration <= 800) configuredLiquidCalibMs = (int)calibration;
    liquidMorning = extractJsonBool(payload, "morning", liquidMorning);
    liquidLunch = extractJsonBool(payload, "lunch", liquidLunch);
    liquidNight = extractJsonBool(payload, "night", liquidNight);
  }

  for (int index = 0; index < 4; index++) {
    String containerPayload;
    String path = "/configurations/containers/c" + String(index + 1);
    if (!firebaseRequest("GET", path, "", &containerPayload)) continue;
    long dosage = extractJsonLong(containerPayload, "dosage", containerDosage[index]);
    if (dosage >= 1 && dosage <= 5) containerDosage[index] = (int)dosage;
    containerMorning[index] = extractJsonBool(containerPayload, "morning", containerMorning[index]);
    containerLunch[index] = extractJsonBool(containerPayload, "lunch", containerLunch[index]);
    containerNight[index] = extractJsonBool(containerPayload, "night", containerNight[index]);
  }
}

void pollFirebaseTrigger() {
  if (!firebaseReady || millis() - lastFirebaseTriggerPoll < FIREBASE_TRIGGER_POLL_MS) return;
  lastFirebaseTriggerPoll = millis();
  String payload;
  if (firebaseRequest("GET", "/dispense_trigger", "", &payload)) {
    processCloudDispense(payload);
  }
}

void showDisplay(const char *title, const String &detail) {
  if (!displayReady) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 12);
  display.println(title);
  display.setCursor(0, 32);
  display.println(detail);
  display.display();
}

uint8_t findOledAddress() {
  uint8_t oledAddress = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("I2C device found at 0x%02X\n", address);
      if (address == 0x3C || address == 0x3D) {
        oledAddress = address;
      }
    }
  }
  return oledAddress;
}

void setPumpRelay(bool enabled) {
  bool outputHigh = enabled ? !PUMP_RELAY_ACTIVE_LOW : PUMP_RELAY_ACTIVE_LOW;
  digitalWrite(PUMP_RELAY_PIN, outputHigh ? HIGH : LOW);
}

// REST Endpoint: Dispense Tablet (e.g. /dispense?container=1&count=2)
void handleDispenseTablet() {
  if (!server.hasArg("container")) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_CONTAINER\"}");
    return;
  }

  int id = server.arg("container").toInt();
  int count = server.hasArg("count") ? server.arg("count").toInt() : 1;
  count = constrain(count, 1, 5);

  if (id < 1 || id > 4) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_CONTAINER\"}");
    return;
  }

  if (stock[id - 1] < count) {
    if (stock[id - 1] == 0) {
      showDisplay("Container Empty", "Please Refill");
      triggerBuzzerAlert(3);
      sendJson(400, "{\"status\":\"ERROR\",\"message\":\"EMPTY_CONTAINER\"}");
      return;
    }
    showDisplay("Low Stock", "Refill Container");
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INSUFFICIENT_STOCK\"}");
    return;
  }

  int dispensedCount = 0;
  dispenseTabletHardware(id, count, dispensedCount);
  if (dispensedCount != count) {
    sendJson(500, "{\"status\":\"ERROR\",\"message\":\"EMPTY_OR_JAMMED\",\"dispensed\":" +
                      String(dispensedCount) + "}");
    return;
  }

  sendJson(200, "{\"status\":\"SUCCESS\",\"container\":" + String(id) +
                    ",\"dispensed\":" + String(dispensedCount) +
                    ",\"remaining_stock\":" + String(stock[id - 1]) + "}");
}

// REST Endpoint: Dispense Liquid (e.g. /dispense_liquid?dose=10&calib_ms=350)
void handleDispenseLiquid() {
  int dose = server.hasArg("dose") ? server.arg("dose").toInt() : 10;
  int calibMs = server.hasArg("calib_ms") ? server.arg("calib_ms").toInt() : 300;
  if (dose < 1 || dose > 100) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_DOSE\"}");
    return;
  }
  if (calibMs < 100 || calibMs > 800) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_CALIBRATION\"}");
    return;
  }

  if (liquidLevelMl < dose) {
    showDisplay("Liquid Low", "Please Refill");
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"LOW_LIQUID_LEVEL\"}");
    return;
  }

  int sensorLiquidMl = readUltrasonicLiquidMl();
  if (liquidCapacityMl > 0 && sensorLiquidMl >= 0 && sensorLiquidMl < dose) {
    showDisplay("Liquid Sensor Low", "Check Bottle");
    sendJson(409, "{\"status\":\"ERROR\",\"message\":\"LIQUID_SENSOR_PROTECTION\"}");
    return;
  }
  dispenseLiquidHardware(dose, calibMs);
  syncFirebaseInventory();
  sendJson(200, "{\"status\":\"SUCCESS\",\"liquidDoseMl\":" + String(dose) +
                    ",\"calibMs\":" + String(calibMs) + "}");
}

// REST Endpoint: Refill/set liquid bottle capacity (e.g. /refill_liquid?volume=200)
void handleRefillLiquid() {
  if (!server.hasArg("volume")) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_VOLUME\"}");
    return;
  }

  int volume = server.arg("volume").toInt();
  if (volume < 50 || volume > MAX_LIQUID_ML) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_VOLUME\"}");
    return;
  }

  float measuredDistanceCm = readUltrasonicDistanceCm();
  if (measuredDistanceCm > 0.0f) {
    fullReferenceDistanceCm = measuredDistanceCm;
  }
  liquidCapacityMl = volume;
  liquidLevelMl = volume;
  syncFirebaseInventory();

  triggerBuzzerAlert(2);
  showDisplay("Liquid Refilled", String(volume) + " ml");
  sendJson(200, "{\"status\":\"SUCCESS\",\"message\":\"LIQUID_REFILLED\",\"liquid_ml\":" +
                    String(volume) + "}");
}

// REST Endpoint: Set exact tablet stock (e.g. /refill_tablet?container=1&stock=12)
void handleRefillTablet() {
  if (!server.hasArg("container")) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_CONTAINER\"}");
    return;
  }
  if (!server.hasArg("stock")) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_STOCK\"}");
    return;
  }

  int id = server.arg("container").toInt();
  int requestedStock = server.arg("stock").toInt();
  if (id < 1 || id > 4) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_CONTAINER\"}");
    return;
  }
  if (requestedStock < 1 || requestedStock > MAX_CONTAINER_PILLS) {
    sendJson(400, "{\"status\":\"ERROR\",\"message\":\"INVALID_STOCK\"}");
    return;
  }

  stock[id - 1] = requestedStock;
  syncFirebaseInventory();
  String displayTitle = "C" + String(id) + " Refilled:";
  showDisplay(displayTitle.c_str(), String(requestedStock) + " pills");
  triggerBuzzerAlert(1);
  sendJson(200, "{\"status\":\"SUCCESS\",\"container\":" + String(id) +
                    ",\"current_stock\":" + String(requestedStock) + "}");
}

// Measure Liquid Volume via HC-SR04 Ultrasonic Sensor
int readUltrasonicLiquidMl() {
  static int samples[ULTRASONIC_SAMPLE_COUNT] = {0};
  static int sampleCount = 0;
  static int sampleIndex = 0;
  long totalMl = 0;
  int validSamples = 0;

  for (int i = 0; i < ULTRASONIC_SAMPLE_COUNT; i++) {
    float distanceCm = readUltrasonicDistanceCm();
    if (distanceCm > 0.0f) {
      float liquidHeight = constrain(EMPTY_REFERENCE_DISTANCE_CM - distanceCm, 0.0f,
                                     EMPTY_REFERENCE_DISTANCE_CM - fullReferenceDistanceCm);
      float usableHeight = EMPTY_REFERENCE_DISTANCE_CM - fullReferenceDistanceCm;
      int measuredMl = usableHeight > 0.0f
                         ? (int)((liquidHeight / usableHeight) * liquidCapacityMl)
                         : liquidLevelMl;
      totalMl += constrain(measuredMl, 0, MAX_LIQUID_ML);
      validSamples++;
    }
    delay(5);
  }

  int currentMl = validSamples > 0 ? (int)(totalMl / validSamples) : liquidLevelMl;
  currentMl = constrain(currentMl, 0, MAX_LIQUID_ML);
  if (sampleCount == 0) {
    for (int i = 0; i < ULTRASONIC_SAMPLE_COUNT; i++) samples[i] = currentMl;
    sampleCount = ULTRASONIC_SAMPLE_COUNT;
  } else {
    samples[sampleIndex] = currentMl;
  }
  sampleIndex = (sampleIndex + 1) % ULTRASONIC_SAMPLE_COUNT;

  long movingTotal = 0;
  for (int i = 0; i < sampleCount; i++) movingTotal += samples[i];
  return (int)(movingTotal / sampleCount);
}

float readUltrasonicDistanceCm() {
  digitalWrite(US_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(US_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(US_TRIG_PIN, LOW);

  long duration = pulseIn(US_ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1.0f;
  return duration * 0.034f / 2.0f;
}

// REST Endpoint: Status (Includes Real Sensor Data)
void handleStatus() {
  int currentLiquidMl = readUltrasonicLiquidMl();
  bool pillDropped = (digitalRead(IR_PILL_PIN) == LOW);

  String json = "{";
  json += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"stock_c1\":" + String(stock[0]) + ",";
  json += "\"stock_c2\":" + String(stock[1]) + ",";
  json += "\"stock_c3\":" + String(stock[2]) + ",";
  json += "\"stock_c4\":" + String(stock[3]) + ",";
  json += "\"liquid_sensor_ml\":" + String(currentLiquidMl) + ",";
  json += "\"ir_pill_detected\":" + String(pillDropped ? "true" : "false");
  json += "}";
  sendJson(200, json);
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    sendJson(204, "{}");
    return;
  }
  sendJson(404, "{\"status\":\"ERROR\",\"message\":\"ENDPOINT_NOT_FOUND\"}");
}

Servo *getContainerServo(int id) {
  if (id == 1) return &servo1;
  if (id == 2) return &servo2;
  if (id == 3) return &servo3;
  if (id == 4) return &servo4;
  return NULL;
}

bool waitForPillDrop(unsigned long timeoutMs) {
  unsigned long startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    if (digitalRead(IR_PILL_PIN) == LOW) return true;
    delay(5);
  }
  return false;
}

// Physical Servo Motor Movement Function with IR-confirmed multi-drop dispensing.
void dispenseTabletHardware(int id, int count, int &dispensedCount) {
  Serial.print("[HARDWARE] Dispensing Tablet from Container: ");
  Serial.println(id);

  Servo *targetServo = getContainerServo(id);
  if (!targetServo || stock[id - 1] < count || stock[id - 1] > MAX_CONTAINER_PILLS) return;

  for (int cycle = 0; cycle < count; cycle++) {
    showDisplay("Dispensing", "Please Wait...");
    for (int pos = 0; pos <= 90; pos += 5) {
      targetServo->write(pos);
      delay(15);
    }

    bool dropped = waitForPillDrop(IR_DROP_TIMEOUT_MS);
    for (int pos = 90; pos >= 0; pos -= 5) {
      targetServo->write(pos);
      delay(15);
    }

    if (!dropped) {
      showDisplay("Tablet Not Found", "Check Container");
      triggerBuzzerAlert(3);
      Serial.println("[HARDWARE] No IR pill drop detected.");
      return;
    }

    stock[id - 1]--;
    dispensedCount++;
    triggerBuzzerAlert(1);
    showDisplay("Dispensing", "Dispensed " + String(dispensedCount) + "/" + String(count));
    delay(100);
  }

  Serial.println("[HARDWARE] Tablet Dispense Complete!");
}

// Physical Liquid Pump Movement Function
void dispenseLiquidHardware(int doseMl, int calibMs) {
  Serial.print("[HARDWARE] Dispensing Liquid Medicine: ");
  Serial.print(doseMl);
  Serial.print(" ml using ");
  Serial.print(calibMs);
  Serial.println(" ms/ml");

  showDisplay("Dispensing liquid", String(doseMl) + " ml");
  setPumpRelay(true);
  unsigned long runDuration = (unsigned long)doseMl * (unsigned long)calibMs;
  unsigned long startedAt = millis();
  while (millis() - startedAt < runDuration) {
    delay(5);
  }
  setPumpRelay(false);

  liquidLevelMl = max(0, liquidLevelMl - doseMl);
  triggerBuzzerAlert(1);
  showDisplay("Liquid complete", String(doseMl) + " ml");
  Serial.println("[HARDWARE] Liquid Pour Complete!");
}

// Buzzer Alert Generator
void triggerBuzzerAlert(int count) {
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}

// Check NTP Clock for Morning (08:00), Lunch (12:00), Night (20:00)
void checkTimeSchedules() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo))
    return;

  // Check exact hour & minute at 0 seconds
  if (timeinfo.tm_sec == 0) {
    if (timeinfo.tm_hour == 8 && timeinfo.tm_min == 0) {
      Serial.println("[SCHEDULE] Morning 8:00 AM Medicine Trigger");
      for (int index = 0; index < 4; index++) {
        if (!containerMorning[index] || containerDosage[index] < 1) continue;
        int dispensed = 0;
        dispenseTabletHardware(index + 1, containerDosage[index], dispensed);
      }
      if (liquidMorning && configuredLiquidDoseMl > 0 && configuredLiquidCalibMs > 0) {
        dispenseLiquidHardware(configuredLiquidDoseMl, configuredLiquidCalibMs);
      }
      delay(1000);
    } else if (timeinfo.tm_hour == 12 && timeinfo.tm_min == 0) {
      Serial.println("[SCHEDULE] Lunch 12:00 PM Medicine Trigger");
      for (int index = 0; index < 4; index++) {
        if (!containerLunch[index] || containerDosage[index] < 1) continue;
        int dispensed = 0;
        dispenseTabletHardware(index + 1, containerDosage[index], dispensed);
      }
      if (liquidLunch && configuredLiquidDoseMl > 0 && configuredLiquidCalibMs > 0) {
        dispenseLiquidHardware(configuredLiquidDoseMl, configuredLiquidCalibMs);
      }
      delay(1000);
    } else if (timeinfo.tm_hour == 20 && timeinfo.tm_min == 0) {
      Serial.println("[SCHEDULE] Night 8:00 PM Medicine Trigger");
      for (int index = 0; index < 4; index++) {
        if (!containerNight[index] || containerDosage[index] < 1) continue;
        int dispensed = 0;
        dispenseTabletHardware(index + 1, containerDosage[index], dispensed);
      }
      delay(1000);
    }
  }
}
