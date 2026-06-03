from pathlib import Path


def detect_model_format(model_path, model_config=None):
  configured = None
  if model_config:
    configured = model_config.get("model_format") or model_config.get("format")

  if configured:
    normalized = str(configured).strip().lower()
    if normalized in ["ckpt", "checkpoint", "pytorch"]:
      return "ckpt"
    if normalized in ["onnx"]:
      return "onnx"

  suffix = Path(str(model_path)).suffix.lower()
  if suffix == ".ckpt":
    return "ckpt"
  if suffix == ".onnx":
    return "onnx"

  raise RuntimeError(f"Unsupported model format: {model_path}")


def create_model_engine(model_path, threshold, device="cuda", model_config=None):
  model_format = detect_model_format(model_path, model_config=model_config)

  if model_format == "ckpt":
    from rewrite.core.patchcore_engine import PatchCoreEngine

    return PatchCoreEngine(
      model_path,
      device=device,
      image_threshold=threshold,
    )

  if model_format == "onnx":
    from rewrite.core.patchcore_onnx_engine import PatchCoreOnnxEngine

    return PatchCoreOnnxEngine(
      model_path,
      device=device,
      image_threshold=threshold,
    )

  raise RuntimeError(f"Unsupported model format: {model_format}")
