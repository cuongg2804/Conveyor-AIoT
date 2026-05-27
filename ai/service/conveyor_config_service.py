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
            raise RuntimeError(f"Khong tim thay cau hinh bang tai: {conveyor_id}")

        self.normalize_config(config)
        self.validate_config(config)

        return config

    def normalize_config(self, config: dict):
        config.setdefault("camera_source", config.get("camera_id"))
        config.setdefault("camera_trigger_delay", config.get("camera_trigger_delay_ms", 0))
        config.setdefault("arduino_speed_low_level", 2)
        config.setdefault("arduino_speed_high_level", 5)
        config.setdefault("arduino_servo_home_angle", 0)
        config.setdefault("arduino_servo_gate_angle", 130)
        config.setdefault("arduino_light_min_lux", 1000)
        config.setdefault("arduino_light_max_lux", 2000)

    def validate_config(self, config: dict):
        required_fields = [
            "conveyor_id",
            "serial_port",
            "baud_rate",
            "ai_threshold",
        ]

        missing_fields = [
            field for field in required_fields
            if config.get(field) is None or config.get(field) == ""
        ]

        if missing_fields:
            raise RuntimeError(
                f"Thieu truong cau hinh bang tai: {', '.join(missing_fields)}"
            )

        low_level = int(config.get("arduino_speed_low_level"))
        high_level = int(config.get("arduino_speed_high_level"))
        home_angle = int(config.get("arduino_servo_home_angle"))
        gate_angle = int(config.get("arduino_servo_gate_angle"))
        min_lux = int(config.get("arduino_light_min_lux"))
        max_lux = int(config.get("arduino_light_max_lux"))

        if low_level < 1 or high_level > 5 or low_level >= high_level:
            raise RuntimeError("Toc do Arduino LOW/HIGH khong hop le")
        if not 0 <= home_angle <= 180 or not 0 <= gate_angle <= 180:
            raise RuntimeError("Goc servo Arduino khong hop le")
        if min_lux < 0 or max_lux > 3000 or min_lux >= max_lux:
            raise RuntimeError("Nguong anh sang Arduino khong hop le")

    def close(self):
        self.client.close()
