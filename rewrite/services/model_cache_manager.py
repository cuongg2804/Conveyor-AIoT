import os
import shutil
import tempfile

from minio import Minio

from rewrite.config.config import (
  AI_MODEL_CACHE_DIR,
  MINIO_ACCESS_KEY,
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_SECRET_KEY,
  MINIO_USE_SSL,
)


class ModelCacheManager:
  def __init__(self, cache_dir=AI_MODEL_CACHE_DIR):
    self.cache_dir = cache_dir
    self.client = Minio(
      endpoint=f"{MINIO_ENDPOINT}:{MINIO_PORT}",
      access_key=MINIO_ACCESS_KEY,
      secret_key=MINIO_SECRET_KEY,
      secure=MINIO_USE_SSL,
    )
    os.makedirs(self.cache_dir, exist_ok=True)

  def get_local_path(self, model_config):
    model_id = self._required(model_config, "model_id")
    object_key = self._required(model_config, "object_key")
    extension = os.path.splitext(object_key)[1] or ".ckpt"
    return os.path.join(self.cache_dir, model_id, f"model{extension}")

  def ensure_cached(self, model_config):
    local_path = self.get_local_path(model_config)

    if self._is_valid_file(local_path):
      return local_path

    bucket = self._required(model_config, "bucket")
    object_key = self._required(model_config, "object_key")
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
      prefix="download_",
      suffix=os.path.splitext(local_path)[1],
      dir=os.path.dirname(local_path),
    )
    os.close(fd)

    try:
      self.client.fget_object(bucket, object_key, temp_path)

      if not self._is_valid_file(temp_path):
        raise RuntimeError(f"Downloaded model is empty: {bucket}/{object_key}")

      os.replace(temp_path, local_path)
      return local_path
    except Exception:
      if os.path.exists(temp_path):
        os.remove(temp_path)
      raise

  def prune(self, keep_model_ids):
    keep = {str(item) for item in keep_model_ids if item}

    if not os.path.isdir(self.cache_dir):
      return

    for name in os.listdir(self.cache_dir):
      path = os.path.join(self.cache_dir, name)
      if not os.path.isdir(path):
        continue
      if name not in keep:
        shutil.rmtree(path, ignore_errors=True)

  def _required(self, data, field):
    value = data.get(field)
    if value is None or str(value).strip() == "":
      raise RuntimeError(f"Missing model field: {field}")
    return str(value).strip()

  def _is_valid_file(self, path):
    return os.path.exists(path) and os.path.isfile(path) and os.path.getsize(path) > 0
