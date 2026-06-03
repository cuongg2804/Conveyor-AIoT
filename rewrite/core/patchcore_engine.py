import os
import shutil
import tempfile
import uuid

import cv2
import numpy as np
import torch

import anomalib
from anomalib.engine import Engine
from anomalib.models import Patchcore

if not hasattr(anomalib, "PrecisionType"):

  class PrecisionType(str):
    def __new__(cls, v, *args, **kwargs):
      return str.__new__(cls, v)

    FP32 = "fp32"
    FP16 = "fp16"

  anomalib.PrecisionType = PrecisionType

input_size = 256
default_image_threshold = 30
coreset_sampling_ratio = 0.05
PIXEL_THRESHOLD  = 0.3

class PatchCoreEngine:
  def __init__(self, ckpt_path, device="cuda", image_threshold= default_image_threshold, ):
    self.ckpt_path = ckpt_path
    self.image_threshold = float(image_threshold)
    self.device = None
    self.torch_device = None
    self.model = None
    self.engine = None
    self.model_status = "Not loaded"

    self._resolve_device_(device)
    self.load_model()

  def _resolve_device_ (self, device):
    requested_device = str(device).lower().strip()
    if requested_device in ["cuda", "cuda:0", "gpu"] and torch.cuda.is_available():
      self.device = "cuda"
      self.torch_device = torch.device("cuda:0")
    else:
      self.device = "cpu"
      self.torch_device = torch.device("cpu")

    print(f"Requested device: {device}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    print(f"Resolved device: {self.device}")

  def load_model(self):
    if not os.path.exists(self.ckpt_path):
      raise FileNotFoundError(f"Checkpoint not found: {self.ckpt_path}")

    try:
      checkpoint = torch.load(self.ckpt_path, map_location="cpu")

      hparams = checkpoint.get("hyper_parameters", {})
      if hasattr(hparams, "__dict__"):
        hparmas = vars(hparams)

      backbone = hparams.get("backbone")
      layers = hparams.get("layers")
      num_neighbors = hparams.get("num_neighbors")
      coreset_sampling_ratio = hparams.get("coreset_sampling_ratio")

      print("=== Load PatchCore Model ===")
      print(f"backbone: {backbone}")
      print(f"layers: {layers}")
      print(f"num_neighbors: {num_neighbors}")
      print(f"threshold: {self.image_threshold}")
      print(f"coreset_sampling_ratio: {coreset_sampling_ratio}")

      self.model = Patchcore(
        backbone=backbone,
        layers=layers,
        coreset_sampling_ratio=coreset_sampling_ratio,
        num_neighbors=num_neighbors,
        pre_trained=False,
        evaluator=False,
        visualizer=False,
      )

      self.model.load_state_dict(
        checkpoint["state_dict"],
        strict=False
      )
      #Nếu quên eval(), kết quả dự đoán có thể không ổn định hoặc sai lệch, đặc biệt với các model có BatchNorm/Dropout.
      self.model.eval()
      self.model = self.model.to(self.torch_device)


      self.engine = Engine(
        logger=False,
        enable_progress_bar=False,
        enable_model_summary=False,
        num_sanity_val_steps=0,
        accelerator="gpu" if self.device == "cuda" else "cpu",
        devices=1,
      )
      self.model_status = "LOADED"
      print("Model loaded")

    except Exception as e:
      self.model_status = "ERROR"
      raise RuntimeError(f"Cannot load PatchCore model: {e}")

  def get_status(self):
    return {
      "status": self.model_status,
      "ckpt_path": self.ckpt_path,
      "device": self.device,
      "threshold": self.image_threshold,
    }

  def _frames_to_tensor(self, frames):
    if not frames:
      raise ValueError("Frames is empty")

    tensors = []

    for idx, frame in enumerate(frames):
      if frame is None:
        raise ValueError(f"Frame {idx} is None")

      if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"Frame {idx} shape invalid: {frame.shape}")

      rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
      rgb = cv2.resize(rgb, (256, 256))

      arr = rgb.astype(np.float32) / 255.0
      tensor = torch.from_numpy(arr).permute(2, 0, 1)

      tensors.append(tensor)

    batch = torch.stack(tensors, dim=0)
    return batch.to(self.torch_device)

  def _to_numpy(self, value):
    if value is None:
      return None

    if isinstance(value, np.ndarray):
      return value

    if torch.is_tensor(value):
      return value.detach().cpu().numpy()

    try:
      return np.array(value)
    except Exception:
      return None

  def _normalize_mask_uint8(self, mask):
      if mask is None:
        return None

      mask = np.squeeze(mask)

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

  def _get_batch_item(self, value, index):
    if value is None:
      return None

    if torch.is_tensor(value):
      if value.ndim == 0:
        return value.detach().cpu()
      return value[index].detach().cpu()

    try:
      return value[index]
    except Exception:
      return value

  def _extract_prediction_from_batch(self, output, index):
    pred_score_raw = self._get_batch_item(output.pred_score, index)

    if pred_score_raw is None:
      pred_score = 0.0
    elif torch.is_tensor(pred_score_raw):
      pred_score = float(pred_score_raw.item())
    else:
      pred_score = float(pred_score_raw)

    pred_label = "OK" if pred_score <= self.image_threshold else "NG"

    anomaly_map = self._get_batch_item(output.anomaly_map, index)
    anomaly_map = self._to_numpy(anomaly_map)
    if anomaly_map is not None:
      anomaly_map = np.squeeze(anomaly_map).astype(np.float32)

    pred_mask = self._get_batch_item(output.pred_mask, index)
    pred_mask = self._to_numpy(pred_mask)
    pred_mask = self._normalize_mask_uint8(pred_mask)

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

    if self.model is None:
      raise RuntimeError("Model is not loaded")

    timing = {}

    t0 = cv2.getTickCount()

    batch = self._frames_to_tensor(frames)

    t1 = cv2.getTickCount()

    self.model.eval()

    with torch.no_grad():
      output = self.model(batch)

    if self.device == "cuda":
      torch.cuda.synchronize()

    t2 = cv2.getTickCount()

    results = [
      self._extract_prediction_from_batch(output, idx)
      for idx in range(len(frames))
    ]

    t3 = cv2.getTickCount()

    freq = cv2.getTickFrequency()
    timing["preprocess_ms"] = (t1 - t0) * 1000.0 / freq
    timing["model_forward_ms"] = (t2 - t1) * 1000.0 / freq
    timing["postprocess_ms"] = (t3 - t2) * 1000.0 / freq
    timing["total_ms"] = (t3 - t0) * 1000.0 / freq
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
