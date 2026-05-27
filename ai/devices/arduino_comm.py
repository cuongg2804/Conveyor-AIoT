import time
import threading

import serial
from serial.tools import list_ports


class ArduinoComm:
    def __init__(self, port=None, baudrate=9600, timeout=1):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser = None
        self._lock = threading.RLock()

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
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            print(f"[Arduino] Connected: {self.port} @ {self.baudrate}")
        except Exception:
            self.close()
            raise

    def is_connected(self):
        return self.ser is not None and self.ser.is_open

    def send_line(self, message: str):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        with self._lock:
            self._send_line_unlocked(message)

    def _send_line_unlocked(self, message: str):
        data = (str(message) + "\n").encode("utf-8")
        self.ser.write(data)
        self.ser.flush()
        print(f"[TX] {message}")

    def read_line(self):
        if not self.is_connected():
            return None

        with self._lock:
            return self._read_line_unlocked()

    def _read_line_unlocked(self):
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

    def clear_pending_input(self):
        if not self.is_connected():
            return

        with self._lock:
            try:
                self.ser.reset_input_buffer()
            except Exception:
                while self._read_line_unlocked():
                    pass

    def _wait_for_line_unlocked(self, prefixes, timeout=5):
        if isinstance(prefixes, str):
            prefixes = [prefixes]

        deadline = time.time() + timeout
        lines = []

        while time.time() < deadline:
            line = self._read_line_unlocked()
            if line:
                lines.append(line)
                if line.startswith("ERR:"):
                    raise RuntimeError(line)
                if any(line.startswith(prefix) for prefix in prefixes):
                    return line, lines
            else:
                time.sleep(0.05)

        raise RuntimeError(f"Timeout waiting for Arduino response: {', '.join(prefixes)}")

    def _send_and_wait_unlocked(self, command, prefixes, timeout=5):
        self._send_line_unlocked(command)
        line, lines = self._wait_for_line_unlocked(prefixes, timeout=timeout)
        return {
            "command": command,
            "response": line,
            "lines": lines,
        }

    @staticmethod
    def _parse_key_value_line(line, prefix):
        if not line.startswith(prefix):
            raise RuntimeError(f"Unexpected Arduino response: {line}")

        data = {}
        body = line[len(prefix):]
        for part in body.split(","):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            key = key.strip()
            value = value.strip()

            if value.replace(".", "", 1).isdigit():
                if "." in value:
                    data[key] = float(value)
                else:
                    data[key] = int(value)
            else:
                data[key] = value

        return data

    @staticmethod
    def _validate_config_values(speed_low_level, speed_high_level, servo_home_angle, servo_gate_angle, light_min_lux, light_max_lux):
        values = {
            "speed_low_level": int(speed_low_level),
            "speed_high_level": int(speed_high_level),
            "servo_home_angle": int(servo_home_angle),
            "servo_gate_angle": int(servo_gate_angle),
            "light_min_lux": int(light_min_lux),
            "light_max_lux": int(light_max_lux),
        }

        if values["speed_low_level"] < 1 or values["speed_high_level"] > 5 or values["speed_low_level"] >= values["speed_high_level"]:
            raise RuntimeError("Toc do LOW phai nho hon HIGH va nam trong khoang 1-5")
        if not 0 <= values["servo_home_angle"] <= 180 or not 0 <= values["servo_gate_angle"] <= 180:
            raise RuntimeError("Goc servo phai nam trong khoang 0-180")
        if values["light_min_lux"] < 0 or values["light_max_lux"] > 3000 or values["light_min_lux"] >= values["light_max_lux"]:
            raise RuntimeError("Nguong anh sang phai thoa 0 <= min < max <= 3000")

        return values

    def get_config(self):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        with self._lock:
            line_info = self._send_and_wait_unlocked("GET_CONFIG", "CONFIG:fw=", timeout=5)
            return {
                "raw": line_info["response"],
                "config": self._parse_key_value_line(line_info["response"], "CONFIG:"),
                "lines": line_info["lines"],
            }

    def apply_config(
        self,
        speed_low_level,
        speed_high_level,
        servo_home_angle,
        servo_gate_angle,
        light_min_lux,
        light_max_lux,
        save_default=False,
    ):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        values = self._validate_config_values(
            speed_low_level,
            speed_high_level,
            servo_home_angle,
            servo_gate_angle,
            light_min_lux,
            light_max_lux,
        )

        with self._lock:
            steps = [
                self._send_and_wait_unlocked(
                    f"SET_SPEED_RANGE:{values['speed_low_level']},{values['speed_high_level']}",
                    "ACK:SET_SPEED_RANGE:",
                    timeout=5,
                ),
                self._send_and_wait_unlocked(
                    f"SET_SERVO_HOME:{values['servo_home_angle']}",
                    "ACK:SET_SERVO_HOME:",
                    timeout=5,
                ),
                self._send_and_wait_unlocked(
                    f"SET_SERVO_GATE:{values['servo_gate_angle']}",
                    "ACK:SET_SERVO_GATE:",
                    timeout=5,
                ),
                self._send_and_wait_unlocked(
                    f"SET_LIGHT_RANGE:{values['light_min_lux']},{values['light_max_lux']}",
                    "ACK:SET_LIGHT_RANGE:",
                    timeout=5,
                ),
            ]

            if save_default:
                steps.append(
                    self._send_and_wait_unlocked(
                        "SAVE_CONFIG",
                        "ACK:SAVE_CONFIG",
                        timeout=5,
                    )
                )

            config_line = self._send_and_wait_unlocked("GET_CONFIG", "CONFIG:fw=", timeout=5)

        return {
            "applied": values,
            "saved": bool(save_default),
            "steps": steps,
            "config": self._parse_key_value_line(config_line["response"], "CONFIG:"),
            "raw_config": config_line["response"],
        }

    def light_check(self):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        with self._lock:
            self._send_line_unlocked("LIGHT_CHECK")
            line, lines = self._wait_for_line_unlocked("LIGHT_RESULT:", timeout=15)

        return {
            "raw": line,
            "result": self._parse_key_value_line(line, "LIGHT_RESULT:"),
            "samples": [item for item in lines if item.startswith("LIGHT_SAMPLE:")],
            "lines": lines,
        }

    def reset_config_default(self):
        if not self.is_connected():
            raise RuntimeError("Arduino chua ket noi")

        with self._lock:
            reset_info = self._send_and_wait_unlocked(
                "RESET_CONFIG_DEFAULT",
                "ACK:RESET_CONFIG_DEFAULT:SAVED",
                timeout=5,
            )
            config_info = self._wait_for_line_unlocked("CONFIG:fw=", timeout=5)

        return {
            "reset": True,
            "saved": True,
            "response": reset_info["response"],
            "config": self._parse_key_value_line(config_info[0], "CONFIG:"),
            "raw_config": config_info[0],
            "lines": reset_info["lines"] + config_info[1],
        }

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
