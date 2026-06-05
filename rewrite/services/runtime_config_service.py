import json
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from rewrite.config.config import BACKEND_BASE_URL


class RuntimeConfigService:
  def __init__(self, base_url=BACKEND_BASE_URL, timeout=10):
    self.base_url = base_url.rstrip("/")
    self.timeout = timeout

  def get_config(self, conveyor_id):
    conveyor_id = str(conveyor_id or "").strip().upper()
    if not conveyor_id:
      raise RuntimeError("conveyor_id is required")

    url = f"{self.base_url}/api/runtime-config/{conveyor_id}"

    try:
      with urlopen(url, timeout=self.timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
      body = e.read().decode("utf-8", errors="ignore")
      raise RuntimeError(f"Backend runtime config error {e.code}: {body}")
    except URLError as e:
      raise RuntimeError(f"Cannot connect backend runtime config API: {e.reason}")

    if not payload.get("success"):
      raise RuntimeError(payload.get("message") or "Backend returned invalid runtime config")

    data = payload.get("data") or {}
    model = data.get("model") or {}
    threshold = float(data.get("threshold"))
    model["threshold"] = threshold

    return {
      **data,
      "conveyor_id": conveyor_id,
      "conveyor_code": conveyor_id,
      "ai_threshold": threshold,
      "model": model,
    }
