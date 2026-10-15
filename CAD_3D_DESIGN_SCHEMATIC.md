# Medi Tracker: 3D CAD Drawing & Mechanical Hardware Design Schematic
## Smart Medicine & Liquid Dispenser System (ESP32)

---

### 1. 3D Structural Layout & Dimensions

The Medi Tracker enclosure is designed for compact desktop or bedside installation.

```
       +-------------------------------------------------------------------+
       |                       TOP LIQUID & TABLET TOWER                   |
       |  +------------+  +------------+  +------------+  +------------+   |
       |  | CONTAINER 1|  | CONTAINER 2|  | CONTAINER 3|  | CONTAINER 4|   |
       |  | (Morning/  |  | (Amoxicillin|  | (Vitamin C)|  | (Aspirin)  |   |
       |  |  Night)    |  |  500mg)    |  |            |  |            |   |
       |  +-----+------+  +-----+------+  +-----+------+  +-----+------+   |
       |        |               |               |               |          |
       |  +-----+------+  +-----+------+  +-----+------+  +-----+------+   |
       |  | SERVO M1   |  | SERVO M2   |  | SERVO M3   |  | SERVO M4   |   |
       |  | (GPIO 13)  |  | (GPIO 12)  |  | (GPIO 14)  |  | (GPIO 27)  |   |
       |  +-----+------+  +-----+------+  +-----+------+  +-----+------+   |
       |        |               |               |               |          |
       |  ======v===============v===============v===============v======    |
       |                      SLOPED PILL DISPENSE CHUTE                   |
       +-------------------------------------------------------------------+
       |  [ OLED DISPLAY ]  [ ESP32 W-IFI MODULE ]   [ LIQUID NOZZLE ]     |
    |  (SSD1306 I2C)     (SSID: ESW)              (DC Pump - GPIO 26)   |
       |                                                    |              |
       |  [---------------- MAIN COLLECTION TRAY ----------------]         |
       +-------------------------------------------------------------------+
```

#### Physical Dimensions:
- **Total Width:** 320 mm
- **Total Height:** 220 mm
- **Total Depth:** 180 mm
- **Container Diameter:** 50 mm x Height 110 mm (Capacity: ~20-25 tablets each)
- **Liquid Reservoir Capacity:** 200 ml

---

### 2. Circuit Diagram & Wiring Connections

```mermaid
graph TD
    subgraph Microcontroller
        ESP32["ESP32 Dev Board<br/>(Wi-Fi: ESW)"]
    end

    subgraph Tablet Servos
        S1["Servo Motor 1<br/>(Container 1)"]
        S2["Servo Motor 2<br/>(Container 2)"]
        S3["Servo Motor 3<br/>(Container 3)"]
        S4["Servo Motor 4<br/>(Container 4)"]
    end

    subgraph Liquid Dispenser
        RELAY["5V Relay Module"]
        PUMP["DC 6V Peristaltic Pump"]
    end

    subgraph Sensors
        US["HC-SR04 Ultrasonic Sensor<br/>(Liquid Level Meter)"]
        IR["IR Obstacle Sensor<br/>(Pill Drop Detector)"]
    end

    ESP32 -- "GPIO 13 (PWM)" --> S1
    ESP32 -- "GPIO 12 (PWM)" --> S2
    ESP32 -- "GPIO 14 (PWM)" --> S3
    ESP32 -- "GPIO 27 (PWM)" --> S4

    ESP32 -- "GPIO 26" --> RELAY
    RELAY -- "NO / COM" --> PUMP

    ESP32 -- "GPIO 5 (Trig) / GPIO 18 (Echo)" --> US
    ESP32 -- "GPIO 19 (Digital OUT)" --> IR

    ESP32 -- "GPIO 21 (SDA) / GPIO 22 (SCL)" --> OLED
    ESP32 -- "GPIO 25" --> BUZZER
    ESP32 -- "GPIO 2" --> LED
```

---

### 3. Component Bill of Materials (BOM)

| Component | Part / Model | Quantity | Purpose |
| :--- | :--- | :---: | :--- |
| **Microcontroller** | ESP32-WROOM-32U | 1 | Core CPU with Wi-Fi & Bluetooth |
| **Servo Motors** | TowerPro SG90 9g | 4 | Rotating tablet dispensing mechanism |
| **Liquid Pump** | 6V Peristaltic / Mini Pump | 1 | Liquid medicine dosage dispensing |
| **Ultrasonic Sensor**| HC-SR04 | 1 | Real-time liquid bottle level sensor |
| **Infrared Sensor** | IR Obstacle Sensor FC-51 | 1 | Tablet drop verification sensor |
| **Relay Driver** | 1-Channel 5V Relay | 1 | High-current isolation for liquid pump |
| **Display** | 0.96" I2C OLED SSD1306 | 1 | Local status and Wi-Fi IP display |
| **Audio Notification**| 5V Piezo Buzzer | 1 | Audible reminder sound when dispensing |
| **Power Supply** | 5V 3A DC Adapter | 1 | Main system power supply |
| **3D Printing Material**| PLA Filament | 450g | Enclosure, containers, and funnel chute |

---

### 4. Sequence Flowchart

```mermaid
sequenceDiagram
    autonumber
    participant App as Mobile Web App
    participant Cloud as Local Wi-Fi (ESW)
    participant ESP32 as ESP32 Microcontroller
    participant Hardware as Servos & Pump
    participant User as Patient

    Note over App, User: Scheduled Time Trigger (Morning 8 AM / Lunch 12 PM / Night 8 PM)
    App->>Cloud: Send Dispense Request (HTTP POST)
    Cloud->>ESP32: Trigger Container / Liquid Endpoint
    ESP32->>Hardware: Sound Buzzer (GPIO 25)
    ESP32->>Hardware: Rotate Servo 90° / Activate Relay 3s
    Hardware-->>User: Drop Tablet / Pour Liquid into Cup
    ESP32-->>App: Return JSON Success (Status 200)
    App->>User: Display Push Notification & Sound Alert
    App->>App: Update Container Stock & Append History Log
```
