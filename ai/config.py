import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)


def _load_env_file(path):
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as file:
        for raw_line in file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file(os.path.join(PROJECT_DIR, "web", ".env"))
_load_env_file(os.path.join(BASE_DIR, ".env"))

CKPT_PATH = os.path.join(BASE_DIR, "models", "model (12).ckpt")
CAMERA_USER_SET = os.getenv("CAMERA_USER_SET", "UserSet1")
MULTI_FRAME_COUNT = int(os.getenv("MULTI_FRAME_COUNT", "3"))
INSPECTION_DUPLICATE_WINDOW_SEC = float(os.getenv("INSPECTION_DUPLICATE_WINDOW_SEC", "5.0"))
INSPECTION_DUPLICATE_HASH_DISTANCE = int(os.getenv("INSPECTION_DUPLICATE_HASH_DISTANCE", "18"))

MQTT_BROKER = os.getenv("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "patchcore_ai_client")

MQTT_TOPIC_INSPECTION_RESULT = os.getenv("MQTT_TOPIC_INSPECTION_RESULT", "inspection/result")
MQTT_TOPIC_CONTROL_COMMAND = os.getenv("MQTT_TOPIC_CONTROL_COMMAND", "inspection/control/command")
MQTT_TOPIC_CONTROL_ACK = os.getenv("MQTT_TOPIC_CONTROL_ACK", "inspection/control/ack")
MQTT_TOPIC_SYSTEM_STATUS = os.getenv("MQTT_TOPIC_SYSTEM_STATUS", "inspection/system/status")
MQTT_TOPIC_SYSTEM_ERROR = os.getenv("MQTT_TOPIC_SYSTEM_ERROR", "inspection/system/error")

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("DATABASE") or "mongodb://127.0.0.1:27017/AIoT"
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "AIoT")
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME", "inspection_results")
MONGO_CONVEYOR_COLLECTION_NAME = os.getenv("MONGO_CONVEYOR_COLLECTION_NAME", "conveyor_configs")

STORAGE_BASE_DIR = os.getenv("STORAGE_BASE_DIR", os.path.join(BASE_DIR, "storage"))
STORAGE_PUBLIC_PREFIX = os.getenv("STORAGE_PUBLIC_PREFIX", "/images")
