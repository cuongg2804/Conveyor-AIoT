import os
import time

import cv2
import numpy as np

PIXEL_THRESHOLD = 0.3


class PatchCoreOnnxEngine:
  def __init__(self, onnx_path, device="cuda", image_threshold=30):
    self.onnx_path = onnx_path
    self.image_threshold = float(image_threshold)
    self.device = None
    self.session = None
    self.input_name = None
    self.input_height = 256
    self.input_width = 256
    self.output_names = []
    self.model_status = "Not loaded"

    self._resolve_device(device)
    self.load_model()

  def _resolve_device(self, device):
    requested_device = str(device).lower().strip()

    try:
      import onnxruntime as ort
    except Exception as e:
      raise RuntimeError(
        "onnxruntime is not installed. Install onnxruntime-gpu for CUDA or onnxruntime for CPU."
      ) from e

    available = ort.get_available_providers()
    if requested_device in ["cuda", "cuda:0", "gpu"] and "CUDAExecutionProvider" in available:
      self.device = "cuda"
    else:
      self.device = "cpu"

    print(f"Requested ONNX device: {device}")
    print(f"Available ONNX providers: {available}")
    print(f"Resolved ONNX device: {self.device}")

  def load_model(self):
    if not os.path.exists(self.onnx_path):
      raise FileNotFoundError(f"ONNX model not found: {self.onnx_path}")

    try:
      import onnxruntime as ort

      session_options = ort.SessionOptions()
      session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

      providers = ["CPUExecutionProvider"]
      if self.device == "cuda":
        providers = [
          ("CUDAExecutionProvider", {
            "device_id": 0,
            "arena_extend_strategy": "kNextPowerOfTwo",
            "gpu_mem_limit": 3 * 1024 * 1024 * 1024,
            "cudnn_conv_algo_search": "EXHAUSTIVE",
            "do_copy_in_default_stream": True,
          }),
          "CPUExecutionProvider",
        ]

      self.session = ort.InferenceSession(
        self.onnx_path,
        sess_options=session_options,
        providers=providers,
      )

      input_info = self.session.get_inputs()[0]
      self.input_name = input_info.name
      self.input_height, self.input_width = self._get_input_hw(input_info.shape)
      self.output_names = [item.name for item in self.session.get_outputs()]
      self.model_status = "LOADED"

      print("=== Load PatchCore ONNX Model ===")
      print(f"path: {self.onnx_path}")
      print(f"provider: {self.session.get_providers()[0]}")
      print(f"input: {self.input_name} {self.input_height}x{self.input_width}")
      print(f"outputs: {self.output_names}")
      print(f"threshold: {self.image_threshold}")
    except Exception as e:
      self.model_status = "ERROR"
      raise RuntimeError(f"Cannot load ONNX model: {e}")

  def _get_input_hw(self, input_shape):
    height = input_shape[2] if len(input_shape) > 2 and isinstance(input_shape[2], int) else 256
    width = input_shape[3] if len(input_shape) > 3 and isinstance(input_shape[3], int) else 256
    return int(height), int(width)

  def get_status(self):
    return {
      "status": self.model_status,
      "onnx_path": self.onnx_path,
      "device": self.device,
      "threshold": self.image_threshold,
      "format": "onnx",
      "provider": self.session.get_providers()[0] if self.session is not None else None,
    }

  def _frames_to_numpy(self, frames):
    if not frames:
      raise ValueError("Frames is empty")

    batch = []
    for idx, frame in enumerate(frames):
      if frame is None:
        raise ValueError(f"Frame {idx} is None")

      if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"Frame {idx} shape invalid: {frame.shape}")

      rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
      rgb = cv2.resize(rgb, (self.input_width, self.input_height))
      arr = rgb.astype(np.float32) / 255.0
      arr = np.transpose(arr, (2, 0, 1))
      batch.append(arr)

    return np.stack(batch, axis=0).astype(np.float32)

  def _output_map(self, outputs):
    return {
      name: value
      for name, value in zip(self.output_names, outputs)
    }

  def _pick_output(self, output_map, names):
    normalized = {key.lower(): value for key, value in output_map.items()}
    for name in names:
      value = normalized.get(name.lower())
      if value is not None:
        return value
    return None

  def _get_batch_item(self, value, index):
    if value is None:
      return None

    arr = np.asarray(value)
    if arr.ndim == 0:
      return arr
    if arr.shape[0] > index:
      return arr[index]
    return arr

  def _to_score(self, value):
    if value is None:
      return 0.0

    arr = np.squeeze(np.asarray(value))
    if arr.size == 0:
      return 0.0
    return float(arr.reshape(-1)[0])

  def _normalize_mask_uint8(self, value):
    if value is None:
      return None

    mask = np.squeeze(np.asarray(value))
    if mask.ndim == 3:
      if mask.shape[0] in [1, 3] and mask.shape[0] != mask.shape[-1]:
        mask = np.transpose(mask, (1, 2, 0))
      if mask.ndim == 3:
        mask = mask[..., 0]

    if mask.dtype == np.bool_:
      return mask.astype(np.uint8) * 255

    if mask.dtype != np.uint8:
      mask = mask.astype(np.float32)
      if mask.max() <= 1.0:
        mask = mask * 255.0
      mask = np.clip(mask, 0, 255).astype(np.uint8)

    return mask

  def _extract_prediction(self, output_map, index):
    score_values = self._pick_output(output_map, ["pred_score", "score", "image_score"])
    anomaly_values = self._pick_output(output_map, ["anomaly_map", "anomaly_maps", "heat_map"])
    mask_values = self._pick_output(output_map, ["pred_mask", "mask", "pred_masks", "segmentations"])

    pred_score = self._to_score(self._get_batch_item(score_values, index))
    anomaly_map = self._get_batch_item(anomaly_values, index)
    if anomaly_map is not None:
      anomaly_map = np.squeeze(np.asarray(anomaly_map)).astype(np.float32)

    pred_mask = self._normalize_mask_uint8(self._get_batch_item(mask_values, index))
    pred_label = "OK" if pred_score < self.image_threshold else "NG"

    if pred_mask is None and anomaly_map is not None:
      amap_norm = cv2.normalize(anomaly_map, None, 0, 1.0, cv2.NORM_MINMAX)
      pred_mask = (amap_norm > PIXEL_THRESHOLD).astype(np.uint8) * 255

    return {
      "pred_score": pred_score,
      "pred_label": pred_label,
      "image_threshold": self.image_threshold,
      "anomaly_map": anomaly_map,
      "pred_mask": pred_mask,
    }

  def predict_batch(self, frames, return_timing=False):
    if not frames:
      if return_timing:
        return [], {}
      return []

    if self.session is None:
      raise RuntimeError("ONNX model is not loaded")

    timing = {}
    t0 = time.perf_counter()
    batch = self._frames_to_numpy(frames)
    t1 = time.perf_counter()

    outputs = self.session.run(None, {self.input_name: batch})
    t2 = time.perf_counter()

    output_map = self._output_map(outputs)
    results = [
      self._extract_prediction(output_map, idx)
      for idx in range(len(frames))
    ]
    t3 = time.perf_counter()

    timing["preprocess_ms"] = (t1 - t0) * 1000.0
    timing["model_forward_ms"] = (t2 - t1) * 1000.0
    timing["postprocess_ms"] = (t3 - t2) * 1000.0
    timing["total_ms"] = (t3 - t0) * 1000.0
    timing["batch_size"] = len(frames)
    timing["per_frame_ms"] = timing["total_ms"] / max(1, len(frames))

    if return_timing:
      return results, timing

    return results

  def predict(self, frame, return_timing=False):
    results, timing = self.predict_batch([frame], return_timing=True)

    if not results:
      raise RuntimeError("No prediction result")

    if return_timing:
      return results[0], timing

    return results[0]
