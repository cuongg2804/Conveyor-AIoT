import os
from pathlib import Path

MONGO_URI = os.getenv("MONGO_URI", "mongodb://admin:admin123456@localhost:27018/conveyor_aiot?authSource=admin")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "AIoT")
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME", "inspection_results")
MONGO_CONVEYOR_COLLECTION_NAME = os.getenv("MONGO_CONVEYOR_COLLECTION_NAME", "conveyor_configs")

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost")
MINIO_PORT = int(os.getenv("MINIO_PORT", "9000"))
MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "false").lower() == "true"
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin123456")
MINIO_INSPECTION_BUCKET = os.getenv("MINIO_INSPECTION_BUCKET", "inspection-images")
MINIO_PUBLIC_URL = os.getenv(
  "MINIO_PUBLIC_URL",
  f"{'https' if MINIO_USE_SSL else 'http'}://{MINIO_ENDPOINT}:{MINIO_PORT}"
)

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:3000")
AI_MODEL_CACHE_DIR = os.getenv(
  "AI_MODEL_CACHE_DIR",
  str(Path(__file__).resolve().parents[1] / "ai_models" / "cache")
)
AI_ACTIVE_MODEL_STATE_PATH = os.getenv(
  "AI_ACTIVE_MODEL_STATE_PATH",
  str(Path(__file__).resolve().parents[1] / "ai_models" / "active_model.json")
)

MQTT_BROKER = os.getenv("MQTT_BROKER") or os.getenv("MQTT_HOST") or "localhost"
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "rewrite_ai_client")

MQTT_TOPIC_INSPECTION_RESULT = os.getenv("MQTT_TOPIC_INSPECTION_RESULT", "inspection/result")
MQTT_TOPIC_CONTROL_COMMAND = os.getenv("MQTT_TOPIC_CONTROL_COMMAND", "inspection/control/command")
MQTT_TOPIC_CONTROL_ACK = os.getenv("MQTT_TOPIC_CONTROL_ACK", "inspection/control/ack")
MQTT_TOPIC_SYSTEM_STATUS = os.getenv("MQTT_TOPIC_SYSTEM_STATUS", "inspection/system/status")
MQTT_TOPIC_SYSTEM_ERROR = os.getenv("MQTT_TOPIC_SYSTEM_ERROR", "inspection/system/error")
