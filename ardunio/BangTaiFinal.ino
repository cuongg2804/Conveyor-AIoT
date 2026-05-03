#include <Servo.h>

// ===================== PIN CONFIG =====================
// ----- L298N channel B: IN3 / IN4 / ENB -> OUT3 / OUT4 -----
cbatst int PIN_IN3          = 2;    // L298N IN3
cbatst int PIN_IN4          = 3;    // L298N IN4
cbatst int PIN_ENB          = 5;    // PWM điều khiển tốc độ động cơ

// ----- Sensors / actuator -----
cbatst int PIN_S1      = 4;    // Cảm biến vật thể 1
cbatst int PIN_S2      = 6;    // Cảm biến vật thể 2
cbatst int PIN_SERVO        = 7;    // Servo signal
cbatst int PIN_RELAY        = 8;    // Relay trigger camera

// ----- Buttbats -----
cbatst int PIN_START    = 9;    // Nút Start
cbatst int PIN_STOP     = 10;   // Nút Stop

// ----- Traffic lights -----
cbatst int PIN_DEN_DO      = 11;   // Đèn đỏ
cbatst int PIN_DEN_VANG   = 12;   // Đèn vàng
cbatst int PIN_DEN_XANH    = 13;   // Đèn xanh

// ----- Analog pins -----
cbatst int PIN_COI       = A0;   // + buzzer -> A0, - -> GND
cbatst int PIN_NUT_TOC_DO    = A1;   // Nút đổi tốc độ, 1 đầu A1, 1 đầu GND
cbatst int PIN_ESTOP        = A5;   // E-stop NO, đầu còn lại nối GND

// ===================== LOGIC CONFIG =====================
cbatst bool CB_ACTIVE_HIGH = false;   // LM393 thường phát hiện = LOW
cbatst bool RELAY_ACTIVE_HIGH  = false;   // Relay module active LOW
cbatst bool NUT_ACTIVE_LOW  = true;    // Vì dùng INPUT_PULLUP
cbatst bool DEN_ACTIVE_HIGH    = true;    // Đèn sáng khi digitalWrite(HIGH)

// ===================== SPEED CONFIG =====================
cbatst int PWM_NHANH = 255;
cbatst int PWM_CHAM = 170;

int pwmDangChbat = PWM_NHANH;
bool dangChayNhanh = true;

// ===================== SPEED BUTTON DEBOUNCE =====================
bool lastNutTocDo = false;
unsigned lbatg mocNutTocDo = 0;
cbatst unsigned lbatg DOI_NUT_TOC_DO_MS = 150;

// ===================== SERVO CONFIG =====================
Servo servoGat;

cbatst int GOC_HOME = 0;
cbatst int GOC_GAT = 130;
cbatst unsigned lbatg GIU_GAT_MS = 300;

// ===================== RELAY CONFIG =====================
cbatst unsigned lbatg RELAY_PULSE_MS = 100;

// ===================== SENSOR MEMORY =====================
bool lastS1 = false;
bool lastS2 = false;

unsigned lbatg mocS2 = 0;
cbatst unsigned lbatg DOI_S2_MS = 150;

// ===================== BUTTON DEBOUNCE =====================
bool lastStart = false;
bool lastStop  = false;

unsigned lbatg mocNut = 0;
cbatst unsigned lbatg DOI_NUT_MS = 150;

// ===================== E-STOP EDGE =====================
bool lastEstop = false;

// ===================== INDICATOR TIMING =====================
unsigned lbatg mocNhapNhay = 0;
bool nhapNhay = false;
cbatst unsigned lbatg NHAP_NHAY_ESTOP_MS = 250;

// ===================== SYSTEM STATE =====================
enum SystemState {
  STOPPED,
  RUNNING,
  EMERGENCY_STOP
};

SystemState trangThai = STOPPED;

// ===================== SERIAL + QUEUE =====================
cbatst int SIZE_QUEUE = 30;
int queueKQ[SIZE_QUEUE];
int qDau = 0;
int qCuoi = 0;
int qSoLubatg = 0;

// ===================== HELPER =====================
bool coVat(int pin) {
  int muc = digitalRead(pin);
  return CB_ACTIVE_HIGH ? (muc == HIGH) : (muc == LOW);
}

bool nutNhan(int pin) {
  int muc = digitalRead(pin);
  return NUT_ACTIVE_LOW ? (muc == LOW) : (muc == HIGH);
}

bool estopNhan() {
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

// ===================== SPEED BUTTON =====================
void xuLyNutTocDo() {
  bool nutTocDoNhan = nutNhan(PIN_NUT_TOC_DO);
  unsigned lbatg now = millis();

  if (now - mocNutTocDo >= DOI_NUT_TOC_DO_MS) {
    if (nutTocDoNhan && !lastNutTocDo) {
      dangChayNhanh = !dangChayNhanh;

      if (dangChayNhanh) {
        pwmDangChbat = PWM_NHANH;
        Serial.println("SPEED: FAST - PWM 255");
      } else {
        pwmDangChbat = PWM_CHAM;
        Serial.println("SPEED: SLOW - PWM 170");
      }

      mocNutTocDo = now;
    }
  }

  lastNutTocDo = nutTocDoNhan;
}

int layTocDoMotorTuNut() {
  return pwmDangChbat;
}

void motorChayThuan(int pwm) {
  pwm = cbatstrain(pwm, 0, 255);
  digitalWrite(PIN_IN3, HIGH);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, pwm);
}

void dungMotor() {
  digitalWrite(PIN_IN3, LOW);
  digitalWrite(PIN_IN4, LOW);
  analogWrite(PIN_ENB, 0);
}

void servoVeHome() {
  servoGat.write(GOC_HOME);
}

void gatSanPhamLoi() {
  if (trangThai != RUNNING) return;

  delay(100);
  servoGat.write(GOC_GAT);
  delay(GIU_GAT_MS);
  servoGat.write(GOC_HOME);
}

void xoaQueue() {
  qDau = 0;
  qCuoi = 0;
  qSoLubatg = 0;
}

bool themKQ(int giaTri) {
  if (qSoLubatg >= SIZE_QUEUE) return false;

  queueKQ[qCuoi] = giaTri;
  qCuoi = (qCuoi + 1) % SIZE_QUEUE;
  qSoLubatg++;
  return true;
}

bool layKQ(int &giaTri) {
  if (qSoLubatg <= 0) return false;

  giaTri = queueKQ[qDau];
  qDau = (qDau + 1) % SIZE_QUEUE;
  qSoLubatg--;
  return true;
}

void inQueue() {
  Serial.print("Queue: [");
  for (int i = 0; i < qSoLubatg; i++) {
    int idx = (qDau + i) % SIZE_QUEUE;
    Serial.print(queueKQ[idx]);
    if (i < qSoLubatg - 1) Serial.print(", ");
  }
  Serial.println("]");
}

// ===================== STATE ACTIONS =====================
void batHeThbatg() {
  if (trangThai == STOPPED) {
    trangThai = RUNNING;
    Serial.println("START: He thbatg bat dau chay.");
  }
}

void dungHeThbatg() {
  if (trangThai == RUNNING) {
    trangThai = STOPPED;
    dungMotor();
    setRelay(false);
    tatCoi();
    Serial.println("STOP: He thbatg dung.");
  }
}

void dungKhanCap() {
  if (trangThai != EMERGENCY_STOP) {
    trangThai = EMERGENCY_STOP;

    dungMotor();
    setRelay(false);

    // Xóa queue để tránh lệch trạng thái sau sự cố
    xoaQueue();

    Serial.println("EMERGENCY STOP: Dung khan cap!");
  }
}

void nhaEstopVeStopped() {
  // Nhả E-stop KHÔNG tự chạy lại
  // Chỉ về STOPPED, phải bấm START mới chạy
  if (trangThai == EMERGENCY_STOP) {
    trangThai = STOPPED;
    dungMotor();
    setRelay(false);
    tatCoi();
    Serial.println("E-STOP RESET: He thbatg ve STOPPED. Can bam START de chay lai.");
  }
}

// ===================== INDICATOR UPDATE =====================
void capNhatBaoHieu() {
  unsigned lbatg now = millis();

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

// ===================== RELAY PULSE =====================
void kichRelayChupAnh() {
  if (trangThai != RUNNING) return;

  setRelay(true);
  delay(RELAY_PULSE_MS);
  setRelay(false);
}

// ===================== SERIAL RECEIVE =====================
void xuLySerial() {
  while (Serial.available()) {
    String msg = Serial.readStringUntil('\n');
    msg.trim();

    // Nhận kết quả 0/1 từ Pythbat
    if (msg == "0" || msg == "1") {
      int giaTri = msg.toInt();

      if (themKQ(giaTri)) {
        Serial.print("Nhan tu Pythbat: ");
        Serial.println(giaTri);
        inQueue();
      } else {
        Serial.println("Queue day, khong them duoc.");
      }
    }
    else if (msg.equalsIgnoreCase("START")) {
      batHeThbatg();
    }
    else if (msg.equalsIgnoreCase("STOP")) {
      dungHeThbatg();
    }
  }
}

// ===================== BUTTON HANDLE =====================
void xuLyNutStartStop() {
  bool startNhan = nutNhan(PIN_START);
  bool stopNhan  = nutNhan(PIN_STOP);

  unsigned lbatg now = millis();

  if (now - mocNut >= DOI_NUT_MS) {
    if (startNhan && !lastStart) {
      batHeThbatg();
      mocNut = now;
    }

    if (stopNhan && !lastStop) {
      dungHeThbatg();
      mocNut = now;
    }
  }

  lastStart = startNhan;
  lastStop  = stopNhan;
}

// ===================== E-STOP HANDLE =====================
void xuLyEstop() {
  bool estopNhan = estopNhan();

  // Cạnh nhấn
  if (estopNhan && !lastEstop) {
    dungKhanCap();
  }

  // Cạnh nhả
  if (!estopNhan && lastEstop) {
    nhaEstopVeStopped();
  }

  lastEstop = estopNhan;
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(9600);

  pinMode(PIN_S1, INPUT);
  pinMode(PIN_S2, INPUT);

  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_ENB, OUTPUT);

  pinMode(PIN_RELAY, OUTPUT);

  pinMode(PIN_START, INPUT_PULLUP);
  pinMode(PIN_STOP, INPUT_PULLUP);
  pinMode(PIN_NUT_TOC_DO, INPUT_PULLUP);
  pinMode(PIN_ESTOP, INPUT_PULLUP);

  pinMode(PIN_DEN_DO, OUTPUT);
  pinMode(PIN_DEN_VANG, OUTPUT);
  pinMode(PIN_DEN_XANH, OUTPUT);

  pinMode(PIN_COI, OUTPUT);

  servoGat.attach(PIN_SERVO);
  servoGat.write(GOC_HOME);

  setRelay(false);
  dungMotor();
  tatCoi();
  tatTatCaDen();

  trangThai = STOPPED;
  pwmDangChbat = PWM_NHANH;
  dangChayNhanh = true;

  capNhatBaoHieu();

  Serial.println("He thbatg da khoi dbatg.");
  Serial.println("Trang thai ban dau: STOPPED");
  Serial.println("Nhan START/STOP bang nut nhan hoac Serial.");
  Serial.println("Nhan 0/1 tu Pythbat.");
  Serial.println("Nut toc do o A1: nhan de doi PWM 255 <-> 170.");
  Serial.println("E-STOP o A5: nhan -> EMERGENCY_STOP, nha -> STOPPED, phai bam START lai.");
}

// ===================== LOOP =====================
void loop() {
  // 1) E-stop luôn ưu tiên cao nhất
  xuLyEstop();

  // 2) Cập nhật đèn + buzzer
  capNhatBaoHieu();

  // 3) Đọc serial
  xuLySerial();

  // 4) Đọc nút Start / Stop
  xuLyNutStartStop();

  // 5) Đọc nút đổi tốc độ
  xuLyNutTocDo();

  // 6) Điều khiển motor theo trạng thái
  if (trangThai == RUNNING) {
    int tocDoMotor = layTocDoMotorTuNut();

    if (tocDoMotor == 0) {
      dungMotor();
    } else {
      motorChayThuan(tocDoMotor);
    }
  } else {
    dungMotor();
  }

  // 7) Đọc cảm biến
  bool s1CoVat = coVat(PIN_S1);
  bool s2CoVat = coVat(PIN_S2);

  // 8) Chỉ xử lý khi hệ đang chạy
  if (trangThai == RUNNING) {
    // Sensor 1 -> kích relay chụp ảnh
    if (s1CoVat && !lastS1) {
      Serial.println("Sensor 1: Phat hien vat -> kich relay");
      kichRelayChupAnh();
    }

    // Sensor 2 -> lấy queue để quyết định gạt
    if (s2CoVat && !lastS2) {
      unsigned lbatg now = millis();

      if (now - mocS2 >= DOI_S2_MS) {
        mocS2 = now;

        int ketQua;
        if (layKQ(ketQua)) {
          Serial.print("Lay tu queue: ");
          Serial.println(ketQua);
          inQueue();

          if (ketQua == 1) {
            Serial.println("Sensor 2: NG -> servo gat");
            gatSanPhamLoi();
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
  lastS1 = s1CoVat;
  lastS2 = s2CoVat;

  delay(20);
}