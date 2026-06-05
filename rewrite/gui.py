from pathlib import Path
import base64
import sys
import tkinter as tk
from tkinter import messagebox

import cv2

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewrite.devices.arduino_comm import ArduinoComm
from rewrite.runtime.controllerFactory import SystemController
from rewrite.services.control_cmd_service import ControlCommandService
from rewrite.services.runtime_config_service import RuntimeConfigService
from rewrite.config.config import MQTT_TOPIC_INSPECTION_RESULT

class RewriteGUI:
  def __init__(self , root):
      self.root = root
      self.root.title("AI Runtime")
      self.root.geometry("980x720")

      self.controller = SystemController()
      self.control_service = None
      self.config_arduino = None
      self.config_arduino_key = None

      self.status_var = tk.StringVar(value="STOPPED")

      self.conveyor_id_var = tk.StringVar(value="-")
      self.camera_source_var = tk.StringVar(value="-")
      self.serial_port_var = tk.StringVar(value="-")
      self.baud_rate_var = tk.StringVar(value="-")
      self.threshold_var = tk.StringVar(value="-")
      self.arduino_com = tk.StringVar(value="-")
      self.camera_status_var = tk.StringVar(value="-")
      self.result_label_var = tk.StringVar(value="-")
      self.frame_scores_var = tk.StringVar(value="-")
      self.frame_photo_refs = []
      self.frame_image_labels = []
      self.frame_text_vars = []

      self.build_ui()
      self.start_control_service()
      self.root.protocol("WM_DELETE_WINDOW", self.on_close)

  def start_control_service(self):
    try:
      self.control_service = ControlCommandService(
        start_handler=self.handle_web_start_command,
        stop_handler=self.handle_web_stop_command,
        status_handler=self.get_web_status,
        reload_config_handler=self.handle_web_reload_config_command,
        arduino_command_handler=self.handle_web_arduino_command,
        log_handler=print,
      )
      self.control_service.connect()
    except Exception as e:
      self.status_var.set("MQTT ERROR")
      messagebox.showerror("MQTT error", str(e))

  def build_ui(self):
    tk.Label(
       self.root,
       text="AI Inspection System",
       font=("Arial",18, "bold")
    ).pack(pady=20)

    tk.Label(
       self.root,
       textvariable=self.status_var,
       font=("Arial",14)
    ).pack(pady=10)

    tk.Button(
       self.root,
       text="Start",
       command=self.start_system,
       width = 20
    ).pack(pady=10)

    tk.Button(
       self.root,
       text="Stop",
       command=self.stop_system,
       width = 20
    ).pack(pady=10)

    #Vẽ config
    tk.Label(self.root, text="Conveyor").pack()
    tk.Label(self.root, textvariable=self.conveyor_id_var).pack()

    tk.Label(self.root, text="Camera").pack()
    tk.Label(self.root, textvariable=self.camera_source_var).pack()

    tk.Label(self.root, text="Serial Port").pack()
    tk.Label(self.root, textvariable=self.serial_port_var).pack()

    tk.Label(self.root, text="Baud Rate").pack()
    tk.Label(self.root, textvariable=self.baud_rate_var).pack()

    tk.Label(self.root, text="Threshold").pack()
    tk.Label(self.root, textvariable=self.threshold_var).pack()
    tk.Label(self.root, text="Arduino").pack()
    tk.Label(self.root, textvariable=self.arduino_com).pack()

    tk.Label(self.root, text="Camera Status").pack()
    tk.Label(self.root, textvariable=self.camera_status_var).pack()

    tk.Label(self.root, text="Result").pack()
    tk.Label(self.root, textvariable=self.result_label_var).pack()

    tk.Label(self.root, text="Frame Scores").pack()
    tk.Label(self.root, textvariable=self.frame_scores_var).pack()

    frame_panel = tk.Frame(self.root)
    frame_panel.pack(pady=12)

    for idx in range(3):
      item = tk.Frame(frame_panel, padx=8)
      item.grid(row=0, column=idx)

      text_var = tk.StringVar(value=f"Frame {idx + 1}")
      self.frame_text_vars.append(text_var)

      tk.Label(item, textvariable=text_var).pack()
      image_label = tk.Label(
        item,
        width=260,
        height=180,
        bg="#111111",
      )
      image_label.pack()
      self.frame_image_labels.append(image_label)

  def start_system(self, conveyor_id="CONVEYOR-01"):
    try:

      conveyor_id = str(conveyor_id).strip().upper()
      self.status_var.set("STARTING")
      self.controller.start(
        conveyor_id,
        on_result=self.handle_inspection_result
      )
      print(f"Start system: {conveyor_id}")
      self.update_status_view()

      if self.control_service is not None:
        self.control_service.publish_status()
    except Exception as e:
      self.status_var.set("ERROR")

      try:
        if self.control_service is not None:
          self.control_service.publish_error(
            "START_SYSTEM",
            str(e),
            {"payload": {"conveyor_id": conveyor_id}}
          )
          self.control_service.publish_status()
      except Exception as publish_error:
        print(f"Publish start error failed: {publish_error}")

      messagebox.showerror("Start error", str(e))

  def stop_system(self):
    try:
      self.status_var.set("STOPPING")
      self.controller.stop()
      print("Stop system")
      self.update_status_view()
      if self.control_service is not None:
        self.control_service.publish_status()
    except Exception as e:
      self.status_var.set("ERROR")

      try:
        if self.control_service is not None:
          self.control_service.publish_error(
            "STOP_SYSTEM",
            str(e),
            {"payload": {}}
          )
          self.control_service.publish_status()
      except Exception as publish_error:
        print(f"Publish stop error failed: {publish_error}")

      messagebox.showerror("Stop error", str(e))

  def publish_runtime_status(self):
    try:
      if self.control_service is not None:
        self.control_service.publish_status()
    except Exception as e:
      print(f"Publish runtime status error: {e}")

  def update_status_view(self):
    status = self.controller.get_status()

    self.status_var.set(status.get("status", "-"))
    self.conveyor_id_var.set(status.get("conveyor_id") or "-")
    self.camera_source_var.set(status.get("camera_source") or "-")
    self.serial_port_var.set(status.get("serial_port") or "-")
    self.baud_rate_var.set(str(status.get("baud_rate") or "-"))
    self.threshold_var.set(str(status.get("ai_threshold") or "-"))
    self.arduino_com.set(str(status.get("arduino_status") or "-"))
    self.camera_status_var.set(str(status.get("camera_status") or "-"))

  def update_result_view(self, result):

    self.result_label_var.set(result.get("final_label", "-"))

    scores = []
    for frame_result in result.get("frames", []):
      scores.append(f"{float(frame_result.get('pred_score', 0.0)):.3f}")

    self.frame_scores_var.set(" | ".join(scores))
    self.update_frame_images(result)
    self.update_status_view()

  def _resize_for_gui(self, image, max_width=260, max_height=180):
    height, width = image.shape[:2]
    scale = min(max_width / max(1, width), max_height / max(1, height))
    new_width = max(1, int(width * scale))
    new_height = max(1, int(height * scale))
    return cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)

  def _cv_image_to_photo(self, image):
    if image is None:
      return None

    if image.ndim == 3 and image.shape[2] == 3:
      image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    image = self._resize_for_gui(image)
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
      return None

    data = base64.b64encode(encoded.tobytes()).decode("ascii")
    return tk.PhotoImage(data=data)

  def update_frame_images(self, result):
    self.frame_photo_refs = []
    frames = result.get("frames", [])

    for idx, image_label in enumerate(self.frame_image_labels):
      frame_result = frames[idx] if idx < len(frames) else {}
      image = frame_result.get("raw_frame")
      if image is None:
        image = frame_result.get("roi")
      photo = self._cv_image_to_photo(image)

      score = frame_result.get("pred_score")
      label = frame_result.get("pred_label") or "-"
      if score is None:
        self.frame_text_vars[idx].set(f"Frame {idx + 1}")
      else:
        self.frame_text_vars[idx].set(f"Frame {idx + 1} | {label} | {float(score):.3f}")

      if photo is None:
        image_label.configure(image="", text="No image", fg="white")
        self.frame_photo_refs.append(None)
        continue

      image_label.configure(image=photo, text="")
      self.frame_photo_refs.append(photo)

  def handle_web_start_command(self, payload):
    conveyor_id = payload.get("conveyor_id") or payload.get("conveyor_code")

    if not conveyor_id:
      raise RuntimeError("Missing conveyor_id")

    conveyor_id = str(conveyor_id).strip().upper()

    self.root.after(
      0,
      lambda: self.start_system(conveyor_id=conveyor_id)
    )

    return {
      "accepted": True,
      "conveyor_id": conveyor_id,
      "message": "Start scheduled",
    }

  def handle_web_stop_command(self, payload):
    self.root.after(0, self.stop_system)

    return {
      "accepted": True,
      "message": "Stop scheduled",
    }

  def handle_web_reload_config_command(self, payload):
    conveyor_id = payload.get("conveyor_id") or payload.get("conveyor_code")
    if not conveyor_id:
      raise RuntimeError("Missing conveyor_id")

    conveyor_id = str(conveyor_id).strip().upper()
    if self.controller is not None and self.controller.running and self.controller.conveyor_id == conveyor_id:
      config = RuntimeConfigService().get_config(conveyor_id)
      self.controller.conveyor_config = config
      self.update_status_view()

    return {
      "accepted": True,
      "conveyor_id": conveyor_id,
      "message": "Config reload accepted",
    }

  def _read_int(self, payload, name, fallback):
    value = payload.get(name)
    if value is None or value == "":
      return int(fallback)
    return int(value)

  def _build_arduino_config_payload(self, payload, runtime_config):
    return {
      "speed_low_level": self._read_int(payload, "speed_low_level", runtime_config.get("arduino_speed_low_level", 2)),
      "speed_high_level": self._read_int(payload, "speed_high_level", runtime_config.get("arduino_speed_high_level", 5)),
      "servo_home_angle": self._read_int(payload, "servo_home_angle", runtime_config.get("arduino_servo_home_angle", 0)),
      "servo_gate_angle": self._read_int(payload, "servo_gate_angle", runtime_config.get("arduino_servo_gate_angle", 130)),
      "light_min_lux": self._read_int(payload, "light_min_lux", runtime_config.get("arduino_light_min_lux", 1000)),
      "light_max_lux": self._read_int(payload, "light_max_lux", runtime_config.get("arduino_light_max_lux", 2000)),
      "save_default": payload.get("save_default") in [True, "true", "1", 1, "on", "ON"],
    }

  def _get_arduino_command_config(self, payload, conveyor_id):
    serial_port = str(payload.get("serial_port") or "").strip()
    baud_rate = payload.get("baud_rate")

    if serial_port:
      return {
        "conveyor_id": conveyor_id,
        "serial_port": serial_port,
        "baud_rate": int(baud_rate or 9600),
        "arduino_speed_low_level": payload.get("speed_low_level", 2),
        "arduino_speed_high_level": payload.get("speed_high_level", 5),
        "arduino_servo_home_angle": payload.get("servo_home_angle", 0),
        "arduino_servo_gate_angle": payload.get("servo_gate_angle", 130),
        "arduino_light_min_lux": payload.get("light_min_lux", 1000),
        "arduino_light_max_lux": payload.get("light_max_lux", 2000),
      }

    return RuntimeConfigService().get_config(conveyor_id)

  def _open_arduino_for_command(self, runtime_config):
    serial_port = str(runtime_config.get("serial_port") or "").strip()
    baud_rate = int(runtime_config.get("baud_rate") or 9600)

    if not serial_port:
      raise RuntimeError("Chua cau hinh serial_port cho bang tai")

    if self.controller is not None and self.controller.arduino is not None:
      arduino = self.controller.arduino
      same_port = str(getattr(arduino, "port", "")).upper() == serial_port.upper()
      same_baud = int(getattr(arduino, "baudrate", 0) or 0) == baud_rate
      if same_port and same_baud and arduino.is_connected():
        return arduino

    key = (serial_port.upper(), baud_rate)
    if (
      self.config_arduino is not None
      and self.config_arduino_key == key
      and self.config_arduino.is_connected()
    ):
      return self.config_arduino

    self.close_config_arduino()
    self.config_arduino = ArduinoComm(port=serial_port, baudrate=baud_rate, timeout=1)
    self.config_arduino.connect()
    self.config_arduino_key = key
    print(f"[ARDUINO] Opened config connection on {serial_port} @ {baud_rate}")
    return self.config_arduino

  def close_config_arduino(self):
    if self.config_arduino is not None:
      try:
        self.config_arduino.close()
      except Exception as e:
        print(f"[ARDUINO] Close config connection error: {e}")
      finally:
        self.config_arduino = None
        self.config_arduino_key = None

  def handle_web_arduino_command(self, command, payload):
    conveyor_id = payload.get("conveyor_id") or payload.get("conveyor_code")
    if not conveyor_id:
      raise RuntimeError("Missing conveyor_id")

    conveyor_id = str(conveyor_id).strip().upper()
    controller_running = bool(self.controller is not None and self.controller.running)
    if command in ["APPLY_ARDUINO_CONFIG", "LIGHT_CHECK", "RESET_ARDUINO_CONFIG_DEFAULT"] and controller_running:
      raise RuntimeError("Chi duoc cau hinh/kiem tra Arduino khi he thong dang dung")

    runtime_config = self._get_arduino_command_config(payload, conveyor_id)
    arduino = None

    try:
      arduino = self._open_arduino_for_command(runtime_config)

      if command == "GET_ARDUINO_CONFIG":
        result = arduino.get_config()
      elif command == "LIGHT_CHECK":
        result = arduino.light_check()
      elif command == "RESET_ARDUINO_CONFIG_DEFAULT":
        result = arduino.reset_config_default()
      elif command == "APPLY_ARDUINO_CONFIG":
        config_payload = self._build_arduino_config_payload(payload, runtime_config)
        result = arduino.apply_config(
          speed_low_level=config_payload["speed_low_level"],
          speed_high_level=config_payload["speed_high_level"],
          servo_home_angle=config_payload["servo_home_angle"],
          servo_gate_angle=config_payload["servo_gate_angle"],
          light_min_lux=config_payload["light_min_lux"],
          light_max_lux=config_payload["light_max_lux"],
          save_default=config_payload["save_default"],
        )
      else:
        raise RuntimeError(f"Unsupported Arduino command: {command}")

      return {
        "conveyor_id": conveyor_id,
        "serial_port": str(runtime_config.get("serial_port") or ""),
        "baud_rate": int(runtime_config.get("baud_rate") or 9600),
        **result,
      }
    except Exception:
      if arduino is not None and arduino is self.config_arduino:
        self.close_config_arduino()
      raise

  def get_web_status(self):
    return self.controller.get_status()

  def handle_inspection_result(self, result):
    self.root.after(0, lambda: self.update_result_view(result))

    try:
      if self.control_service is not None:
        payload = self.build_mqtt_result_payload(result)
        self.control_service.mqtt.publish_json(MQTT_TOPIC_INSPECTION_RESULT, payload, qos=1)
    except Exception as e:
      print(f"Publish inspection result error: {e}")

  def on_close(self):
    try:
      if self.control_service is not None:
        self.control_service.disconnect()
    except Exception as e:
      print(f"Control service disconnect error: {e}")

    try:
      if self.controller is not None:
        self.controller.stop()
    except Exception as e:
      print(f"Controller stop error: {e}")

    self.close_config_arduino()
    self.root.destroy()

  def build_mqtt_result_payload(self, result):
    status = self.controller.get_status()

    frames = []
    for item in result.get("frames", []):
      frames.append({
        "frame_index": item.get("frame_index"),
        "predicted_label": item.get("pred_label"),
        "predicted_score": float(item.get("pred_score", 0.0)),
        "roi_path": item.get("roi_path"),
        "contour_msg": item.get("contour_msg"),
        "contour_warning": item.get("contour_warning"),
      })

    return {
      "inspection_id": result.get("inspection_id"),
      "stt": result.get("stt"),
      "conveyor_id": status.get("conveyor_id"),
      "conveyor_code": status.get("conveyor_id"),
      "timestamp": result.get("timestamp"),
      "label": result.get("final_label"),
      "ng_count": int(result.get("ng_count", 0) or 0),
      "threshold": float(result.get("threshold", 0.0)),
      "contour_warnings": result.get("contour_warnings", []),
      "frames": frames,
    }

if __name__ == "__main__" :
  root = tk.Tk()
  app = RewriteGUI(root)
  root.mainloop()
