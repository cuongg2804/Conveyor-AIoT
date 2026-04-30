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

        if "job_id_1" not in indexes:
            self.collection.create_index("job_id")

        if "conveyor_code_1" not in indexes:
            self.collection.create_index("conveyor_code")

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

        job_id = document.get("job_id")
        if job_id is None:
            raise ValueError("Document must have field 'inspection_id' or 'job_id'.")

        self.collection.update_one({"job_id": job_id}, {"$set": document}, upsert=True)

    def get_max_job_id(self) -> int:
        latest = self.collection.find_one({}, {"job_id": 1}, sort=[("job_id", DESCENDING)])
        if not latest:
            return 0
        try:
            return int(latest.get("job_id") or 0)
        except Exception:
            return 0

    def get_by_job_id(self, job_id: int) -> Optional[Dict[str, Any]]:
        return self.collection.find_one({"job_id": job_id}, {"_id": 0})

    def get_latest_result(self, conveyor_code: str = None) -> Optional[Dict[str, Any]]:
        filter_query = {"conveyor_code": conveyor_code} if conveyor_code else {}
        return self.collection.find_one(filter_query, {"_id": 0}, sort=[("timestamp", DESCENDING)])

    def get_recent_results(self, limit: int = 20, conveyor_code: str = None) -> List[Dict[str, Any]]:
        filter_query = {"conveyor_code": conveyor_code} if conveyor_code else {}
        cursor = self.collection.find(filter_query, {"_id": 0}).sort("timestamp", DESCENDING).limit(limit)
        return list(cursor)

    def close(self) -> None:
        self.client.close()
