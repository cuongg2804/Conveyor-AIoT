#include <Servo.h>

// ===================== CHAN KET NOI =====================
const int IN3 = 2;
const int IN4 = 3;
const int ENB = 5;

const int S1 = 4;
const int S2 = 6;
const int CHAN_SERVO = 7;
const int RELAY = 8;

const int NUT_START = 9;
const int NUT_STOP  = 10;

const int DEN_DO    = 11;
const int DEN_VANG  = 12;
const int DEN_XANH  = 13;

const int COI       = A0;
const int BIEN_TRO  = A1;
const int ESTOP     = A5;

// ===================== CAU HINH LOGIC =====================
const bool S_ACTIVE_HIGH     = false;  // LM393 thuong phat hien = LOW
const bool RELAY_ACTIVE_HIGH = false;  // Relay active LOW
const bool NUT_ACTIVE_LOW    = true;   // INPUT_PULLUP
const bool DEN_ACTIVE_HIGH   = true;

// ===================== CAU HINH MOTOR =====================
const int NGUONG_DUNG = 35;
const int PWM_MIN = 120;
const int PWM_MAX = 255;

// ===================== CAU HINH SERVO =====================
Servo servoGat;

const int GOC_HOME = 0;
const int GOC_GAT  = 120;

const unsigned long TRE_GAT_MS = 50;
const unsigned long GIU_GAT_MS = 300;

// ===================== THOI GIAN =====================
const unsigned long RELAY_MS = 100;
const unsigned long DOI_S1_MS = 80;
const unsigned long DOI_S2_MS = 50;
const unsigned long DOI_NUT_MS = 150;
const unsigned long NHAP_NHAY_MS = 250;

// ===================== TRANG THAI HE THONG =====================
enum TrangThai {
  DUNG,
  CHAY,
  KHAN_CAP
};

TrangThai trangThai = DUNG;

// ===================== HANG DOI KET QUA AI =====================
const int SIZE_HANG_DOI = 30;
int hangDoi[SIZE_HANG_DOI];

int dau = 0;
int cuoi = 0;
int soLuong = 0;

// ===================== TRANG THAI RELAY =====================
enum TT_Relay {
  RELAY_RANH,
  RELAY_DANG_BAT
};

TT_Relay ttRelay = RELAY_RANH;
unsigned long mocRelay = 0;

// ===================== TRANG THAI SERVO =====================
enum TT_Servo {
  SERVO_RANH,
  SERVO_CHO_GAT,
  SERVO_GIU_GAT
};

TT_Servo ttServo = SERVO_RANH;
unsigned long mocServo = 0;

// ===================== BIEN CHONG DOI =====================
bool truocS1 = false;
bool truocS2 = false;
bool truocStart = false;
bool truocStop = false;
bool truocEstop = false;

unsigned long mocS1 = 0;
unsigned long mocS2 = 0;
unsigned long mocNut = 0;

// ===================== DEN / COI =====================
unsigned long mocBaoHieu = 0;
bool nhapNhay = false;

// ===================== HAM DOC TIN HIEU =====================
bool coVat(int chan) {
  int muc = digitalRead(chan);
  return S_ACTIVE_HIGH ? (muc == HIGH) : (muc == LOW);
}

bool nutNhan(int chan) {
  int muc = digitalRead(chan);
  return NUT_ACTIVE_LOW ? (muc == LOW) : (muc == HIGH);
}

bool estopNhan() {
  return digitalRead(ESTOP) == LOW;
}

bool quaDoi(unsigned long &moc, unsigned long doiMs) {
  unsigned long now = millis();

  if (now - moc >= doiMs) {
    moc = now;
    return true;
  }

  return false;
}

// ===================== DEN / COI / RELAY =====================
void ghiDen(int chan, bool bat) {
  digitalWrite(chan, (DEN_ACTIVE_HIGH ? bat : !bat) ? HIGH : LOW);
}

void setDen(bool doBat, bool vangBat, bool xanhBat) {
  ghiDen(DEN_DO, doBat);
  ghiDen(DEN_VANG, vangBat);
  ghiDen(DEN_XANH, xanhBat);
}

void batCoi() {
  digitalWrite(COI, HIGH);
}

void tatCoi() {
  digitalWrite(COI, LOW);
}

void setRelay(bool bat) {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(RELAY, bat ? HIGH : LOW);
  } else {
    digitalWrite(RELAY, bat ? LOW : HIGH);
  }
}

// ===================== MOTOR =====================
int docTocDo() {
  int val = analogRead(BIEN_TRO);

  if (val <= NGUONG_DUNG) return 0;

  int pwm = map(val, NGUONG_DUNG, 1023, PWM_MIN, PWM_MAX);
  return constrain(pwm, PWM_MIN, PWM_MAX);
}

void motorChay(int pwm) {
  pwm = constrain(pwm, 0, 255);

  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  analogWrite(ENB, pwm);
}

void motorDung() {
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENB, 0);
}

void capNhatMotor() {
  if (trangThai != CHAY) {
    motorDung();
    return;
  }

  int tocDo = docTocDo();

  if (tocDo == 0) motorDung();
  else motorChay(tocDo);
}

// ===================== HANG DOI =====================
void xoaHangDoi() {
  dau = 0;
  cuoi = 0;
  soLuong = 0;
}

bool themKQ(int kq) {
  if (soLuong >= SIZE_HANG_DOI) return false;

  hangDoi[cuoi] = kq;
  cuoi = (cuoi + 1) % SIZE_HANG_DOI;
  soLuong++;

  return true;
}

bool layKQ(int &kq) {
  if (soLuong <= 0) return false;

  kq = hangDoi[dau];
  dau = (dau + 1) % SIZE_HANG_DOI;
  soLuong--;

  return true;
}

void inHangDoi() {
  Serial.print("Hang doi: [");

  for (int i = 0; i < soLuong; i++) {
    int idx = (dau + i) % SIZE_HANG_DOI;
    Serial.print(hangDoi[idx]);

    if (i < soLuong - 1) Serial.print(", ");
  }

  Serial.println("]");
}

// ===================== RELAY NON-BLOCKING =====================
void batDauRelay() {
  if (ttRelay != RELAY_RANH) {
    Serial.println("CANH BAO: Relay dang ban, bo qua xung moi");
    return;
  }

  setRelay(true);
  ttRelay = RELAY_DANG_BAT;
  mocRelay = millis();

  Serial.println("RELAY: BAT");
}

void huyRelay() {
  setRelay(false);
  ttRelay = RELAY_RANH;
}

void capNhatRelay() {
  if (ttRelay == RELAY_DANG_BAT && millis() - mocRelay >= RELAY_MS) {
    setRelay(false);
    ttRelay = RELAY_RANH;
    Serial.println("RELAY: TAT");
  }
}

// ===================== SERVO NON-BLOCKING =====================
void servoHome() {
  servoGat.write(GOC_HOME);
}

void batDauGat() {
  if (ttServo != SERVO_RANH) {
    Serial.println("CANH BAO: Servo dang ban, bo qua lenh gat moi");
    return;
  }

  ttServo = SERVO_CHO_GAT;
  mocServo = millis();

  Serial.println("SERVO: Bat dau chu trinh gat");
}

void huyServo() {
  ttServo = SERVO_RANH;
  servoHome();
}

void capNhatServo() {
  unsigned long now = millis();

  switch (ttServo) {
    case SERVO_RANH:
      break;

    case SERVO_CHO_GAT:
      if (now - mocServo >= TRE_GAT_MS) {
        servoGat.write(GOC_GAT);
        ttServo = SERVO_GIU_GAT;
        mocServo = now;
        Serial.println("SERVO: GAT");
      }
      break;

    case SERVO_GIU_GAT:
      if (now - mocServo >= GIU_GAT_MS) {
        servoHome();
        ttServo = SERVO_RANH;
        Serial.println("SERVO: HOME");
      }
      break;
  }
}

// ===================== DIEU KHIEN HE THONG =====================
void dungTatCa() {
  motorDung();
  huyRelay();
  huyServo();
  tatCoi();
}

void batHeThong() {
  if (trangThai == DUNG) {
    trangThai = CHAY;
    Serial.println("START: He thong bat dau chay.");
  }
}

void dungHeThong() {
  if (trangThai == CHAY) {
    trangThai = DUNG;
    dungTatCa();
    Serial.println("STOP: He thong dung.");
  }
}

void dungKhanCap() {
  if (trangThai == KHAN_CAP) return;

  trangThai = KHAN_CAP;
  dungTatCa();
  xoaHangDoi();

  Serial.println("DUNG KHAN CAP: He thong da dung!");
}

void nhaEstop() {
  if (trangThai != KHAN_CAP) return;

  trangThai = DUNG;
  dungTatCa();

  Serial.println("E-STOP RESET: He thong ve DUNG. Can bam START de chay lai.");
}

// ===================== BAO HIEU =====================
void capNhatBaoHieu() {
  unsigned long now = millis();

  switch (trangThai) {
    case CHAY:
      setDen(false, false, true);
      tatCoi();
      break;

    case DUNG:
      setDen(false, true, false);
      tatCoi();
      break;

    case KHAN_CAP:
      if (now - mocBaoHieu >= NHAP_NHAY_MS) {
        mocBaoHieu = now;
        nhapNhay = !nhapNhay;
      }

      setDen(nhapNhay, false, false);

      if (nhapNhay) batCoi();
      else tatCoi();
      break;
  }
}

// ===================== SERIAL =====================
void xuLyKetQuaAI(int kq) {
  if (themKQ(kq)) {
    Serial.print("Nhan tu Python: ");
    Serial.println(kq);
    inHangDoi();
  } else {
    Serial.println("Hang doi day, khong them duoc.");
  }
}

void xuLyLenh(String lenh) {
  lenh.trim();

  if (lenh == "0" || lenh == "1") {
    xuLyKetQuaAI(lenh.toInt());
    return;
  }

  if (lenh.equalsIgnoreCase("START")) {
    batHeThong();
    return;
  }

  if (lenh.equalsIgnoreCase("STOP")) {
    dungHeThong();
    return;
  }

  Serial.print("CANH BAO: Lenh khong hop le: ");
  Serial.println(lenh);
}

void docSerial() {
  static String boDem = "";

  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      if (boDem.length() > 0) xuLyLenh(boDem);
      boDem = "";
    } else {
      boDem += c;
    }
  }
}

// ===================== NUT NHAN / E-STOP =====================
void xuLyNut() {
  bool startNhan = nutNhan(NUT_START);
  bool stopNhan  = nutNhan(NUT_STOP);

  if (quaDoi(mocNut, DOI_NUT_MS)) {
    if (startNhan && !truocStart) batHeThong();
    if (stopNhan && !truocStop) dungHeThong();
  }

  truocStart = startNhan;
  truocStop  = stopNhan;
}

void xuLyEstop() {
  bool dangNhan = estopNhan();

  if (dangNhan && !truocEstop) dungKhanCap();
  if (!dangNhan && truocEstop) nhaEstop();

  truocEstop = dangNhan;
}

// ===================== CAM BIEN =====================
void canhLenS1() {
  if (!quaDoi(mocS1, DOI_S1_MS)) return;

  Serial.println("S1: Phat hien vat -> kich relay");
  batDauRelay();
}

void canhLenS2() {
  if (!quaDoi(mocS2, DOI_S2_MS)) return;

  int kq;

  if (!layKQ(kq)) {
    Serial.println("S2: Hang doi rong -> khong gat");
    return;
  }

  Serial.print("Lay tu hang doi: ");
  Serial.println(kq);
  inHangDoi();

  if (kq == 1) {
    Serial.println("S2: NG -> servo gat");
    batDauGat();
  } else {
    Serial.println("S2: OK -> khong gat");
  }
}

void xuLyCamBien() {
  bool s1CoVat = coVat(S1);
  bool s2CoVat = coVat(S2);

  if (trangThai == CHAY) {
    if (s1CoVat && !truocS1) canhLenS1();
    if (s2CoVat && !truocS2) canhLenS2();
  }

  truocS1 = s1CoVat;
  truocS2 = s2CoVat;
}

// ===================== SETUP =====================
void cauHinhChan() {
  pinMode(S1, INPUT);
  pinMode(S2, INPUT);

  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);

  pinMode(RELAY, OUTPUT);

  pinMode(NUT_START, INPUT_PULLUP);
  pinMode(NUT_STOP, INPUT_PULLUP);
  pinMode(ESTOP, INPUT_PULLUP);

  pinMode(DEN_DO, OUTPUT);
  pinMode(DEN_VANG, OUTPUT);
  pinMode(DEN_XANH, OUTPUT);

  pinMode(COI, OUTPUT);
}

void khoiTaoDauRa() {
  servoGat.attach(CHAN_SERVO);
  servoHome();

  setRelay(false);
  motorDung();
  tatCoi();
  setDen(false, false, false);

  trangThai = DUNG;
  capNhatBaoHieu();
}

void inKhoiDong() {
  Serial.println("=== HE THONG GAT SAN PHAM LOI START ===");
  Serial.println("Trang thai ban dau: DUNG");

  Serial.print("GOC_HOME = ");
  Serial.println(GOC_HOME);

  Serial.print("GOC_GAT = ");
  Serial.println(GOC_GAT);

  Serial.print("TRE_GAT_MS = ");
  Serial.println(TRE_GAT_MS);

  Serial.print("GIU_GAT_MS = ");
  Serial.println(GIU_GAT_MS);

  Serial.println("Nhan START/STOP bang nut nhan hoac Serial.");
  Serial.println("Nhan 0/1 tu Python.");
  Serial.println("Bien tro B10K o A1 de chinh toc do.");
  Serial.println("E-STOP o A5: nhan -> KHAN_CAP, nha -> DUNG, phai bam START lai.");
}

void setup() {
  Serial.begin(9600);

  cauHinhChan();
  khoiTaoDauRa();
  inKhoiDong();
}

// ===================== LOOP =====================
void loop() {
  xuLyEstop();        // uu tien cao nhat
  capNhatBaoHieu();  // den + coi
  docSerial();        // nhan 0/1, START, STOP
  xuLyNut();          // nut START / STOP
  capNhatMotor();     // motor theo bien tro
  xuLyCamBien();      // S1 / S2
  capNhatRelay();     // relay non-blocking
  capNhatServo();     // servo non-blocking

  delay(5);
}