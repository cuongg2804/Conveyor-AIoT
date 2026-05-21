from pymongo import MongoClient, DESCENDING
from typing import Optional, Dict, Any, List
from config import MONGO_URI, MONGO_DB_NAME, MONGO_COLLECTION_NAME


class MongoService:
    def __init__(
        self,
        db_name: str = MONGO_DB_NAME,
        collection_name: str = MONGO_COLLECTION_NAME,
        uri: str = MONGO_URI,
    ):
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        self.collection = self.db[collection_name]
        self._ensure_indexes()

    def _has_index(self, name: str) -> bool:
        return name in self.collection.index_information()

    def _ensure_indexes(self) -> None:
        indexes = self.collection.index_information()

        if "stt_1" not in indexes:
            self.collection.create_index("stt")

        if "conveyor_id_1" not in indexes:
            self.collection.create_index("conveyor_id")

        if "timestamp_-1" not in indexes and "timestamp_1" not in indexes:
            self.collection.create_index([("timestamp", DESCENDING)])

        if "inspection_id_1" not in indexes:
            self.collection.create_index("inspection_id", unique=True, sparse=True)

    def insert_result(self, document: Dict[str, Any]) -> str:
        result = self.collection.insert_one(document)
        return str(result.inserted_id)

    def upsert_result(self, document: Dict[str, Any]) -> None:
        inspection_id = document.get("inspection_id")
        if inspection_id:
            self.collection.update_one({"inspection_id": inspection_id}, {"$set": document}, upsert=True)
            return

        stt = document.get("stt")
        if stt is None:
            raise ValueError("Document must have field 'inspection_id' or 'stt'.")

        self.collection.update_one({"stt": stt}, {"$set": document}, upsert=True)

    def get_max_stt(self) -> int:
        latest = self.collection.find_one({}, {"stt": 1}, sort=[("stt", DESCENDING)])
        if not latest:
            return 0
        try:
            return int(latest.get("stt") or 0)
        except Exception:
            return 0

    def get_by_stt(self, stt: int) -> Optional[Dict[str, Any]]:
        return self.collection.find_one({"stt": stt}, {"_id": 0})

    def get_latest_result(self, conveyor_id: str = None) -> Optional[Dict[str, Any]]:
        filter_query = {"conveyor_id": conveyor_id} if conveyor_id else {}
        return self.collection.find_one(filter_query, {"_id": 0}, sort=[("timestamp", DESCENDING)])

    def get_recent_results(self, limit: int = 20, conveyor_id: str = None) -> List[Dict[str, Any]]:
        filter_query = {"conveyor_id": conveyor_id} if conveyor_id else {}
        cursor = self.collection.find(filter_query, {"_id": 0}).sort("timestamp", DESCENDING).limit(limit)
        return list(cursor)

    def close(self) -> None:
        self.client.close()
