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

    def apply_config(
        self,
        speed_low_level=2,
        speed_high_level=5,
        servo_home_angle=0,
        servo_gate_angle=130,
        light_min_lux=1000,
        light_max_lux=2000,
        save_default=False,
    ):
        speed_low_level = self.clamp_int(speed_low_level, 2, 1, 5)
        speed_high_level = self.clamp_int(speed_high_level, 5, 1, 5)

        if speed_low_level >= speed_high_level:
            raise RuntimeError("speed_low_level must be smaller than speed_high_level")

        servo_home_angle = self.clamp_int(servo_home_angle, 0, 0, 180)
        servo_gate_angle = self.clamp_int(servo_gate_angle, 130, 0, 180)

        light_min_lux = self.clamp_int(light_min_lux, 1000, 0, 3000)
        light_max_lux = self.clamp_int(light_max_lux, 2000, 0, 3000)

        if light_min_lux >= light_max_lux:
            raise RuntimeError("light_min_lux must be smaller than light_max_lux")

        commands = [
            f"SET_SPEED_RANGE:{speed_low_level},{speed_high_level}",
            f"SET_SERVO_HOME:{servo_home_angle}",
            f"SET_SERVO_GATE:{servo_gate_angle}",
            f"SET_LIGHT_RANGE:{light_min_lux},{light_max_lux}",
        ]

        if save_default:
            commands.append("SAVE_CONFIG")

        for command in commands:
            self.send_line(command)
            time.sleep(0.05)

        return {
            "speed_low_level": speed_low_level,
            "speed_high_level": speed_high_level,
            "servo_home_angle": servo_home_angle,
            "servo_gate_angle": servo_gate_angle,
            "light_min_lux": light_min_lux,
            "light_max_lux": light_max_lux,
            "save_default": save_default,
            "commands": commands,
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