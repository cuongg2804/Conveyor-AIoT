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

        config["serial_port"] = str(config.get("serial_port", "")).strip()
        config["baud_rate"] = int(config.get("baud_rate") or 9600)
        config["ai_threshold"] = float(config.get("ai_threshold") or 30.436506)

        config["speed"] = self.clamp_int(config.get("speed"), 150, 0, 255)
        config["goc_home"] = self.clamp_int(config.get("goc_home"), 0, 0, 180)
        config["goc_gat"] = self.clamp_int(config.get("goc_gat"), 120, 0, 180)

        return config

    def clamp_int(self, value, default_value, min_value, max_value):
        try:
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
            "speed",
            "goc_home",
            "goc_gat",
        ]

        missing_fields = [
            field for field in required_fields
            if config.get(field) is None or config.get(field) == ""
        ]

        if missing_fields:
            raise RuntimeError(
                f"Thiếu trường cấu hình băng tải: {', '.join(missing_fields)}"
            )

    def close(self):
        self.client.close()