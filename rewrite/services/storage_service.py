from io import BytesIO
import cv2
from minio import Minio
from rewrite.config.config import MINIO_INSPECTION_BUCKET, MINIO_ENDPOINT, MINIO_PORT, MINIO_ACCESS_KEY,MINIO_SECRET_KEY, MINIO_USE_SSL, MINIO_PUBLIC_URL
endpoint = f"{MINIO_ENDPOINT}:{MINIO_PORT}"
class StorageService:
  def __init__(self):
    self.bucket = MINIO_INSPECTION_BUCKET
    self.client = Minio(
      endpoint = endpoint,
      access_key=MINIO_ACCESS_KEY,
      secret_key=MINIO_SECRET_KEY,
      secure=MINIO_USE_SSL,
    )
    self.ensure_bucket()

  def ensure_bucket(self):
    if not self.client.bucket_exists(self.bucket):
      self.client.make_bucket(self.bucket)

  def upload_image(self, image, object_key):
    ok, encoded = cv2.imencode(
      ".jpg",
      image,
      [cv2.IMWRITE_JPEG_QUALITY, 85]
    )

    if not ok:
      raise RuntimeError("Failed to encode image")

    data = encoded.tobytes()

    self.client.put_object(
      self.bucket,
      object_key,
      BytesIO(data),
      len(data),
      content_type="image/jpeg",
    )

    url = f"{MINIO_PUBLIC_URL}/{self.bucket}/{object_key}"

    return {
      "object_key": object_key,
      "url": url,
    }
  def save_roi(self, conveyor_id, inspection_id, frame_index, roi_image):
    object_key = (
      f"inspections/{conveyor_id}/{inspection_id}/"
      f"frame_{frame_index}_roi.jpg"
    )

    return self.upload_image(roi_image, object_key)

  def save_overlay(self, conveyor_id, inspection_id, frame_index, overlay_image):
    object_key = (
      f"inspections/{conveyor_id}/{inspection_id}/"
      f"frame_{frame_index}_overlay.jpg"
    )

    return self.upload_image(overlay_image, object_key)
