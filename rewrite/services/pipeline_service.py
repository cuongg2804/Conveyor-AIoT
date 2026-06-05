from rewrite.core.contour import crop_by_contour
import cv2
import time
from rewrite.utils.image_utils import build_overlay

class PipelineService:
  def __init__(self, camera, model, threshold, num_frames = 3, should_stop=None):
    self.camera = camera
    self.model = model
    self.threshold = float(threshold)
    self.num_frames = int(num_frames)
    self.should_stop = should_stop
    self.last_error = None

  def inspect_once(self):
    self.last_error = None
    pipeline_start = time.perf_counter()
    timings = {
      "capture_ms": 0.0,
      "contour_ms": 0.0,
      "infer_total_ms": 0.0,
      "infer_write_temp_ms": 0.0,
      "infer_engine_predict_ms": 0.0,
      "infer_postprocess_ms": 0.0,
      "infer_frame_1_ms": 0.0,
      "infer_frame_2_ms": 0.0,
      "infer_frame_3_ms": 0.0,
      "fusion_ms": 0.0,
      "overlay_ms": 0.0,
      "pipeline_total_ms": 0.0
    }

    capture_start = time.perf_counter()
    frames = self.camera.wait_for_n_frames(
      n = self.num_frames,
      timeout_first = 10.0,
      timeout_each=2.0,
      should_stop=self.should_stop,
    )
    timings["capture_ms"] = (time.perf_counter() - capture_start) * 1000.0

    if callable(self.should_stop) and self.should_stop():
      self.last_error = "Inspection stopped"
      return None

    if not frames:
      self.last_error = "No frame received from camera"
      return None

    if len(frames) < self.num_frames:
      self.last_error = f"Not enough frames: {len(frames)}/{self.num_frames}"
      return None

    contour_start = time.perf_counter()
    roi_frames = []
    contour_messages = []
    raw_frames = []
    contour_warnings = []

    for idx, frame in enumerate(frames, start=1):
      if callable(self.should_stop) and self.should_stop():
        self.last_error = "Inspection stopped"
        return None

      roi, debug, msg = crop_by_contour(frame)

      if roi is None:
        if "Too close to left/right border" not in str(msg):
          self.last_error = f"Contour failed frame {idx}: {msg}"
          return None

        roi = cv2.resize(frame, (256, 256), interpolation=cv2.INTER_AREA)
        msg = f"{msg}; fallback_raw_resize"
        contour_warnings.append({
          "frame_index": idx,
          "message": msg,
        })

      roi_frames.append(roi)
      contour_messages.append(msg)
      raw_frames.append(frame)

    timings["contour_ms"] = (time.perf_counter() - contour_start) * 1000.0

    if callable(self.should_stop) and self.should_stop():
      self.last_error = "Inspection stopped"
      return None

    infer_start = time.perf_counter()
    predictions, infer_timing = self.model.predict_batch(roi_frames, return_timing=True)
    timings["infer_total_ms"] = (time.perf_counter() - infer_start) * 1000.0
    timings["infer_write_temp_ms"] = float(infer_timing.get("write_temp_ms", 0.0))
    timings["infer_engine_predict_ms"] = float(
      infer_timing.get("engine_predict_ms", infer_timing.get("model_forward_ms", 0.0))
    )
    timings["infer_postprocess_ms"] = float(infer_timing.get("postprocess_ms", 0.0))

    per_frame_infer_ms = float(
      infer_timing.get(
        "per_frame_ms",
        timings["infer_total_ms"] / max(1, len(roi_frames)),
      )
    )
    for idx in range(1, min(3, len(roi_frames)) + 1):
      timings[f"infer_frame_{idx}_ms"] = per_frame_infer_ms

    if not predictions:
      self.last_error = "Model returned no predictions"
      return None

    if len(predictions) != len(roi_frames):
      self.last_error = f"Prediction count invalid: {len(predictions)}/{len(roi_frames)}"
      return None

    fusion_start = time.perf_counter()
    scores = [float(item["pred_score"]) for item in predictions]
    forced_ng_indexes = {
      item["frame_index"]
      for item in contour_warnings
    }
    ng_count = sum(score >= self.threshold for score in scores)
    final_label = "NG" if forced_ng_indexes or ng_count >= 2 else "OK"

    timings["fusion_ms"] = (time.perf_counter() - fusion_start) * 1000.0
    frame_results = []

    overlay_start = time.perf_counter()
    for idx, (raw_frame, roi, pred, contour_msg) in enumerate(
      zip(raw_frames, roi_frames, predictions, contour_messages),
      start=1
    ):
      pred_score = float(pred["pred_score"])
      pred_label = "NG" if pred_score >= self.threshold else "OK"
      if idx in forced_ng_indexes:
        pred_score = max(pred_score, self.threshold + 1.0)
        pred_label = "NG"
      pred_mask = pred.get("pred_mask")
      anomaly_map = pred.get("anomaly_map")

      display_mask = build_overlay(
        frame=roi,
        pred_mask=pred_mask,
        anomaly_map=anomaly_map,
        pred_label=pred_label,
      )
      frame_results.append({
        "frame_index": idx,
        "raw_frame": raw_frame,
        "roi": roi,
        "pred_score": pred_score,
        "pred_label": pred_label,
        "pred_mask": pred_mask,
        "anomaly_map": anomaly_map,
        "contour_msg": contour_msg,
        "contour_warning": contour_msg if idx in forced_ng_indexes else None,
        "display_mask": display_mask
      })
    timings["overlay_ms"] = (time.perf_counter() - overlay_start) * 1000.0

    timings["pipeline_total_ms"] = (time.perf_counter() - pipeline_start) * 1000.0
    return {
      "frames": frame_results,
      "scores": scores,
      "ng_count": ng_count,
      "threshold": self.threshold,
      "final_label": final_label,
      "contour_warnings": contour_warnings,
      "timings": timings,
    }
