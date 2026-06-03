from pymongo import MongoClient
from rewrite.config.config import MONGO_URI, MONGO_DB_NAME, MONGO_CONVEYOR_COLLECTION_NAME

class ConfigService:
  def __init__(self) :
    if not MONGO_URI:
      raise RuntimeError("MONGO_URI is missing")

    try:
            self.client = MongoClient(MONGO_URI)

            # Kiểm tra kết nối
            self.client.admin.command("ping")

            print("Connected to MongoDB successfully")

            self.db = self.client[MONGO_DB_NAME]
            self.collection = self.db[MONGO_CONVEYOR_COLLECTION_NAME]

    except Exception as e:
        print("❌ Failed to connect MongoDB")
        raise RuntimeError(f"MongoDB connection error: {e}")


  def close(self):
    self.client.close()
  def get_config(self, conveyor_id):
    if not conveyor_id:
      raise RuntimeError("Conveyor_id is missing")

    conveyor_id = str(conveyor_id).strip().upper()
    print(conveyor_id)
    config = self.collection.find_one({
      "conveyor_id" : conveyor_id
    })

    print(config)
    if not config:
      raise RuntimeError(f"Config not found")

    return config