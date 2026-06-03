import json
import os
import tempfile

from rewrite.config.config import AI_ACTIVE_MODEL_STATE_PATH


class RuntimeStateManager:
  def __init__(self, state_path=AI_ACTIVE_MODEL_STATE_PATH):
    self.state_path = state_path
    os.makedirs(os.path.dirname(self.state_path), exist_ok=True)

  def load(self):
    if not os.path.exists(self.state_path):
      return {
        "current_model": None,
        "rollback_model": None,
      }

    try:
      with open(self.state_path, "r", encoding="utf-8") as f:
        state = json.load(f)
    except Exception:
      return {
        "current_model": None,
        "rollback_model": None,
      }

    return {
      "current_model": state.get("current_model"),
      "rollback_model": state.get("rollback_model"),
    }

  def promote_current(self, model_config, local_path):
    state = self.load()
    previous_current = state.get("current_model")
    next_current = self._snapshot(model_config, local_path)

    rollback_model = previous_current
    if previous_current and previous_current.get("model_id") == next_current.get("model_id"):
      rollback_model = state.get("rollback_model")

    next_state = {
      "current_model": next_current,
      "rollback_model": rollback_model,
    }

    self.save(next_state)
    return next_state

  def save(self, state):
    os.makedirs(os.path.dirname(self.state_path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
      prefix="active_model_",
      suffix=".json",
      dir=os.path.dirname(self.state_path),
      text=True,
    )

    try:
      with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
      os.replace(temp_path, self.state_path)
    except Exception:
      if os.path.exists(temp_path):
        os.remove(temp_path)
      raise

  def _snapshot(self, model_config, local_path):
    return {
      "model_id": str(model_config.get("model_id")),
      "model_name": model_config.get("model_name"),
      "version": model_config.get("version"),
      "product_code": model_config.get("product_code"),
      "bucket": model_config.get("bucket"),
      "object_key": model_config.get("object_key"),
      "local_path": local_path,
      "threshold": float(model_config.get("threshold")),
      "model_format": model_config.get("model_format") or model_config.get("format"),
    }
