from pymongo import MongoClient
from config import MONGO_URI, MONGO_DB_NAME


class ConveyorConfigService:
    def __init__(self, mongo_uri=MONGO_URI, db_name=MONGO_DB_NAME):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.collection = self.db["conveyor_configs"]

    def get_config(self, conveyor_code: str):
        if not conveyor_code:
            raise RuntimeError("conveyor_code is required")

        conveyor_code = str(conveyor_code).strip().upper()

        config = self.collection.find_one(
            {"conveyor_code": conveyor_code},
            {"_id": 0},
        )

        if not config:
            raise RuntimeError(f"Không tìm thấy cấu hình băng tải: {conveyor_code}")

        self.validate_config(config)

        return config

    def validate_config(self, config: dict):
        required_fields = [
            "conveyor_code",
            "camera_source",
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
                f"Thiếu trường cấu hình băng tải: {', '.join(missing_fields)}"
            )

    def close(self):
        self.client.close()