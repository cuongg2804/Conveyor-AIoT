import os
import cv2
import uuid
import shutil
import tempfile
import numpy as np
import torch

from anomalib.models import Patchcore
from anomalib.engine import Engine
import anomalib

# ── Compat patch cho anomalib cũ ─────────────────────────────────────────────
if not hasattr(anomalib, "PrecisionType"):
    class PrecisionType(str):
        def __new__(cls, v, *args, **kwargs):
            return str.__new__(cls, v)
        FP32 = "fp32"
        FP16 = "fp16"
    anomalib.PrecisionType = PrecisionType


INPUT_SIZE = 256
PIXEL_THRESHOLD = 0.3
DEFAULT_IMAGE_THRESHOLD = 30.436506
CORESET_SAMPLING_RATIO = 0.05
_RAMDISK_BASE = "/dev/shm/patchcore_infer"


class PatchCoreEngine:
    def __init__(
        self,
        ckpt_path: str,
        device: str = "cuda",
        image_threshold: float = DEFAULT_IMAGE_THRESHOLD,
    ):
        print("─── Load PatchCore Model ───")

        self.ckpt_path = ckpt_path
        self.image_threshold = float(image_threshold)

        requested_device = str(device).lower().strip()
        if requested_device in ["cuda", "cuda:0", "gpu"] and torch.cuda.is_available():
            self.device = "cuda"
            self.torch_device = torch.device("cuda:0")
        else:
            self.device = "cpu"
            self.torch_device = torch.device("cpu")

        print(f"👉 requested device       : {device}")
        print(f"👉 torch.cuda.is_available: {torch.cuda.is_available()}")
        print(f"👉 resolved device        : {self.device}")

        checkpoint = torch.load(ckpt_path, map_location="cpu")
        hparams = checkpoint.get("hyper_parameters", {})
        if hasattr(hparams, "__dict__"):
            hparams = vars(hparams)

        backbone = hparams.get("backbone", "wide_resnet50_2")
        layers = hparams.get("layers", ["layer2", "layer3"])
        coreset_sampling_ratio = CORESET_SAMPLING_RATIO
        num_neighbors = hparams.get("num_neighbors", 9)

        print(f"👉 backbone              : {backbone}")
        print(f"👉 layers                : {layers}")
        print(f"👉 coreset_sampling_ratio: {coreset_sampling_ratio}")
        print(f"👉 num_neighbors         : {num_neighbors}")
        print(f"👉 image_threshold       : {self.image_threshold}")

        self.model = Patchcore(
            backbone=backbone,
            layers=layers,
            coreset_sampling_ratio=coreset_sampling_ratio,
            num_neighbors=num_neighbors,
            pre_trained=False,
            evaluator=False,
            visualizer=False,
        )

        self.model.load_state_dict(checkpoint["state_dict"], strict=False)
        self.model.eval()
        self.model = self.model.to(self.torch_device)

        try:
            print(f"👉 model param device     : {next(self.model.parameters()).device}")
        except Exception as e:
            print(f"⚠️ Không đọc được model device: {e}")

        self.engine = Engine(
            logger=False,
            enable_progress_bar=False,
            enable_model_summary=False,
            num_sanity_val_steps=0,
            accelerator="gpu" if self.device == "cuda" else "cpu",
            devices=1,
        )

        print(f"👉 engine accelerator     : {'gpu' if self.device == 'cuda' else 'cpu'}")

        if os.path.exists("/dev/shm"):
            self._tmp_base = _RAMDISK_BASE
        else:
            self._tmp_base = tempfile.mkdtemp(prefix="patchcore_fallback_")
            print(f"⚠️ /dev/shm không khả dụng, dùng fallback: {self._tmp_base}")

        os.makedirs(self._tmp_base, exist_ok=True)

        print("🔥 Warming up engine...")
        self._warmup()
        print("✅ Model ready")

    def set_image_threshold(self, value: float):
        self.image_threshold = float(value)
        print(f"✅ Updated image_threshold = {self.image_threshold}")

    def predict_batch(self, frames: list, return_timing: bool = False):
        if not frames:
            if return_timing:
                return [], {}
            return []

        timing = {}

        t0 = cv2.getTickCount()
        # Lưu frames tạm thời để engine.predict đọc được (do engine.predict chỉ nhận đường dẫn)
        run_dir = self._save_temp_frames(frames)
        t1 = cv2.getTickCount()

        try:
            # Gọi engine.predict để lấy preds, mỗi pred có thể có pred_score, anomaly_map, pred_mask
            preds = self.engine.predict(
                model=self.model,
                data_path=run_dir,
                return_predictions=True,
            )
            t2 = cv2.getTickCount()

            if not preds:
                raise RuntimeError("No predictions returned from engine.predict.")

            # Chuyển preds sang định dạng chuẩn với pred_score, pred_label, anomaly_map, pred_mask
            results = [self._extract_single_prediction(p) for p in preds]
            t3 = cv2.getTickCount()

            freq = cv2.getTickFrequency()
            timing["write_temp_ms"] = (t1 - t0) * 1000.0 / freq
            timing["engine_predict_ms"] = (t2 - t1) * 1000.0 / freq
            timing["postprocess_ms"] = (t3 - t2) * 1000.0 / freq
            timing["total_ms"] = (t3 - t0) * 1000.0 / freq
            timing["batch_size"] = len(frames)
            timing["per_frame_ms"] = timing["total_ms"] / max(1, len(frames))

            if return_timing:
                return results, timing
            return results

        finally:
            shutil.rmtree(run_dir, ignore_errors=True)

    def predict(self, frame: np.ndarray, return_timing: bool = False):
        results, timing = self.predict_batch([frame], return_timing=True)
        if not results:
            raise RuntimeError("No prediction result for single frame.")
        if return_timing:
            return results[0], timing
        return results[0]

    def __del__(self):
        try:
            if hasattr(self, "_tmp_base") and isinstance(self._tmp_base, str):
                if self._tmp_base.startswith(_RAMDISK_BASE):
                    shutil.rmtree(self._tmp_base, ignore_errors=True)
        except Exception:
            pass

    def _save_temp_frames(self, frames: list) -> str:
        run_dir = os.path.join(self._tmp_base, uuid.uuid4().hex)
        os.makedirs(run_dir, exist_ok=True)

        for idx, frame in enumerate(frames):
            if frame is None:
                shutil.rmtree(run_dir, ignore_errors=True)
                raise ValueError(f"Frame {idx} is None.")

            img_path = os.path.join(run_dir, f"{idx:03d}.png")
            ok = cv2.imwrite(img_path, frame, [cv2.IMWRITE_PNG_COMPRESSION, 0])
            if not ok:
                shutil.rmtree(run_dir, ignore_errors=True)
                raise RuntimeError(f"Failed to write frame {idx} to temp dir.")

        return run_dir

    def _to_numpy(self, x):
        if x is None:
            return None
        if isinstance(x, np.ndarray):
            return x
        if torch.is_tensor(x):
            return x.detach().cpu().numpy()
        try:
            return np.array(x)
        except Exception:
            return None

    def _extract_attr(self, obj, names):
        for name in names:
            if hasattr(obj, name):
                value = getattr(obj, name)
                if value is not None:
                    return value
        return None

    def _normalize_mask_uint8(self, mask):
        if mask is None:
            return None

        mask = np.squeeze(mask)

        # Nếu mask nhiều kênh thì ép về 1 kênh
        if mask.ndim == 3:
            if mask.shape[0] in [1, 3] and mask.shape[0] != mask.shape[-1]:
                # CHW -> HWC nếu cần
                mask = np.transpose(mask, (1, 2, 0))
            if mask.ndim == 3:
                mask = mask[..., 0]

        if mask.dtype == np.bool_:
            mask = mask.astype(np.uint8) * 255
            return mask

        if mask.dtype != np.uint8:
            mask = mask.astype(np.float32)

            # mask probability 0..1
            if mask.max() <= 1.0:
                mask = mask * 255.0

            mask = np.clip(mask, 0, 255).astype(np.uint8)

        return mask

    def _extract_single_prediction(self, pred) -> dict:
        pred_score_raw = self._extract_attr(pred, ["pred_score", "score", "anomaly_score"])
        pred_score = float(pred_score_raw) if pred_score_raw is not None else 0.0
        pred_label = "OK" if pred_score <= self.image_threshold else "NG"

        anomaly_map = None
        anomaly_map_raw = self._extract_attr(pred, ["anomaly_map", "anomaly_maps", "heat_map"])
        anomaly_map_np = self._to_numpy(anomaly_map_raw)
        if anomaly_map_np is not None:
            anomaly_map = np.squeeze(anomaly_map_np).astype(np.float32)

        pred_mask = None
        pred_mask_raw = self._extract_attr(pred, ["pred_mask", "mask", "pred_masks", "segmentations"])
        pred_mask_np = self._to_numpy(pred_mask_raw)
        if pred_mask_np is not None:
            pred_mask = self._normalize_mask_uint8(pred_mask_np)

        # fallback: nếu không có pred_mask thì tạo từ anomaly_map
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

    def _warmup(self):
        dummy_frame = np.zeros((INPUT_SIZE, INPUT_SIZE, 3), dtype=np.uint8)
        try:
            dummy_batch = [dummy_frame.copy() for _ in range(3)]
            for _ in range(3):
                _ = self.predict_batch(dummy_batch)
        except Exception as e:
            print(f"⚠️ Warm-up failed but ignored: {e}")
