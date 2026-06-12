import time
import uuid
from pymongo import MongoClient

from rewrite.config.config import MONGO_URI, MONGO_DB_NAME


class ResultService:
  def __init__(self):
    self.client = MongoClient(MONGO_URI)
    self.client.admin.command("ping")
    self.db = self.client[MONGO_DB_NAME]
    self.collection = self.db["inspection_results"]
    self._drop_legacy_job_id_index()

  def _drop_legacy_job_id_index(self):
    indexes = self.collection.index_information()
    if "job_id_1" in indexes:
      self.collection.drop_index("job_id_1")
      print("Dropped legacy MongoDB index: inspection_results.job_id_1")

  def save_result(self, conveyor_id, stt, result, inspection_id=None):
    if inspection_id is None:
      inspection_id = f"INS-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    timestamp = time.time()

    frames = []
    for item in result.get("frames", []):
      frame_index = item.get("frame_index")
      frames.append({
        "frame_index": frame_index,
        "predicted_label": item.get("pred_label"),
        "predicted_score": float(item.get("pred_score", 0.0)),
        "roi_path": item.get("roi_path"),
        "overlay_path": item.get("overlay_path"),
      })

    document = {
      "inspection_id": inspection_id,
      "conveyor_id": conveyor_id,
      "mode": result.get("mode", "PRODUCTION"),
      "frames": frames,
      "stt": stt,
      "label": result.get("final_label"),
      "threshold": float(result.get("threshold", 0.0)),
      "timestamp": timestamp,
      "ng_count": int(result.get("ng_count", 0) or 0),
    }

    self.collection.insert_one(document)
    document["_id"] = str(document["_id"])
    return document

  def get_max_stt(self):
    doc = self.collection.find_one(
      {},
      sort=[("stt", -1)],
      projection={"stt": 1}
    )

    if not doc:
      return 0

    return int(doc.get("stt", 0) or 0)

  def close(self):
    self.client.close()
