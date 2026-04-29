#include <Servo.h>

// ===================== PIN CONFIG =====================
// ----- L298N channel B: IN3 / IN4 / ENB -> OUT3 / OUT4 -----
const int PIN_IN3          = 2;    // L298N IN3
const int PIN_IN4          = 3;    // L298N IN4
const int PIN_ENB          = 5;    // PWM điều khiển tốc độ động cơ

// ----- Sensors / actuator -----
const int PIN_SENSOR1      = 4;    // Cảm biến vật thể 1
const int PIN_SENSOR2      = 6;    // Cảm biến vật thể 2
const int PIN_SERVO        = 7;    // Servo signal
const int PIN_RELAY        = 8;    // Relay trigger camera

// ----- Buttons -----
const int PIN_BTN_START    = 9;    // Nút Start
const int PIN_BTN_STOP     = 10;   // Nút Stop

// ----- Traffic lights -----
const int PIN_LED_RED      = 11;   // Đèn đỏ
const int PIN_LED_YELLOW   = 12;   // Đèn vàng
const int PIN_LED_GREEN    = 13;   // Đèn xanh

// ----- Analog pins -----
const int PIN_BUZZER       = A0;   // + buzzer -> A0, - -> GND
const int PIN_POT          = A1;   // B10K chỉnh tốc độ
const int PIN_ESTOP        = A5;   // E-stop NO, đầu còn lại nối GND

// ===================== LOGIC CONFIG =====================
const bool SENSOR_ACTIVE_HIGH = false;   // LM393 thường phát hiện = LOW
const bool RELAY_ACTIVE_HIGH  = false;   // Relay module active LOW
const bool BUTTON_ACTIVE_LOW  = true;    // Vì dùng INPUT_PULLUP
const bool LED_ACTIVE_HIGH    = true;    // Đèn sáng khi digitalWrite(HIGH)

// ===================== SPEED CONFIG =====================
// Nếu pot <= threshold => dừng hẳn băng tải
const int MOTOR_STOP_THRESHOLD = 35;

// Khi pot vượt ngưỡng dừng, PWM bắt đầu từ đây để motor đủ lực quay
const int MOTOR_MIN_PWM = 120;
const int MOTOR_MAX_PWM = 255;

// ===================== SERVO CONFIG =====================
Servo gatServo;

const int SERVO_HOME_ANGLE   = 0;
const int SERVO_PUSH_ANGLE   = 120;
const unsigned long SERVO_PRE_DELAY_MS = 50;   // chờ trước khi đẩy
const unsigned long SERVO_HOLD_MS      = 300;  // giữ ở vị trí đẩy

// ===================== RELAY CONFIG =====================
const unsigned long RELAY_PULSE_MS = 100;

// ===================== SENSOR DEBOUNCE =====================
bool lastSensor1Detected = false;
bool lastSensor2Detected = false;

unsigned long lastSensor1TriggerTime = 0;
unsigned long lastSensor2TriggerTime = 0;

const unsigned long SENSOR1_DEBOUNCE_MS = 80;
const unsigned long SENSOR2_DEBOUNCE_MS = 50;

// ===================== BUTTON DEBOUNCE =====================
bool lastStartPressed = false;
bool lastStopPressed  = false;

unsigned long lastButtonTime = 0;
const unsigned long BUTTON_DEBOUNCE_MS = 150;

// ===================== E-STOP EDGE =====================
bool lastEStopPressed = false;

// ===================== INDICATOR TIMING =====================
unsigned long lastIndicatorToggle = 0;
bool estopBlinkState = false;
const unsigned long ESTOP_BLINK_MS = 250;

// ===================== SYSTEM STATE =====================
enum SystemState {
  STOPPED,
  RUNNING,
  EMERGENCY_STOP
};

SystemState systemState = STOPPED;

// ===================== SERIAL + QUEUE =====================
const int QUEUE_SIZE = 30;
int resultQueue[QUEUE_SIZE];
int qHead = 0;
int qTail = 0;
int qCount = 0;

// ===================== RELAY STATE MACHINE =====================
enum RelayState {
  RELAY_IDLE,
  RELAY_PULSE_ON
};

RelayState relayState = RELAY_IDLE;
unsigned long relayStateStartMs = 0;

// ===================== SERVO STATE MACHINE =====================
enum ServoState {
  SERVO_IDLE,
  SERVO_WAIT_PUSH,
  SERVO_HOLD_PUSH
};

ServoState servoState = SERVO_IDLE;
unsigned long servoStateStartMs = 0;

// ===================== HELPER =====================
bool isObjectDetected(int pin) {
  int state = digitalRead(pin);
  return SENSOR_ACTIVE_HIGH ? (state == HIGH) : (state == LOW);
}

bool isButtonPressed(int pin) {
  int state = digitalRead(pin);
  return BUTTON_ACTIVE_LOW ? (state == LOW) : (state == HIGH);
}

bool isEStopPressed() {
  return digitalRead(PIN_ESTOP) == LOW;
}

void setRelay(bool on) {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(PIN_RELAY, on ? HIGH : LOW);
  } else {
    digitalWrite(PIN_RELAY, on ? LOW : HIGH);
  }
}

void buzzerOn() {
  digitalWrite(PIN_BUZZER, HIGH);
}

void buzzerOff() {
  digitalWrite(PIN_BUZZER, LOW);
}

void ledWrite(int pin, bool on) {
  digitalWrite(pin, (LED_ACTIVE_HIGH ? on : !on) ? HIGH : LOW);
}

void allLedsOff() {
  ledWrite(PIN_LED_RED, false);
  ledWrite(PIN_LED_YELLOW, false);
  ledWrite(PIN_LED_GREEN, false);
}

int getMotorSpeedFromPot() {
  int potValue = analogRead(PIN_POT);   // 0 -> 1023

  // Vặn về thấp đủ thì dừng hẳn
  if (potValue <= MOTOR_STOP_THRESHOLD) {
    return 0;
  }

  // Từ sau ngưỡng mới map lên vùng PWM có ích
  int pwmValue = map(
    potValue,
    MOTOR_STOP_THRESHOLD,
    1023,
    MOTOR_MIN_PWM,
    MOTOR_MAX_PWM
  );

  return constrain(pwmValue, MOTOR_MIN_PWM, MOTOR_MAX_PWM);
}

void motorForward(int pwmValue) {
  pwmValue = constrain(pwmValue, 0, 255);
  digitalWrite(PIN_IN3, HIGH);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, pwmValue);
}

void motorStop() {
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, 0);
}

void servoHome() {
  gatServo.write(SERVO_HOME_ANGLE);
}

void clearQueue() {
  qHead = 0;
  qTail = 0;
  qCount = 0;
}

bool enqueueResult(int value) {
  if (qCount >= QUEUE_SIZE) return false;

  resultQueue[qTail] = value;
  qTail = (qTail + 1) % QUEUE_SIZE;
  qCount++;
  return true;
}

bool dequeueResult(int &value) {
  if (qCount <= 0) return false;

  value = resultQueue[qHead];
  qHead = (qHead + 1) % QUEUE_SIZE;
  qCount--;
  return true;
}

void printQueue() {
  Serial.print("Queue: [");
  for (int i = 0; i < qCount; i++) {
    int idx = (qHead + i) % QUEUE_SIZE;
    Serial.print(resultQueue[idx]);
    if (i < qCount - 1) Serial.print(", ");
  }
  Serial.println("]");
}

// ===================== RELAY NON-BLOCKING =====================
void startRelayPulse() {
  if (relayState != RELAY_IDLE) {
    Serial.println("WARN: Relay dang ban, bo qua pulse moi");
    return;
  }

  setRelay(true);
  relayState = RELAY_PULSE_ON;
  relayStateStartMs = millis();

  Serial.println("RELAY: ON");
}

void cancelRelayPulse() {
  setRelay(false);
  relayState = RELAY_IDLE;
}

void updateRelay() {
  unsigned long now = millis();

  switch (relayState) {
    case RELAY_IDLE:
      break;

    case RELAY_PULSE_ON:
      if (now - relayStateStartMs >= RELAY_PULSE_MS) {
        setRelay(false);
        relayState = RELAY_IDLE;
        Serial.println("RELAY: OFF");
      }
      break;
  }
}

// ===================== SERVO NON-BLOCKING =====================
void startServoPushSequence() {
  if (servoState != SERVO_IDLE) {
    Serial.println("WARN: Servo dang ban, bo qua lenh gat moi");
    return;
  }

  servoState = SERVO_WAIT_PUSH;
  servoStateStartMs = millis();

  Serial.println("SERVO: Start push sequence");
}

void cancelServoSequence() {
  servoState = SERVO_IDLE;
  servoHome();
}

void updateServo() {
  unsigned long now = millis();

  switch (servoState) {
    case SERVO_IDLE:
      break;

    case SERVO_WAIT_PUSH:
      if (now - servoStateStartMs >= SERVO_PRE_DELAY_MS) {
        gatServo.write(SERVO_PUSH_ANGLE);
        servoState = SERVO_HOLD_PUSH;
        servoStateStartMs = now;
        Serial.println("SERVO: PUSH");
      }
      break;

    case SERVO_HOLD_PUSH:
      if (now - servoStateStartMs >= SERVO_HOLD_MS) {
        gatServo.write(SERVO_HOME_ANGLE);
        servoState = SERVO_IDLE;
        Serial.println("SERVO: HOME");
      }
      break;
  }
}

// ===================== STATE ACTIONS =====================
void startSystem() {
  if (systemState == STOPPED) {
    systemState = RUNNING;
    Serial.println("START: He thong bat dau chay.");
  }
}

void stopSystem() {
  if (systemState == RUNNING) {
    systemState = STOPPED;
    motorStop();
    cancelRelayPulse();
    cancelServoSequence();
    buzzerOff();
    Serial.println("STOP: He thong dung.");
  }
}

void emergencyStopSystem() {
  if (systemState != EMERGENCY_STOP) {
    systemState = EMERGENCY_STOP;

    motorStop();
    cancelRelayPulse();
    cancelServoSequence();

    // Xoa queue de tranh lech trang thai sau su co
    clearQueue();

    Serial.println("EMERGENCY STOP: Dung khan cap!");
  }
}

void releaseEmergencyStopToStopped() {
  // Nha E-stop KHONG tu chay lai
  // Chi ve STOPPED, phai bam START moi chay
  if (systemState == EMERGENCY_STOP) {
    systemState = STOPPED;
    motorStop();
    cancelRelayPulse();
    cancelServoSequence();
    buzzerOff();
    Serial.println("E-STOP RESET: He thong ve STOPPED. Can bam START de chay lai.");
  }
}

// ===================== INDICATOR UPDATE =====================
void updateIndicators() {
  unsigned long now = millis();

  switch (systemState) {
    case RUNNING:
      ledWrite(PIN_LED_RED, false);
      ledWrite(PIN_LED_YELLOW, false);
      ledWrite(PIN_LED_GREEN, true);
      buzzerOff();
      break;

    case STOPPED:
      ledWrite(PIN_LED_RED, false);
      ledWrite(PIN_LED_YELLOW, true);
      ledWrite(PIN_LED_GREEN, false);
      buzzerOff();
      break;

    case EMERGENCY_STOP:
      if (now - lastIndicatorToggle >= ESTOP_BLINK_MS) {
        lastIndicatorToggle = now;
        estopBlinkState = !estopBlinkState;
      }

      ledWrite(PIN_LED_RED, estopBlinkState);
      ledWrite(PIN_LED_YELLOW, false);
      ledWrite(PIN_LED_GREEN, false);

      if (estopBlinkState) buzzerOn();
      else buzzerOff();
      break;
  }
}

// ===================== SERIAL RECEIVE =====================
void handleSerialInput() {
  static String rxBuffer = "";

  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      rxBuffer.trim();

      if (rxBuffer.length() > 0) {
        if (rxBuffer == "0" || rxBuffer == "1") {
          int value = rxBuffer.toInt();

          if (enqueueResult(value)) {
            Serial.print("Nhan tu Python: ");
            Serial.println(value);
            printQueue();
          } else {
            Serial.println("Queue day, khong them duoc.");
          }
        }
        else if (rxBuffer.equalsIgnoreCase("START")) {
          startSystem();
        }
        else if (rxBuffer.equalsIgnoreCase("STOP")) {
          stopSystem();
        }
        else {
          Serial.print("WARN: Lenh khong hop le: ");
          Serial.println(rxBuffer);
        }
      }

      rxBuffer = "";
    } else {
      rxBuffer += c;
    }
  }
}

// ===================== BUTTON HANDLE =====================
void handleButtons() {
  bool startPressed = isButtonPressed(PIN_BTN_START);
  bool stopPressed  = isButtonPressed(PIN_BTN_STOP);

  unsigned long now = millis();

  if (now - lastButtonTime >= BUTTON_DEBOUNCE_MS) {
    if (startPressed && !lastStartPressed) {
      startSystem();
      lastButtonTime = now;
    }

    if (stopPressed && !lastStopPressed) {
      stopSystem();
      lastButtonTime = now;
    }
  }

  lastStartPressed = startPressed;
  lastStopPressed  = stopPressed;
}

// ===================== E-STOP HANDLE =====================
void handleEStop() {
  bool estopPressed = isEStopPressed();

  // Canh nhan
  if (estopPressed && !lastEStopPressed) {
    emergencyStopSystem();
  }

  // Canh nha
  if (!estopPressed && lastEStopPressed) {
    releaseEmergencyStopToStopped();
  }

  lastEStopPressed = estopPressed;
}

// ===================== SENSOR HANDLE =====================
void handleSensors() {
  bool sensor1Detected = isObjectDetected(PIN_SENSOR1);
  bool sensor2Detected = isObjectDetected(PIN_SENSOR2);
  unsigned long now = millis();

  if (systemState == RUNNING) {
    // Cam bien 1 phat hien vat -> kich relay 1 xung
    if (sensor1Detected && !lastSensor1Detected) {
      if (now - lastSensor1TriggerTime >= SENSOR1_DEBOUNCE_MS) {
        lastSensor1TriggerTime = now;
        Serial.println("Sensor 1: Phat hien vat -> kich relay");
        startRelayPulse();
      }
    }

    // Cam bien 2 phat hien vat -> doc queue roi quyet dinh gat
    if (sensor2Detected && !lastSensor2Detected) {
      if (now - lastSensor2TriggerTime >= SENSOR2_DEBOUNCE_MS) {
        lastSensor2TriggerTime = now;

        int resultValue;
        if (dequeueResult(resultValue)) {
          Serial.print("Lay tu queue: ");
          Serial.println(resultValue);
          printQueue();

          if (resultValue == 1) {
            Serial.println("Sensor 2: NG -> servo gat");
            startServoPushSequence();
          } else {
            Serial.println("Sensor 2: OK -> khong gat");
          }
        } else {
          Serial.println("Sensor 2: Queue rong -> khong gat");
        }
      }
    }
  }

  lastSensor1Detected = sensor1Detected;
  lastSensor2Detected = sensor2Detected;
}

// ===================== MOTOR UPDATE =====================
void updateMotor() {
  if (systemState == RUNNING) {
    int motorSpeed = getMotorSpeedFromPot();

    if (motorSpeed == 0) {
      motorStop();
    } else {
      motorForward(motorSpeed);
    }
  } else {
    motorStop();
  }
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(9600);

  pinMode(PIN_SENSOR1, INPUT);
  pinMode(PIN_SENSOR2, INPUT);

  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_ENB, OUTPUT);

  pinMode(PIN_RELAY, OUTPUT);

  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP, INPUT_PULLUP);
  pinMode(PIN_ESTOP, INPUT_PULLUP);

  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);

  pinMode(PIN_BUZZER, OUTPUT);

  gatServo.attach(PIN_SERVO);
  gatServo.write(SERVO_HOME_ANGLE);

  setRelay(false);
  motorStop();
  buzzerOff();
  allLedsOff();

  systemState = STOPPED;
  updateIndicators();

  Serial.println("=== Arduino Reject System Start ===");
  Serial.println("Trang thai ban dau: STOPPED");
  Serial.print("SERVO_HOME_ANGLE = ");
  Serial.println(SERVO_HOME_ANGLE);
  Serial.print("SERVO_PUSH_ANGLE = ");
  Serial.println(SERVO_PUSH_ANGLE);
  Serial.print("SERVO_PRE_DELAY_MS = ");
  Serial.println(SERVO_PRE_DELAY_MS);
  Serial.print("SERVO_HOLD_MS = ");
  Serial.println(SERVO_HOLD_MS);
  Serial.println("Nhan START/STOP bang nut nhan hoac Serial.");
  Serial.println("Nhan 0/1 tu Python.");
  Serial.println("B10K o A2 de dieu chinh toc do.");
  Serial.println("B10K ve min duoc phep dung bang tai.");
  Serial.println("E-STOP o A5: nhan -> EMERGENCY_STOP, nha -> STOPPED, phai bam START lai.");
}

// ===================== LOOP =====================
void loop() {
  handleEStop();        // uu tien cao nhat
  updateIndicators();   // den + buzzer
  handleSerialInput();  // doc serial tu Python / lenh
  handleButtons();      // start / stop
  updateMotor();        // cap nhat toc do motor
  handleSensors();      // sensor1 / sensor2
  updateRelay();        // relay non-blocking
  updateServo();        // servo non-blocking

  delay(5);
}