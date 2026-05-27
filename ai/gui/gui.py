import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import numpy as np
import cv2
import threading
import time

from service.control_cmd_service import ControlCommandService
from core.patchcore_engine import DEFAULT_IMAGE_THRESHOLD, PatchCoreEngine
from devices.camera_hik import HikCamera
from devices.arduino_comm import ArduinoComm
from controllers.controller import SystemController
from service.pipeline_service import PipelineService
from service.result_queue import ResultQueue
from service.latency_logger import LatencyLogger
from service.mqtt_service import MQTTService
from service.mongo_service import MongoService
from service.storage_service import StorageService
from service.conveyor_config_service import ConveyorConfigService

from config import (
    CKPT_PATH,
    MQTT_TOPIC_INSPECTION_RESULT,
)


class AnomalyGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("AI")
        self.root.geometry("1500x950")
        self.root.configure(bg="#f0f2f5")

        # Runtime state
        self.controller = None
        self.controller_thread = None
        self.startup_resources = []
        self.conveyor_config = None
        self.config_arduino = None
        self.config_arduino_key = None
        self.config_arduino_lock = threading.RLock()
        self.runtime_status = "STOPPED"
        self.current_conveyor_id = None

        # Photo refs
        self.orig_photos = [None, None, None]
        self.overlay_photos = [None, None, None]

        # UI vars
        self.status_var = tk.StringVar(value="Chưa khởi động")
        self.camera_var = tk.StringVar(value="Chưa kết nối")
        self.camera_delay_var = tk.StringVar(value="-")
        self.model_var = tk.StringVar(value="Chưa tải")
        self.arduino_var = tk.StringVar(value="Chưa kết nối")

        self.score_var = tk.StringVar(value="-")
        self.label_var = tk.StringVar(value="-")
        self.threshold_var = tk.StringVar(value=str(DEFAULT_IMAGE_THRESHOLD))
        self.result_var = tk.StringVar(value="Chưa có kết quả")
        self.count_var = tk.StringVar(value="0")

        # Queue debug vars
        self.queue_len_var = tk.StringVar(value="0")
        self.queue_head_var = tk.StringVar(value="-")
        self.queue_tail_var = tk.StringVar(value="-")

        self.frame_score_vars = [
            tk.StringVar(value="-"),
            tk.StringVar(value="-"),
            tk.StringVar(value="-"),
        ]

        self.frame_label_vars = [
            tk.StringVar(value="-"),
            tk.StringVar(value="-"),
            tk.StringVar(value="-"),
        ]

        self.callbacks = {
            "log": self.log,
            "set_status": self.set_status,
            "set_camera_status": self.set_camera_status,
            "set_camera_delay": self.set_camera_delay,
            "set_model_status": self.set_model_status,
            "set_arduino_status": self.set_arduino_status,
            "set_score": self.set_score,
            "set_label": self.set_label,
            "set_threshold": self.set_threshold,
            "set_result_text": self.set_result_text,
            "set_count": self.set_count,
            "update_multiframe_results": self.update_multiframe_results,
            "clear_multiframe_results": self.clear_multiframe_results,
            "set_queue_debug": self.set_queue_debug,
            "reset_ui": self.reset_ui,
        }

        self.build_ui()

        self.control_command_service = ControlCommandService(
            start_handler=self.handle_web_start_command,
            stop_handler=self.handle_web_stop_command,
            status_handler=self.get_web_status,
            reload_config_handler=self.handle_web_reload_config_command,
            arduino_command_handler=self.handle_web_arduino_command,
            log_handler=self.log,
        )

        try:
            self.control_command_service.connect()
            self.log("Control command MQTT connected.")
        except Exception as e:
            self.log(f"Không kết nối được control MQTT: {e}")

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # =========================
    # Thread-safe UI
    # =========================
    def safe_ui(self, func):
        try:
            self.root.after(0, func)
        except Exception:
            pass

    def log(self, msg):
        print(msg)

        def _():
            timestamp = time.strftime("%H:%M:%S")
            self.log_text.config(state="normal")
            self.log_text.insert("end", f"[{timestamp}] {msg}\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")

        self.safe_ui(_)

    def set_status(self, value):
        self.safe_ui(lambda: self.status_var.set(str(value)))

    def set_camera_status(self, value):
        self.safe_ui(lambda: self.camera_var.set(str(value)))

    def set_camera_delay(self, value):
        self.safe_ui(lambda: self.camera_delay_var.set(str(value)))

    def set_model_status(self, value):
        self.safe_ui(lambda: self.model_var.set(str(value)))

    def set_arduino_status(self, value):
        self.safe_ui(lambda: self.arduino_var.set(str(value)))

    def set_score(self, value):
        self.safe_ui(lambda: self.score_var.set(str(value)))

    def set_label(self, value):
        self.safe_ui(lambda: self.label_var.set(str(value)))

    def set_threshold(self, value):
        self.safe_ui(lambda: self.threshold_var.set(str(value)))

    def set_result_text(self, value):
        self.safe_ui(lambda: self.result_var.set(str(value)))

    def set_count(self, value):
        self.safe_ui(lambda: self.count_var.set(str(value)))

    def set_queue_debug(self, queue_items):
        def _():
            items = queue_items if queue_items is not None else []

            self.queue_len_var.set(str(len(items)))

            if len(items) > 0:
                self.queue_head_var.set(str(items[0]))
                self.queue_tail_var.set(str(items[-1]))
            else:
                self.queue_head_var.set("-")
                self.queue_tail_var.set("-")

            self.queue_text.config(state="normal")
            self.queue_text.delete("1.0", "end")

            if len(items) == 0:
                self.queue_text.insert("end", "(queue rỗng)")
            else:
                for idx, item in enumerate(items, start=1):
                    self.queue_text.insert("end", f"{idx:02d}. {item}\n")

            self.queue_text.see("end")
            self.queue_text.config(state="disabled")

        self.safe_ui(_)

    # =========================
    # Web MQTT command callbacks
    # =========================
    def handle_web_start_command(self, payload: dict):
        conveyor_id = payload.get("conveyor_id")

        if not conveyor_id:
            raise RuntimeError("Thiếu conveyor_id trong MQTT payload")

        conveyor_id = str(conveyor_id).strip().upper()

        self.current_conveyor_id = conveyor_id
        self.runtime_status = "STARTING"
        self.set_status("Đang khởi động")

        self.log(f"[WEB COMMAND] START_SYSTEM received for {conveyor_id}")

        self.safe_ui(
            lambda: self.start_system(
                show_message=False,
                conveyor_id=conveyor_id,
            )
        )

        return {
            "accepted": True,
            "conveyor_id": conveyor_id,
            "message": "Start command scheduled on GUI main thread",
        }
    def handle_web_stop_command(self, payload: dict):
        conveyor_id = payload.get("conveyor_id") or self.current_conveyor_id

        if conveyor_id:
            conveyor_id = str(conveyor_id).strip().upper()

        self.log(f"[WEB COMMAND] STOP_SYSTEM received for {conveyor_id}")

        self.safe_ui(lambda: self.stop_system())

        return {
            "accepted": True,
            "conveyor_id": conveyor_id,
            "message": "Stop command scheduled on GUI main thread",
        }

    def handle_web_reload_config_command(self, payload: dict):
        conveyor_id = payload.get("conveyor_id")

        if not conveyor_id:
            raise RuntimeError("Thiếu conveyor_id trong MQTT payload")

        conveyor_id = str(conveyor_id).strip().upper()
        self.log(f"[WEB COMMAND] RELOAD_CONFIG received for {conveyor_id}")
        self.safe_ui(lambda: self.reload_runtime_config(conveyor_id))

        return {
            "accepted": True,
            "conveyor_id": conveyor_id,
            "message": "Reload config scheduled on GUI main thread",
        }

    def _build_arduino_config_payload(self, payload: dict, db_config: dict) -> dict:
        def read_int(name, fallback):
            value = payload.get(name)
            if value is None or value == "":
                value = db_config.get(name, fallback)
            return int(value)

        return {
            "speed_low_level": read_int("speed_low_level", db_config.get("arduino_speed_low_level", 2)),
            "speed_high_level": read_int("speed_high_level", db_config.get("arduino_speed_high_level", 5)),
            "servo_home_angle": read_int("servo_home_angle", db_config.get("arduino_servo_home_angle", 0)),
            "servo_gate_angle": read_int("servo_gate_angle", db_config.get("arduino_servo_gate_angle", 130)),
            "light_min_lux": read_int("light_min_lux", db_config.get("arduino_light_min_lux", 1000)),
            "light_max_lux": read_int("light_max_lux", db_config.get("arduino_light_max_lux", 2000)),
            "save_default": payload.get("save_default") in [True, "true", "1", 1, "on", "ON"],
        }

    def _open_arduino_for_command(self, db_config: dict):
        serial_port = str(db_config.get("serial_port") or "").strip()
        baud_rate = int(db_config.get("baud_rate") or 9600)

        if not serial_port:
            raise RuntimeError("Chua cau hinh serial_port cho bang tai")

        if self.controller is not None and getattr(self.controller, "arduino", None) is not None:
            arduino = self.controller.arduino
            same_port = str(getattr(arduino, "port", "")).upper() == serial_port.upper()
            same_baud = int(getattr(arduino, "baudrate", 0) or 0) == baud_rate
            if same_port and same_baud and arduino.is_connected():
                return arduino, False

        key = (serial_port.upper(), baud_rate)
        with self.config_arduino_lock:
            if (
                self.config_arduino is not None
                and self.config_arduino_key == key
                and self.config_arduino.is_connected()
            ):
                return self.config_arduino, False

            self.close_config_arduino()
            self.config_arduino = ArduinoComm(port=serial_port, baudrate=baud_rate, timeout=1)
            self.config_arduino.connect()
            self.config_arduino_key = key
            self.log(f"[ARDUINO] Opened persistent config connection on {serial_port} @ {baud_rate}")
            return self.config_arduino, False

    def _get_arduino_command_config(self, command: str, payload: dict, conveyor_id: str) -> dict:
        serial_port = str(payload.get("serial_port") or "").strip()
        baud_rate = payload.get("baud_rate")

        if serial_port:
            config = {
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
            self.log(f"[ARDUINO] Using command payload config for {command}; skipped DB lookup")
            return config

        return self.load_conveyor_config(conveyor_id)

    def close_config_arduino(self):
        with self.config_arduino_lock:
            if self.config_arduino is not None:
                try:
                    self.config_arduino.close()
                    self.log("[ARDUINO] Closed config connection.")
                except Exception as e:
                    self.log(f"[ARDUINO] Close config connection error: {e}")
                finally:
                    self.config_arduino = None
                    self.config_arduino_key = None

    def handle_web_arduino_command(self, command: str, payload: dict):
        conveyor_id = payload.get("conveyor_id")
        if not conveyor_id:
            raise RuntimeError("Thieu conveyor_id trong MQTT payload")

        conveyor_id = str(conveyor_id).strip().upper()
        self.log(f"[WEB COMMAND] {command} received for {conveyor_id}")

        controller_running = bool(
            self.controller is not None and getattr(self.controller, "running", False)
        )
        if command in ["APPLY_ARDUINO_CONFIG", "LIGHT_CHECK", "RESET_ARDUINO_CONFIG_DEFAULT"] and controller_running:
            raise RuntimeError("Chi duoc cau hinh/kiem tra Arduino khi he thong dang dung")

        db_config = self._get_arduino_command_config(command, payload, conveyor_id)
        arduino = None
        should_close = False

        try:
            arduino, should_close = self._open_arduino_for_command(db_config)

            if command == "GET_ARDUINO_CONFIG":
                result = arduino.get_config()
            elif command == "LIGHT_CHECK":
                result = arduino.light_check()
            elif command == "RESET_ARDUINO_CONFIG_DEFAULT":
                result = arduino.reset_config_default()
            elif command == "APPLY_ARDUINO_CONFIG":
                config_payload = self._build_arduino_config_payload(payload, db_config)
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

            self.log(f"[ARDUINO] {command} completed: {result}")
            return {
                "conveyor_id": conveyor_id,
                "serial_port": str(db_config.get("serial_port") or ""),
                "baud_rate": int(db_config.get("baud_rate") or 9600),
                **result,
            }

        except Exception:
            if arduino is not None and arduino is self.config_arduino:
                self.close_config_arduino()
            raise

        finally:
            if should_close and arduino is not None:
                arduino.close()

    def reload_runtime_config(self, conveyor_id: str):
        conveyor_id = str(conveyor_id).strip().upper()

        try:
            config = self.load_conveyor_config(conveyor_id)
            self.conveyor_config = config

            if self.current_conveyor_id and self.current_conveyor_id != conveyor_id:
                self.log(
                    f"[CONFIG] Ignored reload for {conveyor_id}; current conveyor is {self.current_conveyor_id}"
                )
                self.publish_runtime_status()
                return

            self.current_conveyor_id = conveyor_id

            image_threshold = float(config["ai_threshold"])
            camera_trigger_delay = config.get("camera_trigger_delay")
            serial_port = str(config["serial_port"])
            baud_rate = int(config["baud_rate"])
            config_key = (serial_port.upper(), baud_rate)

            if self.config_arduino_key is not None and self.config_arduino_key != config_key:
                self.close_config_arduino()

            self.threshold_var.set(str(image_threshold))

            if self.controller is None:
                self.log(f"[CONFIG] Reloaded config for {conveyor_id}. Runtime will use it on next start.")
                self.publish_runtime_status()
                return

            if self.controller.model is not None:
                self.controller.model.set_image_threshold(image_threshold)
                self.log(f"[CONFIG] Runtime threshold updated = {image_threshold}")

            if camera_trigger_delay is not None and self.controller.camera is not None:
                actual_delay = self.controller.camera.set_trigger_delay(float(camera_trigger_delay))
                self.set_camera_delay(str(actual_delay))
                self.log(f"[CONFIG] Runtime camera delay updated = {actual_delay}")

            if self.controller.arduino is not None:
                current_port = str(getattr(self.controller.arduino, "port", ""))
                current_baud = int(getattr(self.controller.arduino, "baudrate", 0))
                if current_port.upper() != serial_port.upper() or current_baud != baud_rate:
                    self.log(f"[CONFIG] Reconnecting Arduino: {serial_port} @ {baud_rate}")
                    self.close_config_arduino()
                    self.controller.arduino.close()
                    self.controller.arduino = ArduinoComm(
                        port=serial_port,
                        baudrate=baud_rate,
                        timeout=1,
                    )
                    self.controller.arduino.connect()
                    self.set_arduino_status(f"Đã kết nối ({serial_port})")

            self.controller.conveyor_id = conveyor_id
            self.log(f"[CONFIG] Runtime config reload completed for {conveyor_id}")
            self.publish_runtime_status()

        except Exception as e:
            self.runtime_status = "ERROR"
            self.set_status("Lỗi")
            self.log(f"[CONFIG] Runtime config reload error: {e}")
            self.publish_runtime_status()

    def get_web_status(self):
        controller_running = False
        thread_alive = False

        if self.controller is not None:
            controller_running = bool(getattr(self.controller, "running", False))

        if self.controller_thread is not None:
            thread_alive = bool(self.controller_thread.is_alive())

        running = (
            self.runtime_status == "RUNNING"
            or controller_running
            or (
                thread_alive
                and self.runtime_status not in ["STOPPED", "ERROR"]
            )
        )

        camera_delay = None
        try:
            if self.controller is not None:
                camera_delay = self.controller.get_camera_delay()
        except Exception:
            camera_delay = None

        return {
            "conveyor_id": self.current_conveyor_id,
            "running": running,
            "controller_ready": self.controller is not None,
            "thread_alive": thread_alive,
            "status": self.runtime_status,
            "camera_status": self.camera_var.get(),
            "model_status": self.model_var.get(),
            "arduino_status": self.arduino_var.get(),
            "threshold": self.threshold_var.get(),
            "camera_delay": camera_delay if camera_delay is not None else self.camera_delay_var.get(),
            "timestamp": time.time(),
        }

    def publish_runtime_status(self):
        """Publish trạng thái runtime thật sau khi START/STOP hoàn tất."""
        try:
            if hasattr(self, "control_command_service") and self.control_command_service is not None:
                status = self.get_web_status()
                self.log(f"[STATUS] Publish runtime status: {status}")
                self.control_command_service.publish_status()
        except Exception as e:
            self.log(f"[STATUS] Publish runtime status error: {e}")

    # =========================
    # Config from DB
    # =========================
    def load_conveyor_config(self, conveyor_id: str):
        if not conveyor_id:
            raise RuntimeError("conveyor_id is required to load conveyor config")

        conveyor_id = str(conveyor_id).strip().upper()
        service = None

        try:
            service = ConveyorConfigService()
            config = service.get_config(conveyor_id)
            self.log(f"Đã đọc cấu hình băng tải từ DB: {config}")
            return config

        finally:
            try:
                if service is not None and hasattr(service, "close"):
                    service.close()
            except Exception:
                pass

    # =========================
    # UI
    # =========================
    def build_ui(self):
        header = tk.Label(
            self.root,
            text="GIAO DIỆN GIÁM SÁT HỆ THỐNG PHÁT HIỆN LỖI (3 FRAMES)",
            font=("Arial", 20, "bold"),
            bg="#1f4e79",
            fg="white",
            pady=12,
        )
        header.pack(fill="x")

        container = tk.Frame(self.root, bg="#f0f2f5")
        container.pack(fill="both", expand=True, padx=12, pady=12)

        # Left panel
        left = tk.Frame(container, bg="white", bd=2, relief="groove")
        left.pack(side="left", fill="both", expand=True, padx=(0, 10))

        tk.Label(
            left,
            text="3 ẢNH SẢN PHẨM VÀ 3 ẢNH KHOANH LỖI",
            font=("Arial", 15, "bold"),
            bg="white",
        ).pack(pady=10)

        grid_frame = tk.Frame(left, bg="white")
        grid_frame.pack(fill="both", expand=True, padx=10, pady=10)

        grid_frame.grid_rowconfigure(0, weight=1)
        grid_frame.grid_rowconfigure(1, weight=1)
        grid_frame.grid_columnconfigure(0, weight=1)
        grid_frame.grid_columnconfigure(1, weight=1)
        grid_frame.grid_columnconfigure(2, weight=1)

        self.orig_title_labels = []
        self.orig_image_labels = []
        self.overlay_title_labels = []
        self.overlay_image_labels = []

        for i in range(3):
            card = tk.Frame(grid_frame, bg="#fafafa", bd=1, relief="groove")
            card.grid(row=0, column=i, sticky="nsew", padx=6, pady=6)

            title = tk.Label(
                card,
                text=f"Frame {i + 1}\nScore: - | Label: -",
                font=("Arial", 11, "bold"),
                bg="#fafafa",
            )
            title.pack(pady=6)

            img_label = tk.Label(
                card,
                text="Chưa có ảnh",
                bg="#d9d9d9",
                font=("Arial", 12),
                width=32,
                height=12,
            )
            img_label.pack(fill="both", expand=True, padx=6, pady=6)

            self.orig_title_labels.append(title)
            self.orig_image_labels.append(img_label)

            card2 = tk.Frame(grid_frame, bg="#fafafa", bd=1, relief="groove")
            card2.grid(row=1, column=i, sticky="nsew", padx=6, pady=6)

            title2 = tk.Label(
                card2,
                text=f"Khoanh lỗi {i + 1}",
                font=("Arial", 11, "bold"),
                bg="#fafafa",
            )
            title2.pack(pady=6)

            overlay_label = tk.Label(
                card2,
                text="Chưa có ảnh khoanh lỗi",
                bg="#d9d9d9",
                font=("Arial", 12),
                width=32,
                height=12,
            )
            overlay_label.pack(fill="both", expand=True, padx=6, pady=6)

            self.overlay_title_labels.append(title2)
            self.overlay_image_labels.append(overlay_label)

        # Right panel
        right = tk.Frame(container, bg="#f0f2f5", width=420)
        right.pack(side="right", fill="y")
        right.pack_propagate(False)

        # Control
        control_box = tk.LabelFrame(
            right,
            text="Điều khiển",
            font=("Arial", 12, "bold"),
            bg="white",
        )
        control_box.pack(fill="x", pady=(0, 8))

        tk.Label(
            control_box,
            text="Threshold:",
            font=("Arial", 11, "bold"),
            bg="white",
        ).pack(anchor="w", padx=10, pady=(10, 4))

        threshold_row = tk.Frame(control_box, bg="white")
        threshold_row.pack(fill="x", padx=10, pady=(0, 10))

        self.threshold_entry = tk.Entry(
            threshold_row,
            textvariable=self.threshold_var,
            font=("Arial", 11),
        )
        self.threshold_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.btn_apply_threshold = tk.Button(
            threshold_row,
            text="Cập nhật runtime",
            font=("Arial", 10, "bold"),
            bg="#0d6efd",
            fg="white",
            command=self.apply_threshold,
        )
        self.btn_apply_threshold.pack(side="right")

        self.btn_start = tk.Button(
            control_box,
            text="Bắt đầu từ Web",
            font=("Arial", 12, "bold"),
            bg="#28a745",
            fg="white",
            height=2,
            command=self.start_from_gui_warning,
        )
        self.btn_start.pack(fill="x", padx=10, pady=(0, 5))

        self.btn_stop = tk.Button(
            control_box,
            text="Dừng hệ thống",
            font=("Arial", 12, "bold"),
            bg="#dc3545",
            fg="white",
            height=2,
            state="disabled",
            command=self.stop_system,
        )
        self.btn_stop.pack(fill="x", padx=10, pady=(5, 5))

        self.btn_camera_settings = tk.Button(
            control_box,
            text="Cài đặt Camera runtime",
            font=("Arial", 11, "bold"),
            bg="#6f42c1",
            fg="white",
            height=2,
            command=self.open_camera_settings_window,
        )
        self.btn_camera_settings.pack(fill="x", padx=10, pady=(0, 10))

        # Status
        info_box = tk.LabelFrame(
            right,
            text="Thông tin hệ thống",
            font=("Arial", 12, "bold"),
            bg="white",
        )
        info_box.pack(fill="x", pady=(0, 8))

        self.add_info_row(info_box, "Trạng thái:", self.status_var)
        self.add_info_row(info_box, "Camera:", self.camera_var)
        self.add_info_row(info_box, "Cam Delay:", self.camera_delay_var)
        self.add_info_row(info_box, "Model:", self.model_var)
        self.add_info_row(info_box, "Arduino:", self.arduino_var)
        self.add_info_row(info_box, "Avg Score:", self.score_var)
        self.add_info_row(info_box, "Final Label:", self.label_var)
        self.add_info_row(info_box, "Threshold:", self.threshold_var)
        self.add_info_row(info_box, "Số batch:", self.count_var)
        self.add_info_row(info_box, "Frame 1:", self.frame_score_vars[0])
        self.add_info_row(info_box, "Frame 2:", self.frame_score_vars[1])
        self.add_info_row(info_box, "Frame 3:", self.frame_score_vars[2])

        # Result
        result_box = tk.LabelFrame(
            right,
            text="Kết quả cuối",
            font=("Arial", 12, "bold"),
            bg="white",
        )
        result_box.pack(fill="x", pady=(0, 8))

        self.result_label = tk.Label(
            result_box,
            textvariable=self.result_var,
            font=("Arial", 16, "bold"),
            bg="#eeeeee",
            fg="black",
            pady=12,
        )
        self.result_label.pack(fill="x", padx=10, pady=10)

        # Queue Debug
        queue_box = tk.LabelFrame(
            right,
            text="Debug hàng đợi",
            font=("Arial", 12, "bold"),
            bg="white",
        )
        queue_box.pack(fill="both", expand=False, pady=(0, 8))

        self.add_info_row(queue_box, "Queue Len:", self.queue_len_var)
        self.add_info_row(queue_box, "Queue Head:", self.queue_head_var)
        self.add_info_row(queue_box, "Queue Tail:", self.queue_tail_var)

        self.queue_text = tk.Text(
            queue_box,
            height=8,
            font=("Consolas", 10),
            state="disabled",
            bg="#f8f9fa",
            fg="black",
        )
        self.queue_text.pack(fill="both", expand=True, padx=10, pady=10)

        # Log
        log_box = tk.LabelFrame(
            right,
            text="Log",
            font=("Arial", 12, "bold"),
            bg="white",
        )
        log_box.pack(fill="both", expand=True)

        self.log_text = tk.Text(
            log_box,
            height=12,
            font=("Consolas", 10),
            state="disabled",
            bg="#111827",
            fg="white",
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=10)

    def add_info_row(self, parent, label_text, var):
        row = tk.Frame(parent, bg="white")
        row.pack(fill="x", padx=10, pady=4)

        tk.Label(
            row,
            text=label_text,
            width=12,
            anchor="w",
            bg="white",
            font=("Arial", 11, "bold"),
        ).pack(side="left")

        tk.Label(
            row,
            textvariable=var,
            anchor="w",
            bg="white",
            fg="#0b3d91",
            font=("Arial", 11),
        ).pack(side="left", fill="x", expand=True)

    # =========================
    # Controller creation
    # =========================
    def cleanup_startup_resources(self):
        resources = list(getattr(self, "startup_resources", []))
        self.startup_resources = []

        for name, obj, method in reversed(resources):
            try:
                if obj is not None:
                    getattr(obj, method)()
                    self.log(f"[RESET] Closed {name} after startup failure.")
            except Exception as e:
                self.log(f"[RESET] Close {name} error: {e}")

    def create_controller(self, image_threshold: float, conveyor_id: str):
        self.startup_resources = []
        self.set_status("Đang khởi động")
        self.set_camera_status("Đang kết nối")
        self.set_model_status("Đang tải")
        self.set_arduino_status("Đang kết nối")
        self.log("Bắt đầu khởi tạo hệ thống...")

        conveyor_id = str(conveyor_id).strip().upper()

        self.log(f"[CONFIG] Loading conveyor config: {conveyor_id}")
        self.conveyor_config = self.load_conveyor_config(conveyor_id)
        self.current_conveyor_id = conveyor_id

        serial_port = str(self.conveyor_config["serial_port"])
        baud_rate = int(self.conveyor_config["baud_rate"])
        image_threshold = float(self.conveyor_config["ai_threshold"])
        camera_trigger_delay = self.conveyor_config.get("camera_trigger_delay")
        camera_source = self.conveyor_config.get("camera_source")

        self.threshold_var.set(str(image_threshold))

        self.log(
            f"[CONFIG] Loaded: conveyor={conveyor_id}, "
            f"camera_source={camera_source}, "
            f"serial={serial_port}, baud={baud_rate}, "
            f"threshold={image_threshold}, "
            f"camera_delay={camera_trigger_delay}"
        )

        self.log("Load model...")
        model = PatchCoreEngine(
            CKPT_PATH,
            device="cuda",
            image_threshold=image_threshold,
        )
        self.set_model_status("Đã tải")

        self.log("Kết nối Arduino...")
        self.close_config_arduino()
        arduino = ArduinoComm(
            port=serial_port,
            baudrate=baud_rate,
            timeout=1,
        )
        self.startup_resources.append(("Arduino", arduino, "close"))
        arduino.connect()
        self.set_arduino_status(f"Đã kết nối ({serial_port})")

        self.log("Khởi tạo camera...")
        camera = HikCamera()
        self.startup_resources.append(("Camera", camera, "stop"))
        camera.start()
        self.set_camera_status("Đang chạy")

        if camera_trigger_delay is not None:
            try:
                camera.set_trigger_delay(float(camera_trigger_delay))
                self.log(f"Đã set camera trigger delay từ DB = {camera_trigger_delay}")
            except Exception as e:
                self.log(f"Không set được camera trigger delay từ DB: {e}")

        try:
            delay_value = camera.get_trigger_delay()
            self.set_camera_delay(str(delay_value))
            self.log(f"Camera delay hiện tại = {delay_value}")
        except Exception as e:
            self.set_camera_delay("Không đọc được")
            self.log(f"Không đọc được camera delay: {e}")

        queue = ResultQueue()
        logger = LatencyLogger()
        storage = StorageService()

        mongo = None
        try:
            mongo = MongoService()
            self.startup_resources.append(("MongoDB", mongo, "close"))
            self.log("MongoDB connected.")
        except Exception as e:
            self.log(f"Không kết nối được MongoDB, hệ thống vẫn chạy local: {e}")

        mqtt = None
        try:
            mqtt = MQTTService()
            self.startup_resources.append(("MQTT", mqtt, "disconnect"))
            mqtt.connect()
            self.log("MQTT connected.")
        except Exception as e:
            self.log(f"Không kết nối được MQTT, hệ thống vẫn chạy local: {e}")

        pipeline = PipelineService(
            camera=camera,
            model=model,
        )

        self.controller = SystemController(
            pipeline=pipeline,
            queue=queue,
            logger=logger,
            camera=camera,
            model=model,
            arduino=arduino,
            mqtt=mqtt,
            mongo=mongo,
            storage=storage,
            mqtt_topic_result=MQTT_TOPIC_INSPECTION_RESULT,
            callbacks=self.callbacks,
            conveyor_id=conveyor_id,
        )

        self.set_status("Đã khởi tạo")
        self.startup_resources = []
        self.log("Khởi tạo hệ thống hoàn tất.")

    # =========================
    # Control
    # =========================
    def start_from_gui_warning(self):
        messagebox.showwarning(
            "Start từ Web",
            "Hệ thống hiện lấy conveyor_id từ Web Monitor.\n"
            "Vui lòng bấm Start trên trang Web."
        )

    def apply_threshold(self):
        raw = self.threshold_var.get().strip()

        try:
            value = float(raw)
        except ValueError:
            messagebox.showerror("Lỗi", "Threshold phải là số.")
            return

        if self.controller is not None and self.controller.model is not None:
            try:
                self.controller.model.set_image_threshold(value)
                self.threshold_var.set(str(value))
                self.log(f"Đã cập nhật threshold runtime = {value}")
                self.log("Lưu ý: giá trị này chỉ áp dụng runtime, chưa ghi vào DB.")
            except Exception as e:
                messagebox.showerror("Lỗi", str(e))
        else:
            self.threshold_var.set(str(value))
            self.log(f"Threshold tạm thời = {value}. Khi start sẽ ưu tiên đọc DB.")

    def start_system(self, show_message=True, conveyor_id=None):
        try:
            if self.controller is not None and (
                bool(getattr(self.controller, "running", False))
                or self.runtime_status == "RUNNING"
            ):
                self.runtime_status = "RUNNING"
                self.set_status("Đang chạy")
                self.log("Hệ thống đang chạy.")
                self.publish_runtime_status()
                return

            if not conveyor_id:
                raise RuntimeError("Thiếu conveyor_id. Hãy start từ Web monitor.")

            conveyor_id = str(conveyor_id).strip().upper()

            self.current_conveyor_id = conveyor_id
            self.runtime_status = "STARTING"
            self.set_status("Đang khởi động")

            try:
                image_threshold = float(self.threshold_var.get().strip())
            except ValueError:
                image_threshold = DEFAULT_IMAGE_THRESHOLD

            self.log(f"[START] Starting system with conveyor_id={conveyor_id}")

            self.create_controller(
                image_threshold=image_threshold,
                conveyor_id=conveyor_id,
            )

            self.controller_thread = threading.Thread(
                target=self.controller.start,
                daemon=True,
            )
            self.controller_thread.start()

            self.runtime_status = "RUNNING"
            self.btn_start.config(state="disabled")
            self.btn_stop.config(state="normal")
            self.set_status("Đang chạy")
            self.log("Đã start controller thread.")

            self.publish_runtime_status()

        except Exception as e:
            self.runtime_status = "ERROR"
            self.log(f"Lỗi khởi động hệ thống: {e}")

            if show_message:
                messagebox.showerror("Lỗi", str(e))

            try:
                if self.controller is not None:
                    self.controller.cleanup()
            except Exception:
                pass
            self.cleanup_startup_resources()

            self.controller = None
            self.controller_thread = None
            self.btn_start.config(state="normal")
            self.btn_stop.config(state="disabled")
            self.set_status("Lỗi khởi động")
            self.publish_runtime_status()

    def stop_system(self):
        if self.controller is not None:
            try:
                self.runtime_status = "STOPPING"
                self.set_status("Đang dừng")

                self.controller.stop()

                self.runtime_status = "STOPPED"
                self.set_status("Đã dừng")
                self.btn_start.config(state="normal")
                self.btn_stop.config(state="disabled")
                self.log("Đã gửi lệnh dừng controller.")

                self.publish_runtime_status()
            except Exception as e:
                self.runtime_status = "ERROR"
                self.set_status("Lỗi")
                self.log(f"Lỗi khi dừng controller: {e}")
                self.publish_runtime_status()
        else:
            self.runtime_status = "STOPPED"
            self.set_status("Đã dừng")
            self.btn_start.config(state="normal")
            self.btn_stop.config(state="disabled")
            self.log("Controller chưa được khởi tạo.")
            self.publish_runtime_status()

    # =========================
    # Camera settings
    # =========================
    def open_camera_settings_window(self):
        win = tk.Toplevel(self.root)
        win.title("Cài đặt Camera")
        win.geometry("420x220")
        win.configure(bg="white")
        win.resizable(False, False)

        current_delay_var = tk.StringVar(value="-")
        new_delay_var = tk.StringVar(value="0")

        tk.Label(
            win,
            text="CÀI ĐẶT TRIGGER DELAY CAMERA",
            font=("Arial", 14, "bold"),
            bg="white",
            fg="#1f4e79",
        ).pack(pady=(15, 10))

        frame = tk.Frame(win, bg="white")
        frame.pack(fill="both", expand=True, padx=20, pady=10)

        row1 = tk.Frame(frame, bg="white")
        row1.pack(fill="x", pady=8)

        tk.Label(
            row1,
            text="Delay hiện tại:",
            font=("Arial", 11, "bold"),
            bg="white",
            width=16,
            anchor="w",
        ).pack(side="left")

        tk.Label(
            row1,
            textvariable=current_delay_var,
            font=("Arial", 11),
            bg="white",
            fg="#0b3d91",
            anchor="w",
        ).pack(side="left", fill="x", expand=True)

        row2 = tk.Frame(frame, bg="white")
        row2.pack(fill="x", pady=8)

        tk.Label(
            row2,
            text="Delay mới:",
            font=("Arial", 11, "bold"),
            bg="white",
            width=16,
            anchor="w",
        ).pack(side="left")

        tk.Entry(
            row2,
            textvariable=new_delay_var,
            font=("Arial", 11),
        ).pack(side="left", fill="x", expand=True, padx=(0, 8))

        tk.Label(
            row2,
            text="(µs / theo camera)",
            font=("Arial", 10),
            bg="white",
            fg="gray",
        ).pack(side="left")

        row3 = tk.Frame(frame, bg="white")
        row3.pack(fill="x", pady=20)

        tk.Button(
            row3,
            text="Đọc từ camera",
            font=("Arial", 10, "bold"),
            bg="#0d6efd",
            fg="white",
            command=lambda: self.read_camera_delay(current_delay_var, new_delay_var),
        ).pack(side="left", padx=(0, 8))

        tk.Button(
            row3,
            text="Cập nhật",
            font=("Arial", 10, "bold"),
            bg="#198754",
            fg="white",
            command=lambda: self.update_camera_delay(current_delay_var, new_delay_var),
        ).pack(side="left", padx=(0, 8))

        tk.Button(
            row3,
            text="Đóng",
            font=("Arial", 10, "bold"),
            bg="#6c757d",
            fg="white",
            command=win.destroy,
        ).pack(side="right")

        self.read_camera_delay(current_delay_var, new_delay_var)

    def read_camera_delay(self, current_delay_var=None, new_delay_var=None):
        try:
            if self.controller is None:
                raise RuntimeError("Controller chưa được khởi tạo.")

            delay_value = self.controller.get_camera_delay()
            delay_text = str(delay_value)

            if current_delay_var is not None:
                current_delay_var.set(delay_text)

            if new_delay_var is not None:
                new_delay_var.set(delay_text)

            self.set_camera_delay(delay_text)
            self.log(f"Đọc camera delay = {delay_text}")

        except Exception as e:
            if current_delay_var is not None:
                current_delay_var.set("Lỗi đọc")

            self.log(f"Lỗi đọc camera delay: {e}")
            messagebox.showerror("Lỗi", f"Không đọc được camera delay.\n{e}")

    def update_camera_delay(self, current_delay_var=None, new_delay_var=None):
        if new_delay_var is None:
            return

        raw = new_delay_var.get().strip()

        try:
            value = float(raw)
        except ValueError:
            messagebox.showerror("Lỗi", "Delay phải là số.")
            return

        try:
            if self.controller is None:
                raise RuntimeError("Controller chưa được khởi tạo.")

            actual_value = self.controller.set_camera_delay(value)
            actual_text = str(actual_value)

            if current_delay_var is not None:
                current_delay_var.set(actual_text)

            new_delay_var.set(actual_text)
            self.set_camera_delay(actual_text)

            self.log(f"Đã cập nhật camera delay runtime = {actual_text}")
            self.log("Lưu ý: giá trị này chỉ áp dụng runtime, chưa ghi vào DB.")
            messagebox.showinfo("Thành công", f"Đã cập nhật Trigger Delay = {actual_text}")

        except Exception as e:
            self.log(f"Lỗi cập nhật camera delay: {e}")
            messagebox.showerror("Lỗi", f"Không cập nhật được camera delay.\n{e}")

    # =========================
    # Display helpers
    # =========================
    def _to_photo(self, image, max_w=360, max_h=220):
        if image is None:
            return None

        if not isinstance(image, np.ndarray):
            return None

        if image.ndim == 2:
            img = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        elif image.ndim == 3:
            img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        else:
            return None

        h, w = img.shape[:2]
        scale = min(max_w / w, max_h / h)
        scale = max(scale, 1e-6)

        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))

        img = cv2.resize(img, (new_w, new_h))
        pil_img = Image.fromarray(img)
        return ImageTk.PhotoImage(pil_img)

    def clear_multiframe_results(self):
        def _():
            for i in range(3):
                self.orig_title_labels[i].config(text=f"Frame {i + 1}\nScore: - | Label: -")
                self.orig_image_labels[i].config(image="", text="Chưa có ảnh")
                self.overlay_image_labels[i].config(image="", text="Chưa có ảnh khoanh lỗi")
                self.frame_score_vars[i].set("-")
                self.frame_label_vars[i].set("-")

            self.orig_photos = [None, None, None]
            self.overlay_photos = [None, None, None]

        self.safe_ui(_)

    def update_multiframe_results(self, frame_results, avg_score, final_label, threshold_used):
        def _():
            for i in range(3):
                if i >= len(frame_results):
                    continue

                item = frame_results[i]
                score = float(item["pred_score"])
                label = str(item["pred_label"])
                frame = item["frame"]
                display_mask = item["display_mask"]

                self.frame_score_vars[i].set(f"{score:.6f} | {label}")

                self.orig_title_labels[i].config(
                    text=f"Frame {i + 1}\nScore: {score:.6f} | Label: {label}"
                )

                photo = self._to_photo(frame)
                self.orig_photos[i] = photo

                if photo is not None:
                    self.orig_image_labels[i].config(image=photo, text="")
                else:
                    self.orig_image_labels[i].config(image="", text="Lỗi hiển thị ảnh")

                if display_mask is not None:
                    overlay_photo = self._to_photo(display_mask)
                    self.overlay_photos[i] = overlay_photo

                    if overlay_photo is not None:
                        self.overlay_image_labels[i].config(image=overlay_photo, text="")
                    else:
                        self.overlay_image_labels[i].config(image="", text="Lỗi ảnh khoanh lỗi")
                else:
                    self.overlay_photos[i] = None
                    self.overlay_image_labels[i].config(image="", text="Không có ảnh khoanh lỗi")

            self.update_result_display(avg_score, final_label, threshold_used)

        self.safe_ui(_)

    def update_result_display(self, avg_score, final_label, threshold_used):
        label_str = str(final_label).strip().lower()

        self.score_var.set(f"{float(avg_score):.6f}")
        self.label_var.set(str(final_label))
        self.threshold_var.set(str(threshold_used))

        if label_str == "ng":
            self.result_var.set(
                f"SẢN PHẨM LỖI | AVG={float(avg_score):.6f} > TH={float(threshold_used):.6f}"
            )
            self.result_label.config(bg="#f8d7da", fg="#842029")

        elif label_str == "ok":
            self.result_var.set(
                f"SẢN PHẨM ĐẠT | AVG={float(avg_score):.6f} <= TH={float(threshold_used):.6f}"
            )
            self.result_label.config(bg="#d1e7dd", fg="#0f5132")

        else:
            self.result_var.set(f"Đang chờ / {label_str}")
            self.result_label.config(bg="#eeeeee", fg="black")

    # =========================
    # Cleanup
    # =========================
    def reset_ui(self):
        def _():
            self.status_var.set("Đã dừng")
            self.camera_var.set("Ngắt kết nối")
            self.camera_delay_var.set("-")
            self.model_var.set("Chưa tải")
            self.arduino_var.set("Ngắt kết nối")
            self.score_var.set("-")
            self.label_var.set("-")
            self.result_var.set("Chưa có kết quả")
            self.queue_len_var.set("0")
            self.queue_head_var.set("-")
            self.queue_tail_var.set("-")

            self.queue_text.config(state="normal")
            self.queue_text.delete("1.0", "end")
            self.queue_text.insert("end", "(queue rỗng)")
            self.queue_text.config(state="disabled")

            self.runtime_status = "STOPPED"
            self.btn_start.config(state="normal")
            self.btn_stop.config(state="disabled")
            self.clear_multiframe_results()
            self.log("Hệ thống đã dừng.")
            self.root.after(100, self.publish_runtime_status)

        self.safe_ui(_)

    def on_close(self):
        try:
            if hasattr(self, "control_command_service") and self.control_command_service is not None:
                self.control_command_service.disconnect()
        except Exception as e:
            self.log(f"Lỗi disconnect control MQTT: {e}")

        try:
            if self.controller is not None:
                self.controller.stop()
                self.controller.cleanup()
        except Exception as e:
            self.log(f"Lỗi khi đóng ứng dụng: {e}")

        self.close_config_arduino()

        self.root.destroy()
