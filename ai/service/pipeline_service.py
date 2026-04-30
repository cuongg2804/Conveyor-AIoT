import time
import traceback
import numpy as np

from core.contour_roi import crop_by_contour
from utils.image_utils import build_overlay


class PipelineService:
    def __init__(self, camera, model):
        self.camera = camera
        self.model = model

    def _get_threshold(self):
        if hasattr(self.model, "image_threshold"):
            return self.model.image_threshold
        if hasattr(self.model, "threshold"):
            return self.model.threshold
        return 0.5

    def process_batch(self, num_frames=3):
        start_time = time.time()

        try:
            print("[Pipeline] Waiting for frames...")

            raw_frames = self.camera.wait_for_n_frames(
                n=num_frames,
                timeout_first=10.0,
                timeout_each=2.0
            )

            print("[Pipeline] raw_frames:", None if raw_frames is None else len(raw_frames))

            if raw_frames is None or len(raw_frames) == 0:
                print("[Pipeline] No frame received")
                return None

            if len(raw_frames) < num_frames:
                print(f"[Pipeline] Not enough frames: {len(raw_frames)}/{num_frames}")
                return None

            # =========================
            # 1. Crop ROI bằng contour
            # =========================
            roi_frames = []

            print("[Pipeline] Start contour...")

            for idx, raw_frame in enumerate(raw_frames, start=1):
                print(f"[Pipeline] Cropping frame {idx}")

                if raw_frame is None:
                    print(f"[Pipeline] Frame {idx} is None")
                    return None

                roi, debug_img, msg = crop_by_contour(raw_frame)

                if roi is None:
                    print(f"[Pipeline] Contour failed frame {idx}: {msg}")
                    return None

                print(f"[Pipeline] Contour OK frame {idx}, roi shape={roi.shape}")
                roi_frames.append(roi)

            if len(roi_frames) != num_frames:
                print(f"[Pipeline] ROI count invalid: {len(roi_frames)}/{num_frames}")
                return None

            # =========================
            # 2. Predict batch
            # =========================
            print("[Pipeline] Predict batch...")

            results = self.model.predict_batch(roi_frames)

            print("[Pipeline] Predict done:", None if results is None else len(results))

            if results is None:
                print("[Pipeline] Predict returned None")
                return None

            if len(results) != num_frames:
                print(f"[Pipeline] Predict result invalid: {len(results)}/{num_frames}")
                return None

            # =========================
            # 3. Lấy score từng frame
            # =========================
            scores = []

            for idx, result in enumerate(results, start=1):
                score = float(result.get("pred_score", 0.0))
                label = str(result.get("pred_label", "UNKNOWN"))

                print(f"[Pipeline] Frame {idx}: score={score:.6f}, label={label}")
                scores.append(score)

            if len(scores) == 0:
                print("[Pipeline] No scores")
                return None

            # =========================
            # 4. Fusion kết quả
            # =========================
            avg_score = float(np.mean(scores))
            threshold = self._get_threshold()
            final_label = "NG" if avg_score > threshold else "OK"

            print(
                f"[Pipeline] Fusion done: "
                f"avg_score={avg_score:.6f}, "
                f"threshold={threshold:.6f}, "
                f"final_label={final_label}"
            )

            # =========================
            # 5. Build frame result
            # =========================
            frame_results = []

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
                })

            latency = time.time() - start_time

            print(f"[Pipeline] Batch completed, latency={latency:.3f}s")

            return {
                "frames": frame_results,
                "avg_score": avg_score,
                "final_label": final_label,
                "threshold": threshold,
                "latency": latency
            }

        except Exception as e:
            print("[Pipeline] ERROR:", e)
            print(traceback.format_exc())
            return None