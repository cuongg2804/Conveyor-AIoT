import time
import traceback
import numpy as np

from core.contour_roi import crop_by_contour
from utils.image_utils import build_overlay


class PipelineService:
    def __init__(self, camera, model):
        self.camera = camera
        self.model = model
        self.last_skip_reason = None

    def _get_threshold(self):
        if hasattr(self.model, "image_threshold"):
            return self.model.image_threshold
        if hasattr(self.model, "threshold"):
            return self.model.threshold
        return 0.5

    def process_batch(self, num_frames=3):
        start_time = time.time()
        start_perf = time.perf_counter()
        self.last_skip_reason = None
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
            "pipeline_total_ms": 0.0,
        }

        try:
            print("[Pipeline] Waiting for frames...")

            capture_start = time.perf_counter()
            raw_frames = self.camera.wait_for_n_frames(
                n=num_frames,
                timeout_first=10.0,
                timeout_each=2.0
            )
            timings["capture_ms"] = (time.perf_counter() - capture_start) * 1000.0

            print("[Pipeline] raw_frames:", None if raw_frames is None else len(raw_frames))

            if raw_frames is None or len(raw_frames) == 0:
                self.last_skip_reason = "No frame received from camera"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            if len(raw_frames) < num_frames:
                self.last_skip_reason = f"Not enough frames: {len(raw_frames)}/{num_frames}"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            # =========================
            # 1. Crop ROI bằng contour
            # =========================
            roi_frames = []
            roi_messages = []

            print("[Pipeline] Start contour...")

            contour_start = time.perf_counter()
            for idx, raw_frame in enumerate(raw_frames, start=1):
                print(f"[Pipeline] Cropping frame {idx}")

                if raw_frame is None:
                    self.last_skip_reason = f"Frame {idx} is None"
                    print(f"[Pipeline] {self.last_skip_reason}")
                    return None

                roi, debug_img, msg = crop_by_contour(raw_frame)

                if roi is None:
                    self.last_skip_reason = f"Contour failed frame {idx}: {msg}"
                    print(f"[Pipeline] {self.last_skip_reason}")
                    return None

                if msg != "OK":
                    print(f"[Pipeline] Contour warning frame {idx}: {msg}, roi shape={roi.shape}")
                else:
                    print(f"[Pipeline] Contour OK frame {idx}, roi shape={roi.shape}")
                roi_frames.append(roi)
                roi_messages.append(msg)
            timings["contour_ms"] = (time.perf_counter() - contour_start) * 1000.0

            if len(roi_frames) != num_frames:
                self.last_skip_reason = f"ROI count invalid: {len(roi_frames)}/{num_frames}"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            # =========================
            # 2. Predict batch
            # =========================
            print("[Pipeline] Predict batch...")

            infer_start = time.perf_counter()
            results, infer_timing = self.model.predict_batch(roi_frames, return_timing=True)

            timings["infer_total_ms"] = (time.perf_counter() - infer_start) * 1000.0
            timings["infer_write_temp_ms"] = float(infer_timing.get("write_temp_ms", 0.0))
            timings["infer_engine_predict_ms"] = float(infer_timing.get("engine_predict_ms", 0.0))
            timings["infer_postprocess_ms"] = float(infer_timing.get("postprocess_ms", 0.0))

            per_frame_infer_ms = timings["infer_total_ms"] / max(1, len(roi_frames))
            for idx in range(1, min(3, len(roi_frames)) + 1):
                timings[f"infer_frame_{idx}_ms"] = per_frame_infer_ms

            print("[Pipeline] Predict done:", None if results is None else len(results))

            if results is None:
                self.last_skip_reason = "Predict returned None"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            if len(results) != num_frames:
                self.last_skip_reason = f"Predict result invalid: {len(results)}/{num_frames}"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            # =========================
            # 3. Lấy score từng frame
            # =========================
            fusion_start = time.perf_counter()
            scores = []
            threshold = self._get_threshold()

            for idx, result in enumerate(results, start=1):
                contour_msg = roi_messages[idx - 1] if idx - 1 < len(roi_messages) else "OK"
                if contour_msg == "Too close to left/right border":
                    forced_score = max(float(result.get("pred_score", 0.0)), float(threshold) + 1.0)
                    result["pred_score"] = forced_score
                    result["pred_label"] = "NG"
                    result["contour_warning"] = contour_msg
                    print(f"[Pipeline] Frame {idx}: forced NG due to contour warning: {contour_msg}")

                score = float(result.get("pred_score", 0.0))
                label = str(result.get("pred_label", "UNKNOWN"))

                print(f"[Pipeline] Frame {idx}: score={score:.6f}, label={label}")
                scores.append(score)

            if len(scores) == 0:
                self.last_skip_reason = "No scores"
                print(f"[Pipeline] {self.last_skip_reason}")
                return None

            # =========================
            # 4. Fusion kết quả
            # =========================
            avg_score = float(np.mean(scores))
            has_forced_ng = any(
                str(result.get("contour_warning", "")) == "Too close to left/right border"
                for result in results
            )
            final_label = "NG" if has_forced_ng or avg_score > threshold else "OK"

            print(
                f"[Pipeline] Fusion done: "
                f"avg_score={avg_score:.6f}, "
                f"threshold={threshold:.6f}, "
                f"final_label={final_label}"
            )
            timings["fusion_ms"] = (time.perf_counter() - fusion_start) * 1000.0

            # =========================
            # 5. Build frame result
            # =========================
            frame_results = []

            overlay_start = time.perf_counter()
            for idx, (roi_frame, result) in enumerate(zip(roi_frames, results), start=1):
                pred_mask = result.get("pred_mask", None)
                anomaly_map = result.get("anomaly_map", None)
                pred_label = str(result.get("pred_label", "UNKNOWN"))
                pred_score = float(result.get("pred_score", 0.0))

                display_mask = build_overlay(
                    frame=roi_frame,
                    pred_mask=pred_mask,
                    anomaly_map=anomaly_map,
                    pred_label=pred_label
                )


                frame_results.append({
                    "frame": roi_frame,
                    "display_mask": display_mask,
                    "pred_label": str(result.get("pred_label", "UNKNOWN")),
                    "pred_score": float(result.get("pred_score", 0.0)),
                    "pred_mask": pred_mask,
                    "anomaly_map": anomaly_map,
                    "contour_warning": result.get("contour_warning"),
                })
            timings["overlay_ms"] = (time.perf_counter() - overlay_start) * 1000.0

            latency = time.time() - start_time
            timings["pipeline_total_ms"] = (time.perf_counter() - start_perf) * 1000.0

            print(f"[Pipeline] Batch completed, latency={latency:.3f}s")

            return {
                "frames": frame_results,
                "avg_score": avg_score,
                "final_label": final_label,
                "threshold": threshold,
                "latency": latency,
                "timings": timings,
            }

        except Exception as e:
            self.last_skip_reason = str(e)
            print("[Pipeline] ERROR:", e)
            print(traceback.format_exc())
            return None
