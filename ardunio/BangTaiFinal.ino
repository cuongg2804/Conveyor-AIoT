#include <Servo.h>
#include <EEPROM.h>
#include <Wire.h>
#include <BH1750.h>

// ================= PIN CONFIG =================
// L298N - channel B
const int PIN_IN3 = 2;
const int PIN_IN4 = 3;
const int PIN_ENB = 5;

// Sensors / actuator
const int PIN_S1 = 4;
const int PIN_S2 = 6;
const int PIN_SERVO = 7;
const int PIN_RELAY = 8;

// Buttons
const int PIN_START = 9;
const int PIN_STOP = 10;

// Traffic lights
const int PIN_DEN_DO = 11;
const int PIN_DEN_VANG = 12;
const int PIN_DEN_XANH = 13;

// Analog pins used as digital
const int PIN_COI = A0;
const int PIN_NUT_TOC_DO = A1;   // LA38 selector switch 23-24
const int PIN_LIMIT_GATE = A2;   // limit switch servo, declared only, not used yet
const int PIN_ESTOP = A3;

// A4 = SDA BH1750
// A5 = SCL BH1750

// ================= BH1750 =================
BH1750 lightMeter(0x23);
bool bh1750Ready = false;

// ================= LOGIC CONFIG =================
const bool CB_ACTIVE_HIGH = false;
const bool RELAY_ACTIVE_HIGH = false;
const bool NUT_ACTIVE_LOW = true;
const bool DEN_ACTIVE_HIGH = true;

// ================= FIRMWARE =================
#define FIRMWARE_VERSION "1.1.0"

// ================= CONFIG EEPROM =================
const uint16_t CONFIG_MAGIC = 0xA55A;
const uint8_t CONFIG_VERSION = 1;

struct ArduinoConfig {
  uint16_t magic;
  uint8_t version;

  int speedLowLevel;
  int speedHighLevel;

  int gocHome;
  int gocGat;

  int luxMin;
  int luxMax;
};

ArduinoConfig cfg;

const ArduinoConfig DEFAULT_CONFIG = {
  CONFIG_MAGIC,
  CONFIG_VERSION,

  2,      // speedLowLevel: Slow - PWM 179
  5,      // speedHighLevel: Max - PWM 255

  0,      // servo home angle
  130,    // servo gate angle

  1000,   // luxMin
  2000    // luxMax
};

// ================= SPEED PRESET =================
// Level 1: Very Slow - PWM 153 - 7.95 rpm - delay 146ms
// Level 2: Slow      - PWM 179 - 9.07 rpm - delay 130ms
// Level 3: Normal    - PWM 204 - 9.88 rpm - delay 121ms
// Level 4: Fast      - PWM 230 - 10.54 rpm - delay 115ms
// Level 5: Max       - PWM 255 - 12.00 rpm - delay 103ms

bool dangChayNhanh = true;       // true = HIGH, false = LOW
bool lastSpeedSwitchMode = true;
bool speedChangeWarned = false;

int getPwmFromSpeedLevel(int level) {
  switch (level) {
    case 1: return 153;
    case 2: return 179;
    case 3: return 204;
    case 4: return 230;
    case 5: return 255;
    default: return 255;
  }
}

unsigned long getDelayBeforeGateMs(int level) {
  switch (level) {
    case 1: return 146;
    case 2: return 130;
    case 3: return 121;
    case 4: return 115;
    case 5: return 103;
    default: return 103;
  }
}

bool isValidSpeedLevel(int level) {
  return level >= 1 && level <= 5;
}

bool isValidSpeedRange(int lowLevel, int highLevel) {
  return isValidSpeedLevel(lowLevel) &&
         isValidSpeedLevel(highLevel) &&
         lowLevel < highLevel;
}

int getCurrentSpeedLevel() {
  return dangChayNhanh ? cfg.speedHighLevel : cfg.speedLowLevel;
}

int getCurrentPwm() {
  return getPwmFromSpeedLevel(getCurrentSpeedLevel());
}

// LA38: 23-24 closed -> A1 LOW -> HIGH speed
bool readSpeedSwitchHighMode() {
  return digitalRead(PIN_NUT_TOC_DO) == LOW;
}

// ================= SERVO =================
Servo servoGat;
const unsigned long GIU_GAT_MS = 300;

// ================= RELAY =================
const unsigned long RELAY_PULSE_MS = 100;

// ================= SENSOR MEMORY =================
bool lastS1 = false;
bool lastS2 = false;

unsigned long mocS2 = 0;
const unsigned long DOI_S2_MS = 150;

// ================= BUTTON DEBOUNCE =================
bool lastStart = false;
bool lastStop = false;

unsigned long mocNut = 0;
const unsigned long DOI_NUT_MS = 150;

// ================= E-STOP EDGE =================
bool lastEstop = false;

// ================= SIGNAL LIGHT =================
unsigned long mocNhapNhay = 0;
bool nhapNhay = false;
const unsigned long NHAP_NHAY_ESTOP_MS = 250;

// ================= SYSTEM STATE =================
enum SystemState {
  STOPPED,
  RUNNING,
  EMERGENCY_STOP
};

SystemState trangThai = STOPPED;

// ================= SERIAL + QUEUE =================
const int SIZE_QUEUE = 30;
int queueKQ[SIZE_QUEUE];

int qDau = 0;
int qCuoi = 0;
int qSoLuong = 0;

// ================= BASIC IO =================
bool coVat(int pin) {
  int muc = digitalRead(pin);
  return CB_ACTIVE_HIGH ? (muc == HIGH) : (muc == LOW);
}

bool nutNhan(int pin) {
  int muc = digitalRead(pin);
  return NUT_ACTIVE_LOW ? (muc == LOW) : (muc == HIGH);
}

bool docEstop() {
  return digitalRead(PIN_ESTOP) == LOW;
}

void setRelay(bool bat) {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(PIN_RELAY, bat ? HIGH : LOW);
  } else {
    digitalWrite(PIN_RELAY, bat ? LOW : HIGH);
  }
}

void batCoi() {
  digitalWrite(PIN_COI, HIGH);
}

void tatCoi() {
  digitalWrite(PIN_COI, LOW);
}

void ghiDen(int pin, bool bat) {
  digitalWrite(pin, (DEN_ACTIVE_HIGH ? bat : !bat) ? HIGH : LOW);
}

void tatTatCaDen() {
  ghiDen(PIN_DEN_DO, false);
  ghiDen(PIN_DEN_VANG, false);
  ghiDen(PIN_DEN_XANH, false);
}

// ================= CONFIG VALIDATION =================
bool canChangeConfig() {
  if (trangThai != STOPPED) {
    Serial.println(F("ERR:CONFIG_ONLY_WHEN_STOPPED"));
    return false;
  }

  return true;
}

bool isValidAngle(int angle) {
  return angle >= 0 && angle <= 180;
}

bool isValidLuxRange(int minLux, int maxLux) {
  return minLux >= 0 && maxLux <= 3000 && minLux < maxLux;
}

bool isValidConfig(ArduinoConfig c) {
  if (c.magic != CONFIG_MAGIC) return false;
  if (c.version != CONFIG_VERSION) return false;

  if (!isValidSpeedRange(c.speedLowLevel, c.speedHighLevel)) return false;
  if (!isValidAngle(c.gocHome)) return false;
  if (!isValidAngle(c.gocGat)) return false;
  if (!isValidLuxRange(c.luxMin, c.luxMax)) return false;

  return true;
}

void loadConfigFromEEPROM() {
  EEPROM.get(0, cfg);

  if (!isValidConfig(cfg)) {
    cfg = DEFAULT_CONFIG;
    Serial.println(F("CONFIG: EEPROM invalid -> use factory default"));
  } else {
    Serial.println(F("CONFIG: loaded from EEPROM"));
  }
}

void saveConfigToEEPROM() {
  cfg.magic = CONFIG_MAGIC;
  cfg.version = CONFIG_VERSION;

  EEPROM.put(0, cfg);
  Serial.println(F("ACK:SAVE_CONFIG"));
}

void resetFactoryDefault(bool saveToEeprom) {
  cfg = DEFAULT_CONFIG;

  if (saveToEeprom) {
    EEPROM.put(0, cfg);
    Serial.println(F("ACK:RESET_CONFIG_DEFAULT:SAVED"));
  } else {
    Serial.println(F("ACK:RESET_CONFIG_DEFAULT:SESSION"));
  }
}

const char* getLightStatus(float lux) {
  if (lux < cfg.luxMin) return "DARK";
  if (lux > cfg.luxMax) return "BRIGHT";
  return "OK";
}

void printConfig() {
  Serial.print(F("CONFIG:"));

  Serial.print(F("fw="));
  Serial.print(FIRMWARE_VERSION);

  Serial.print(F(",speedLowLevel="));
  Serial.print(cfg.speedLowLevel);
  Serial.print(F(",speedLowPwm="));
  Serial.print(getPwmFromSpeedLevel(cfg.speedLowLevel));

  Serial.print(F(",speedHighLevel="));
  Serial.print(cfg.speedHighLevel);
  Serial.print(F(",speedHighPwm="));
  Serial.print(getPwmFromSpeedLevel(cfg.speedHighLevel));

  Serial.print(F(",currentSpeedMode="));
  Serial.print(dangChayNhanh ? F("HIGH") : F("LOW"));

  Serial.print(F(",currentSpeedLevel="));
  Serial.print(getCurrentSpeedLevel());

  Serial.print(F(",currentPwm="));
  Serial.print(getCurrentPwm());

  Serial.print(F(",gocHome="));
  Serial.print(cfg.gocHome);

  Serial.print(F(",gocGat="));
  Serial.print(cfg.gocGat);

  Serial.print(F(",delayBeforeGateMs="));
  Serial.print(getDelayBeforeGateMs(getCurrentSpeedLevel()));

  Serial.print(F(",luxMin="));
  Serial.print(cfg.luxMin);

  Serial.print(F(",luxMax="));
  Serial.println(cfg.luxMax);
}

// ================= CONFIG SERIAL HANDLERS =================
void handleSetSpeedRange(String msg) {
  if (!canChangeConfig()) return;

  String body = msg.substring(sizeof("SET_SPEED_RANGE:") - 1);
  int commaIndex = body.indexOf(',');

  if (commaIndex == -1) {
    Serial.println(F("ERR:INVALID_SPEED_FORMAT"));
    return;
  }

  int lowLevel = body.substring(0, commaIndex).toInt();
  int highLevel = body.substring(commaIndex + 1).toInt();

  if (!isValidSpeedRange(lowLevel, highLevel)) {
    Serial.println(F("ERR:INVALID_SPEED_RANGE"));
    return;
  }

  cfg.speedLowLevel = lowLevel;
  cfg.speedHighLevel = highLevel;

  Serial.print(F("ACK:SET_SPEED_RANGE:"));
  Serial.print(cfg.speedLowLevel);
  Serial.print(F(","));
  Serial.println(cfg.speedHighLevel);
}

void handleSetServoHome(String msg) {
  if (!canChangeConfig()) return;

  int value = msg.substring(sizeof("SET_SERVO_HOME:") - 1).toInt();

  if (!isValidAngle(value)) {
    Serial.println(F("ERR:INVALID_SERVO_HOME"));
    return;
  }

  cfg.gocHome = value;
  servoGat.write(cfg.gocHome);

  Serial.print(F("ACK:SET_SERVO_HOME:"));
  Serial.println(cfg.gocHome);
}

void handleSetServoGate(String msg) {
  if (!canChangeConfig()) return;

  int value = msg.substring(sizeof("SET_SERVO_GATE:") - 1).toInt();

  if (!isValidAngle(value)) {
    Serial.println(F("ERR:INVALID_SERVO_GATE"));
    return;
  }

  cfg.gocGat = value;

  Serial.print(F("ACK:SET_SERVO_GATE:"));
  Serial.println(cfg.gocGat);
}

void handleSetLightRange(String msg) {
  if (!canChangeConfig()) return;

  String body = msg.substring(sizeof("SET_LIGHT_RANGE:") - 1);
  int commaIndex = body.indexOf(',');

  if (commaIndex == -1) {
    Serial.println(F("ERR:INVALID_LIGHT_FORMAT"));
    return;
  }

  int minLux = body.substring(0, commaIndex).toInt();
  int maxLux = body.substring(commaIndex + 1).toInt();

  if (!isValidLuxRange(minLux, maxLux)) {
    Serial.println(F("ERR:INVALID_LIGHT_RANGE"));
    return;
  }

  cfg.luxMin = minLux;
  cfg.luxMax = maxLux;

  Serial.print(F("ACK:SET_LIGHT_RANGE:"));
  Serial.print(cfg.luxMin);
  Serial.print(F(","));
  Serial.println(cfg.luxMax);
}

// ================= SPEED SELECTOR =================
void xuLyCongTacTocDo() {
  bool switchHighMode = readSpeedSwitchHighMode();

  if (trangThai == STOPPED) {
    if (dangChayNhanh != switchHighMode) {
      dangChayNhanh = switchHighMode;
      speedChangeWarned = false;

      Serial.print(F("SPEED_MODE:"));
      Serial.print(dangChayNhanh ? F("HIGH") : F("LOW"));
      Serial.print(F(",LEVEL:"));
      Serial.print(getCurrentSpeedLevel());
      Serial.print(F(",PWM:"));
      Serial.println(getCurrentPwm());
    }
  } else if (trangThai == RUNNING) {
    if (switchHighMode != dangChayNhanh && !speedChangeWarned) {
      Serial.println(F("WARN:SPEED_CHANGE_REQUIRE_STOP"));
      speedChangeWarned = true;
    }

    if (switchHighMode == dangChayNhanh) {
      speedChangeWarned = false;
    }
  }

  lastSpeedSwitchMode = switchHighMode;
}

// ================= MOTOR =================
void motorChayThuan(int pwm) {
  pwm = constrain(pwm, 0, 255);

  digitalWrite(PIN_IN3, HIGH);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, pwm);
}

void dungMotor() {
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, 0);
}

// ================= SERVO / ACTUATOR =================
void servoVeHome() {
  servoGat.write(cfg.gocHome);
}

void dungCoCau() {
  dungMotor();
  setRelay(false);
  tatCoi();
}

void gatSanPhamLoi() {
  if (trangThai != RUNNING) return;

  delay(getDelayBeforeGateMs(getCurrentSpeedLevel()));

  servoGat.write(cfg.gocGat);
  delay(GIU_GAT_MS);
  servoGat.write(cfg.gocHome);
}

// ================= QUEUE =================
void xoaQueue() {
  qDau = 0;
  qCuoi = 0;
  qSoLuong = 0;
}

bool themKQ(int giaTri) {
  if (qSoLuong >= SIZE_QUEUE) return false;

  queueKQ[qCuoi] = giaTri;
  qCuoi = (qCuoi + 1) % SIZE_QUEUE;
  qSoLuong++;
  return true;
}

bool layKQ(int &giaTri) {
  if (qSoLuong <= 0) return false;

  giaTri = queueKQ[qDau];
  qDau = (qDau + 1) % SIZE_QUEUE;
  qSoLuong--;
  return true;
}

void inQueue() {
  Serial.print(F("Queue: ["));

  for (int i = 0; i < qSoLuong; i++) {
    int idx = (qDau + i) % SIZE_QUEUE;
    Serial.print(queueKQ[idx]);
    if (i < qSoLuong - 1) Serial.print(F(", "));
  }

  Serial.println(F("]"));
}

// ================= LIGHT CHECK =================
void lightCheck10s() {
  if (!canChangeConfig()) return;

  if (!bh1750Ready) {
    Serial.println(F("ERR:BH1750_NOT_READY"));
    return;
  }

  Serial.println(F("LIGHT_CHECK:START"));

  float sumLux = 0;
  float minLux = 999999;
  float maxLux = -1;
  int count = 10;

  for (int i = 1; i <= count; i++) {
    float lux = lightMeter.readLightLevel();

    if (lux < 0) {
      Serial.println(F("ERR:BH1750_READ_FAILED"));
      return;
    }

    sumLux += lux;
    if (lux < minLux) minLux = lux;
    if (lux > maxLux) maxLux = lux;

    Serial.print(F("LIGHT_SAMPLE:"));
    Serial.print(i);
    Serial.print(F(","));
    Serial.println(lux, 1);

    delay(1000);
  }

  float avgLux = sumLux / count;
  const char* status = getLightStatus(avgLux);

  Serial.print(F("LIGHT_RESULT:"));
  Serial.print(F("avg="));
  Serial.print(avgLux, 1);

  Serial.print(F(",min="));
  Serial.print(minLux, 1);

  Serial.print(F(",max="));
  Serial.print(maxLux, 1);

  Serial.print(F(",status="));
  Serial.println(status);
}

// ================= SYSTEM STATE =================
void batHeThong() {
  if (trangThai == STOPPED) {
    // Apply physical selector state before starting
    dangChayNhanh = readSpeedSwitchHighMode();
    speedChangeWarned = false;

    lastS1 = coVat(PIN_S1);
    lastS2 = coVat(PIN_S2);

    trangThai = RUNNING;

    Serial.print(F("START: He thong bat dau chay. SPEED_MODE:"));
    Serial.print(dangChayNhanh ? F("HIGH") : F("LOW"));
    Serial.print(F(",PWM:"));
    Serial.println(getCurrentPwm());
  }
}

void dungHeThong() {
  if (trangThai == RUNNING) {
    trangThai = STOPPED;
    dungCoCau();

    Serial.println(F("STOP: He thong dung."));
  }
}

void dungKhanCap() {
  if (trangThai != EMERGENCY_STOP) {
    trangThai = EMERGENCY_STOP;
    dungCoCau();
    xoaQueue();

    Serial.println(F("EMERGENCY STOP: Dung khan cap!"));
  }
}

void nhaEstopVeStopped() {
  if (trangThai == EMERGENCY_STOP) {
    trangThai = STOPPED;
    dungCoCau();

    Serial.println(F("E-STOP RESET: He thong ve STOPPED. Can bam START de chay lai."));
  }
}

// ================= SIGNAL UPDATE =================
void capNhatBaoHieu() {
  unsigned long now = millis();

  switch (trangThai) {
    case RUNNING:
      ghiDen(PIN_DEN_DO, false);
      ghiDen(PIN_DEN_VANG, false);
      ghiDen(PIN_DEN_XANH, true);
      tatCoi();
      break;

    case STOPPED:
      ghiDen(PIN_DEN_DO, false);
      ghiDen(PIN_DEN_VANG, true);
      ghiDen(PIN_DEN_XANH, false);
      tatCoi();
      break;

    case EMERGENCY_STOP:
      if (now - mocNhapNhay >= NHAP_NHAY_ESTOP_MS) {
        mocNhapNhay = now;
        nhapNhay = !nhapNhay;
      }

      ghiDen(PIN_DEN_DO, nhapNhay);
      ghiDen(PIN_DEN_VANG, false);
      ghiDen(PIN_DEN_XANH, false);

      if (nhapNhay) batCoi();
      else tatCoi();
      break;
  }
}

// ================= CAMERA RELAY =================
void kichRelayChupAnh() {
  if (trangThai != RUNNING) return;

  setRelay(true);
  delay(RELAY_PULSE_MS);
  setRelay(false);
}

// ================= SERIAL =================
void xuLySerial() {
  while (Serial.available()) {
    String msg = Serial.readStringUntil('\n');
    msg.trim();

    if (msg.length() == 0) return;

    if (msg == "0" || msg == "1") {
      int giaTri = msg.toInt();

      if (themKQ(giaTri)) {
        Serial.print(F("Nhan tu Python: "));
        Serial.println(giaTri);
        inQueue();
      } else {
        Serial.println(F("Queue day, khong them duoc."));
      }
    }

    else if (msg.equalsIgnoreCase("START")) {
      batHeThong();
    }

    else if (msg.equalsIgnoreCase("STOP")) {
      dungHeThong();
    }

    else if (msg.equalsIgnoreCase("GET_VERSION")) {
      Serial.print(F("FW_VERSION:"));
      Serial.println(FIRMWARE_VERSION);
    }

    else if (msg.equalsIgnoreCase("GET_CONFIG")) {
      printConfig();
    }

    else if (msg.equalsIgnoreCase("SAVE_CONFIG")) {
      if (!canChangeConfig()) return;
      saveConfigToEEPROM();
    }

    else if (msg.equalsIgnoreCase("RESET_CONFIG_DEFAULT")) {
      if (!canChangeConfig()) return;
      resetFactoryDefault(true);
      servoVeHome();
      printConfig();
    }

    else if (msg.equalsIgnoreCase("LIGHT_CHECK")) {
      lightCheck10s();
    }

    else if (msg.startsWith("SET_SPEED_RANGE:")) {
      handleSetSpeedRange(msg);
    }

    else if (msg.startsWith("SET_SERVO_HOME:")) {
      handleSetServoHome(msg);
    }

    else if (msg.startsWith("SET_SERVO_GATE:")) {
      handleSetServoGate(msg);
    }

    else if (msg.startsWith("SET_LIGHT_RANGE:")) {
      handleSetLightRange(msg);
    }

    else {
      Serial.print(F("ERR:UNKNOWN_COMMAND:"));
      Serial.println(msg);
    }
  }
}

// ================= BUTTONS =================
void xuLyNutStartStop() {
  bool startNhan = nutNhan(PIN_START);
  bool stopNhan = nutNhan(PIN_STOP);

  unsigned long now = millis();

  if (now - mocNut >= DOI_NUT_MS) {
    if (startNhan && !lastStart) {
      batHeThong();
      mocNut = now;
    }

    if (stopNhan && !lastStop) {
      dungHeThong();
      mocNut = now;
    }
  }

  lastStart = startNhan;
  lastStop = stopNhan;
}

// ================= E-STOP =================
void xuLyEstop() {
  bool estopHienTai = docEstop();

  if (estopHienTai && !lastEstop) {
    dungKhanCap();
  }

  if (!estopHienTai && lastEstop) {
    nhaEstopVeStopped();
  }

  lastEstop = estopHienTai;
}

// ================= MOTOR UPDATE =================
void capNhatMotor() {
  if (trangThai == RUNNING) {
    motorChayThuan(getCurrentPwm());
  } else {
    dungMotor();
  }
}

// ================= SENSORS =================
void xuLyCamBien() {
  bool s1CoVat = coVat(PIN_S1);
  bool s2CoVat = coVat(PIN_S2);

  if (trangThai == RUNNING) {
    if (s1CoVat && !lastS1) {
      Serial.println(F("Sensor 1: Phat hien vat -> kich relay"));
      kichRelayChupAnh();
    }

    if (s2CoVat && !lastS2) {
      unsigned long now = millis();

      if (now - mocS2 >= DOI_S2_MS) {
        mocS2 = now;

        int ketQua;
        if (layKQ(ketQua)) {
          Serial.print(F("Lay tu queue: "));
          Serial.println(ketQua);
          inQueue();

          if (ketQua == 1) {
            Serial.println(F("Sensor 2: NG -> servo gat"));
            gatSanPhamLoi();
          } else {
            Serial.println(F("Sensor 2: OK -> khong gat"));
          }
        } else {
          Serial.println(F("Sensor 2: Queue rong -> khong gat"));
        }
      }
    }
  }

  lastS1 = s1CoVat;
  lastS2 = s2CoVat;
}

// ================= SETUP =================
void setup() {
  Serial.begin(9600);

  loadConfigFromEEPROM();

  pinMode(PIN_S1, INPUT_PULLUP);
  pinMode(PIN_S2, INPUT_PULLUP);

  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_ENB, OUTPUT);

  pinMode(PIN_RELAY, OUTPUT);
  setRelay(false);

  pinMode(PIN_START, INPUT_PULLUP);
  pinMode(PIN_STOP, INPUT_PULLUP);

  pinMode(PIN_NUT_TOC_DO, INPUT_PULLUP);
  pinMode(PIN_LIMIT_GATE, INPUT_PULLUP);
  pinMode(PIN_ESTOP, INPUT_PULLUP);

  pinMode(PIN_DEN_DO, OUTPUT);
  pinMode(PIN_DEN_VANG, OUTPUT);
  pinMode(PIN_DEN_XANH, OUTPUT);

  pinMode(PIN_COI, OUTPUT);

  Wire.begin();
  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    bh1750Ready = true;
    Serial.println(F("BH1750:READY"));
  } else {
    bh1750Ready = false;
    Serial.println(F("BH1750:ERROR"));
  }

  servoGat.attach(PIN_SERVO);
  servoVeHome();

  dungMotor();
  tatCoi();
  tatTatCaDen();
  xoaQueue();

  trangThai = STOPPED;

  dangChayNhanh = readSpeedSwitchHighMode();
  lastSpeedSwitchMode = dangChayNhanh;

  lastS1 = coVat(PIN_S1);
  lastS2 = coVat(PIN_S2);
  lastEstop = docEstop();

  capNhatBaoHieu();

  Serial.println(F("He thong da khoi dong."));
  Serial.println(F("Trang thai ban dau: STOPPED"));

  Serial.println(F("Lenh cau hinh:"));
  Serial.println(F("SET_SPEED_RANGE:low,high  // low/high = 1..5, low < high"));
  Serial.println(F("SET_SERVO_HOME:x"));
  Serial.println(F("SET_SERVO_GATE:x"));
  Serial.println(F("SET_LIGHT_RANGE:min,max   // 0 <= min < max <= 3000"));
  Serial.println(F("GET_CONFIG"));
  Serial.println(F("GET_VERSION"));
  Serial.println(F("SAVE_CONFIG"));
  Serial.println(F("RESET_CONFIG_DEFAULT"));
  Serial.println(F("LIGHT_CHECK"));

  printConfig();
}

// ================= LOOP =================
void loop() {
  xuLyEstop();
  capNhatBaoHieu();
  xuLySerial();
  xuLyNutStartStop();
  xuLyCongTacTocDo();
  capNhatMotor();
  xuLyCamBien();

  delay(20);
}
