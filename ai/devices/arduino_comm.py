import time

import serial
from serial.tools import list_ports


class ArduinoComm:
    def __init__(self, port=None, baudrate=9600, timeout=1):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser = None

    @staticmethod

    # Hàm scan cổng COM
    def scan_ports():
        ports = list_ports.comports() # kiem tra xem latop dang co COM nao khong? 
        # Neu co thi tra ve 1 list. Trong co moi port = 1 object -> chuyen sang Broker
        return [
            {
                "device": port.device,
                "description": port.description,
            }
            # lap qua tung cong scanned -> tra ve
            for port in ports
        ]
    # connect Uno
    def connect(self): # self la doi tuong Uno hien tai
        if not self.port:
            raise RuntimeError("Chưa chọn cổng Arduino")

        try:
            self.close()
            self.ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
            )
            time.sleep(2)
            print(f"[Arduino] Connected: {self.port} @ {self.baudrate}")
        except Exception:
            self.close()
            raise

    def is_connected(self):
        return self.ser is not None and self.ser.is_open

    def send_line(self, message: str):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        data = (message + "\n").encode("utf-8")
        self.ser.write(data)
        print(f"[TX] {message}")

    def clamp_int(self, value, default_value, min_value, max_value):
        try:
            number = int(value)
        except Exception:
            number = default_value

        return max(min_value, min(number, max_value))

    def apply_config(self, speed=150, goc_home=0, goc_gat=120):
        speed = self.clamp_int(speed, 150, 0, 255)
        goc_home = self.clamp_int(goc_home, 0, 0, 180)
        goc_gat = self.clamp_int(goc_gat, 120, 0, 180)

        command = f"CFG:SPEED={speed};HOME={goc_home};PUSH={goc_gat}"
        self.send_line(command)

        return {
            "speed": speed,
            "goc_home": goc_home,
            "goc_gat": goc_gat,
            "command": command,
        }

    def read_line(self):
        if not self.is_connected():
            return None

        if self.ser.in_waiting:
            try:
                line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    print(f"[RX] {line}")
                    return line
            except Exception as e:
                print(f"[Arduino] Read error: {e}")
        return None

    def send_result(self, label):
        if label == "NG":
            self.send_line("1")
        else:
            self.send_line("0")

    def close(self):
        if self.ser is not None:
            try:
                self.ser.close()
                print("[Arduino] Closed")
            except Exception as e:
                print(f"[Arduino] Close error: {e}")
            finally:
                self.ser = None