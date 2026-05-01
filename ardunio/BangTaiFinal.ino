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
const int PIN_BTN_SPEED    = A1;   // Nút đổi tốc độ, 1 đầu A1, 1 đầu GND
const int PIN_ESTOP        = A5;   // E-stop NO, đầu còn lại nối GND

// ===================== LOGIC CONFIG =====================
const bool SENSOR_ACTIVE_HIGH = false;   // LM393 thường phát hiện = LOW
const bool RELAY_ACTIVE_HIGH  = false;   // Relay module active LOW
const bool BUTTON_ACTIVE_LOW  = true;    // Vì dùng INPUT_PULLUP
const bool LED_ACTIVE_HIGH    = true;    // Đèn sáng khi digitalWrite(HIGH)

// ===================== SPEED CONFIG =====================
const int MOTOR_PWM_FAST = 255;
const int MOTOR_PWM_SLOW = 170;

int currentMotorPWM = MOTOR_PWM_FAST;
bool speedFastMode = true;

// ===================== SPEED BUTTON DEBOUNCE =====================
bool lastSpeedPressed = false;
unsigned long lastSpeedButtonTime = 0;
const unsigned long SPEED_BUTTON_DEBOUNCE_MS = 150;

// ===================== SERVO CONFIG =====================
Servo gatServo;

const int SERVO_HOME_ANGLE = 0;
const int SERVO_PUSH_ANGLE = 130;
const unsigned long SERVO_HOLD_MS = 300;

// ===================== RELAY CONFIG =====================
const unsigned long RELAY_PULSE_MS = 100;

// ===================== SENSOR MEMORY =====================
bool lastSensor1Detected = false;
bool lastSensor2Detected = false;

unsigned long lastSensor2TriggerTime = 0;
const unsigned long SENSOR2_DEBOUNCE_MS = 150;

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

// ===================== SPEED BUTTON =====================
void handleSpeedButton() {
  bool speedPressed = isButtonPressed(PIN_BTN_SPEED);
  unsigned long now = millis();

  if (now - lastSpeedButtonTime >= SPEED_BUTTON_DEBOUNCE_MS) {
    if (speedPressed && !lastSpeedPressed) {
      speedFastMode = !speedFastMode;

      if (speedFastMode) {
        currentMotorPWM = MOTOR_PWM_FAST;
        Serial.println("SPEED: FAST - PWM 255");
      } else {
        currentMotorPWM = MOTOR_PWM_SLOW;
        Serial.println("SPEED: SLOW - PWM 170");
      }

      lastSpeedButtonTime = now;
    }
  }

  lastSpeedPressed = speedPressed;
}

int getMotorSpeedFromButton() {
  return currentMotorPWM;
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

void servoGatePush() {
  if (systemState != RUNNING) return;

  delay(100);
  gatServo.write(SERVO_PUSH_ANGLE);
  delay(SERVO_HOLD_MS);
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
    setRelay(false);
    buzzerOff();
    Serial.println("STOP: He thong dung.");
  }
}

void emergencyStopSystem() {
  if (systemState != EMERGENCY_STOP) {
    systemState = EMERGENCY_STOP;

    motorStop();
    setRelay(false);

    // Xóa queue để tránh lệch trạng thái sau sự cố
    clearQueue();

    Serial.println("EMERGENCY STOP: Dung khan cap!");
  }
}

void releaseEmergencyStopToStopped() {
  // Nhả E-stop KHÔNG tự chạy lại
  // Chỉ về STOPPED, phải bấm START mới chạy
  if (systemState == EMERGENCY_STOP) {
    systemState = STOPPED;
    motorStop();
    setRelay(false);
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

// ===================== RELAY PULSE =====================
void triggerRelayPulse() {
  if (systemState != RUNNING) return;

  setRelay(true);
  delay(RELAY_PULSE_MS);
  setRelay(false);
}

// ===================== SERIAL RECEIVE =====================
void handleSerialInput() {
  while (Serial.available()) {
    String msg = Serial.readStringUntil('\n');
    msg.trim();

    // Nhận kết quả 0/1 từ Python
    if (msg == "0" || msg == "1") {
      int value = msg.toInt();

      if (enqueueResult(value)) {
        Serial.print("Nhan tu Python: ");
        Serial.println(value);
        printQueue();
      } else {
        Serial.println("Queue day, khong them duoc.");
      }
    }
    else if (msg.equalsIgnoreCase("START")) {
      startSystem();
    }
    else if (msg.equalsIgnoreCase("STOP")) {
      stopSystem();
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

  // Cạnh nhấn
  if (estopPressed && !lastEStopPressed) {
    emergencyStopSystem();
  }

  // Cạnh nhả
  if (!estopPressed && lastEStopPressed) {
    releaseEmergencyStopToStopped();
  }

  lastEStopPressed = estopPressed;
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
  pinMode(PIN_BTN_SPEED, INPUT_PULLUP);
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
  currentMotorPWM = MOTOR_PWM_FAST;
  speedFastMode = true;

  updateIndicators();

  Serial.println("He thong da khoi dong.");
  Serial.println("Trang thai ban dau: STOPPED");
  Serial.println("Nhan START/STOP bang nut nhan hoac Serial.");
  Serial.println("Nhan 0/1 tu Python.");
  Serial.println("Nut toc do o A1: nhan de doi PWM 255 <-> 170.");
  Serial.println("E-STOP o A5: nhan -> EMERGENCY_STOP, nha -> STOPPED, phai bam START lai.");
}

// ===================== LOOP =====================
void loop() {
  // 1) E-stop luôn ưu tiên cao nhất
  handleEStop();

  // 2) Cập nhật đèn + buzzer
  updateIndicators();

  // 3) Đọc serial
  handleSerialInput();

  // 4) Đọc nút Start / Stop
  handleButtons();

  // 5) Đọc nút đổi tốc độ
  handleSpeedButton();

  // 6) Điều khiển motor theo trạng thái
  if (systemState == RUNNING) {
    int motorSpeed = getMotorSpeedFromButton();

    if (motorSpeed == 0) {
      motorStop();
    } else {
      motorForward(motorSpeed);
    }
  } else {
    motorStop();
  }

  // 7) Đọc cảm biến
  bool sensor1Detected = isObjectDetected(PIN_SENSOR1);
  bool sensor2Detected = isObjectDetected(PIN_SENSOR2);

  // 8) Chỉ xử lý khi hệ đang chạy
  if (systemState == RUNNING) {
    // Sensor 1 -> kích relay chụp ảnh
    if (sensor1Detected && !lastSensor1Detected) {
      Serial.println("Sensor 1: Phat hien vat -> kich relay");
      triggerRelayPulse();
    }

    // Sensor 2 -> lấy queue để quyết định gạt
    if (sensor2Detected && !lastSensor2Detected) {
      unsigned long now = millis();

      if (now - lastSensor2TriggerTime >= SENSOR2_DEBOUNCE_MS) {
        lastSensor2TriggerTime = now;

        int resultValue;
        if (dequeueResult(resultValue)) {
          Serial.print("Lay tu queue: ");
          Serial.println(resultValue);
          printQueue();

          if (resultValue == 1) {
            Serial.println("Sensor 2: NG -> servo gat");
            servoGatePush();
          } else {
            Serial.println("Sensor 2: OK -> khong gat");
          }
        } else {
          Serial.println("Sensor 2: Queue rong -> khong gat");
        }
      }
    }
  }

  // 9) Lưu trạng thái cảm biến trước đó
  lastSensor1Detected = sensor1Detected;
  lastSensor2Detected = sensor2Detected;

  delay(20);
}