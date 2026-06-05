from pymongo import MongoClient
from config import MONGO_URI, MONGO_DB_NAME


class ConveyorConfigService:
    def __init__(self, mongo_uri=MONGO_URI, db_name=MONGO_DB_NAME):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.collection = self.db["conveyor_configs"]

    def get_config(self, conveyor_id: str):
        if not conveyor_id:
            raise RuntimeError("conveyor_id is required")

        conveyor_id = str(conveyor_id).strip().upper()

        config = self.collection.find_one(
            {"conveyor_id": conveyor_id},
            {"_id": 0},
        )

        if not config:
            raise RuntimeError(f"Không tìm thấy cấu hình băng tải: {conveyor_id}")

        config = self.normalize_config(config)
        self.validate_config(config)

        return config

    def normalize_config(self, config: dict):
        config["conveyor_id"] = str(config.get("conveyor_id", "")).strip().upper()

        # =========================
        # Serial / AI threshold
        # =========================
        config["serial_port"] = str(config.get("serial_port", "")).strip()
        config["baud_rate"] = self.clamp_int(config.get("baud_rate"), 9600, 1200, 115200)
        config["ai_threshold"] = self.read_float(
            config.get("ai_threshold"),
            30.436506,
        )

        threshold_override = config.get("threshold_override")
        config["threshold_override"] = (
            self.read_float(threshold_override, None)
            if threshold_override not in [None, ""]
            else None
        )

        # =========================
        # Backward compatibility
        # Giữ lại vì controller/arduino cũ có thể vẫn dùng
        # =========================
        # config["speed"] = self.clamp_int(config.get("speed"), 150, 0, 255)
        # config["goc_home"] = self.clamp_int(config.get("goc_home"), 0, 0, 180)
        # config["goc_gat"] = self.clamp_int(config.get("goc_gat"), 120, 0, 180)

        # =========================
        # Camera / Model / Mode
        # =========================
        config["camera_id"] = str(config.get("camera_id", "")).strip()
        config["model_id"] = str(config.get("model_id", "")).strip()

        config_mode = str(config.get("config_mode", "PRODUCTION")).strip().upper()
        config["config_mode"] = config_mode if config_mode in ["PRODUCTION", "TEST"] else "PRODUCTION"

        mode = str(config.get("mode", "AUTO")).strip().upper()
        config["mode"] = mode or "AUTO"

        delay = config.get(
            "camera_trigger_delay_ms",
            config.get("camera_trigger_delay", 0),
        )
        config["camera_trigger_delay_ms"] = self.clamp_int(delay, 0, 0, 10000)
        config["camera_trigger_delay"] = config["camera_trigger_delay_ms"]

        # =========================
        # Arduino config mới
        # =========================
        config["arduino_speed_low_level"] = self.clamp_int(
            config.get("arduino_speed_low_level"),
            2,
            1,
            5,
        )
        config["arduino_speed_high_level"] = self.clamp_int(
            config.get("arduino_speed_high_level"),
            5,
            1,
            5,
        )
        config["arduino_servo_home_angle"] = self.clamp_int(
            config.get("arduino_servo_home_angle"),
            0,
            0,
            180,
        )
        config["arduino_servo_gate_angle"] = self.clamp_int(
            config.get("arduino_servo_gate_angle"),
            130,
            0,
            180,
        )
        config["arduino_light_min_lux"] = self.clamp_int(
            config.get("arduino_light_min_lux"),
            1000,
            0,
            3000,
        )
        config["arduino_light_max_lux"] = self.clamp_int(
            config.get("arduino_light_max_lux"),
            2000,
            0,
            3000,
        )

        return config

    def read_float(self, value, default_value):
        try:
            if value is None or value == "":
                return default_value
            return float(value)
        except Exception:
            return default_value

    def clamp_int(self, value, default_value, min_value, max_value):
        try:
            if value is None or value == "":
                number = default_value
            else:
                number = int(value)
        except Exception:
            number = default_value

        return max(min_value, min(number, max_value))

    def validate_config(self, config: dict):
        required_fields = [
            "conveyor_id",
            "serial_port",
            "baud_rate",
            "ai_threshold",
        ]

        missing_fields = [
            field
            for field in required_fields
            if config.get(field) is None or config.get(field) == ""
        ]

        if missing_fields:
            raise RuntimeError(
                f"Thiếu trường cấu hình băng tải: {', '.join(missing_fields)}"
            )

        if config["config_mode"] not in ["PRODUCTION", "TEST"]:
            raise RuntimeError("config_mode không hợp lệ. Chỉ nhận PRODUCTION hoặc TEST.")

        if config["arduino_speed_low_level"] >= config["arduino_speed_high_level"]:
            raise RuntimeError(
                "arduino_speed_low_level phải nhỏ hơn arduino_speed_high_level."
            )

        if config["arduino_light_min_lux"] >= config["arduino_light_max_lux"]:
            raise RuntimeError(
                "arduino_light_min_lux phải nhỏ hơn arduino_light_max_lux."
            )

        # if config["goc_home"] == config["goc_gat"]:
        #     raise RuntimeError("goc_home và goc_gat không nên trùng nhau.")

    def close(self):
        self.client.close()