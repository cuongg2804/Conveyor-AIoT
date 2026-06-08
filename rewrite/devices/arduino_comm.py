import threading
import time

import serial
from serial.tools import list_ports


class ArduinoComm:
  def __init__(self, port=None, baudrate=9600, timeout=1):
    self.port = port
    self.baudrate = int(baudrate or 9600)
    self.timeout = timeout
    self.serial_conn = None
    self.arduino_status = "DISCONNECTED"
    self._lock = threading.RLock()

  @property
  def ser(self):
    return self.serial_conn

  @staticmethod
  def scan_ports():
    return [
      {
        "device": port.device,
        "description": port.description,
      }
      for port in list_ports.comports()
    ]

  def connect(self):
    if not self.port:
      raise RuntimeError("Chua chon cong Arduino")

    if self.is_connected():
      self.arduino_status = "CONNECTED"
      print("Arduino already connected")
      return

    try:
      self.close()
      self.serial_conn = serial.Serial(
        port=self.port,
        baudrate=self.baudrate,
        timeout=self.timeout,
      )
      time.sleep(2)
      self.serial_conn.reset_input_buffer()
      self.serial_conn.reset_output_buffer()
      self.arduino_status = "CONNECTED"
      print(f"Arduino connected: {self.port} @ {self.baudrate}")
    except Exception as e:
      self.arduino_status = "ERROR"
      self.serial_conn = None
      raise RuntimeError(f"Cannot connect Arduino on {self.port}: {e}")

  def is_connected(self):
    return self.serial_conn is not None and self.serial_conn.is_open

  def send_line(self, message):
    if not self.is_connected():
      raise RuntimeError("Arduino is not connected")

    with self._lock:
      self._send_line_unlocked(message)

  def _send_line_unlocked(self, message):
    data = (str(message) + "\n").encode("utf-8")
    self.serial_conn.write(data)
    self.serial_conn.flush()
    print(f"[Arduino TX] {message}")

  def read_line(self):
    if not self.is_connected():
      return None

    with self._lock:
      return self._read_line_unlocked()

  def _read_line_unlocked(self):
    if not self.is_connected():
      return None

    if self.serial_conn.in_waiting:
      try:
        line = self.serial_conn.readline().decode("utf-8", errors="ignore").strip()
        if line:
          print(f"[Arduino RX] {line}")
          return line
      except Exception as e:
        print(f"[Arduino] Read error: {e}")

    return None

  def clear_pending_input(self):
    if not self.is_connected():
      return

    with self._lock:
      try:
        self.serial_conn.reset_input_buffer()
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

  def _verify_config_protocol_unlocked(self, timeout=3, retries=2):
    last_error = None

    for attempt in range(1, retries + 1):
      try:
        self.serial_conn.reset_input_buffer()
        return self._send_and_wait_unlocked("GET_VERSION", "FW_VERSION:", timeout=timeout)
      except RuntimeError as e:
        last_error = e
        if attempt < retries:
          time.sleep(1)

    raise RuntimeError(
      "Arduino config protocol is not responding. "
      f"Check that {self.port} is the correct port, baud rate is {self.baudrate}, "
      "and BangTaiFinal firmware with GET_VERSION/config commands is uploaded. "
      f"Last error: {last_error}"
    )

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

      numeric_value = value.replace(".", "", 1)
      if numeric_value.isdigit():
        data[key] = float(value) if "." in value else int(value)
      else:
        data[key] = value

    return data

  @staticmethod
  def _validate_config_values(
    speed_low_level,
    speed_high_level,
    servo_home_angle,
    servo_gate_angle,
    light_min_lux,
    light_max_lux,
  ):
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
      raise RuntimeError("Arduino is not connected")

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
      raise RuntimeError("Arduino is not connected")

    values = self._validate_config_values(
      speed_low_level,
      speed_high_level,
      servo_home_angle,
      servo_gate_angle,
      light_min_lux,
      light_max_lux,
    )

    with self._lock:
      version_info = self._verify_config_protocol_unlocked()
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
        steps.append(self._send_and_wait_unlocked("SAVE_CONFIG", "ACK:SAVE_CONFIG", timeout=5))

      config_line = self._send_and_wait_unlocked("GET_CONFIG", "CONFIG:fw=", timeout=5)

    return {
      "firmware_version": version_info["response"].split(":", 1)[-1],
      "applied": values,
      "saved": bool(save_default),
      "steps": steps,
      "config": self._parse_key_value_line(config_line["response"], "CONFIG:"),
      "raw_config": config_line["response"],
    }

  def light_check(self):
    if not self.is_connected():
      raise RuntimeError("Arduino is not connected")

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
      raise RuntimeError("Arduino is not connected")

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

  def get_status(self):
    is_open = self.is_connected()
    if not is_open and self.arduino_status == "CONNECTED":
      status = "DISCONNECTED"
    else:
      status = self.arduino_status

    return {
      "status": status,
      "port": self.port,
      "baudrate": self.baudrate,
      "connected": is_open,
    }

  def close(self):
    if self.serial_conn is not None:
      try:
        self.serial_conn.close()
        print("Arduino closed")
      except Exception as e:
        print(f"[Arduino] Close error: {e}")
      finally:
        self.serial_conn = None
        if self.arduino_status != "ERROR":
          self.arduino_status = "DISCONNECTED"
