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

        self.validate_config(config)

        return config

    def validate_config(self, config: dict):
        required_fields = [
            "conveyor_id",
            "camera_source",
            "serial_port",
            "baud_rate",
            "ai_threshold",
            "speed",
            "goc_home",
            "goc_gat"

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