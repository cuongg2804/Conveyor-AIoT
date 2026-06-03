import csv
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from anomalib.models import Patchcore


BASE_DIR = Path(__file__).resolve().parent

CKPT_PATH = BASE_DIR / "models" / "model (1).ckpt"
IMAGE_DIR = Path(r"C:\Users\ASUS\Downloads\archive (1)\dataset_21_4\val\ok")
CSV_PATH = BASE_DIR / "ckpt_predictions_ok.csv"

IMAGE_SIZE = 256
THRESHOLD = 10.530194888761894

BACKBONE = "resnet18"
LAYERS = ["layer2", "layer3"]
CORESET_SAMPLING_RATIO = 0.1

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

IMAGE_EXTENSIONS = {".bmp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


def validate_paths():
    if not CKPT_PATH.exists():
        raise FileNotFoundError(f"CKPT model not found: {CKPT_PATH}")

    if not IMAGE_DIR.exists():
        raise FileNotFoundError(f"Image folder not found: {IMAGE_DIR}")


def collect_images():
    return sorted(
        p for p in IMAGE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )


def preprocess_image(image_path):
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot read image: {image_path}")

    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = cv2.resize(image, (IMAGE_SIZE, IMAGE_SIZE))
    image = image.astype(np.float32) / 255.0
    image = np.transpose(image, (2, 0, 1))

    tensor = torch.from_numpy(image).unsqueeze(0).float()
    return tensor


def load_model():
    model = Patchcore.load_from_checkpoint(
        checkpoint_path=str(CKPT_PATH),
        backbone=BACKBONE,
        layers=LAYERS,
        coreset_sampling_ratio=CORESET_SAMPLING_RATIO,
    )

    model.eval()
    model.to(DEVICE)

    return model


def extract_score_and_label(output):
    pred_score = None
    pred_label = None

    if isinstance(output, dict):
        pred_score = output.get("pred_score", None)
        pred_label = output.get("pred_label", None)
    else:
        pred_score = getattr(output, "pred_score", None)
        pred_label = getattr(output, "pred_label", None)

    if pred_score is None and isinstance(output, tuple):
        pred_score = output[0]

    if pred_score is None:
        raise RuntimeError(f"Cannot find pred_score in model output: {type(output)}")

    if torch.is_tensor(pred_score):
        score = float(pred_score.detach().cpu().numpy().reshape(-1)[0])
    else:
        score = float(np.asarray(pred_score).reshape(-1)[0])

    if pred_label is not None:
        if torch.is_tensor(pred_label):
            label = bool(pred_label.detach().cpu().numpy().reshape(-1)[0])
        else:
            label = bool(np.asarray(pred_label).reshape(-1)[0])
    else:
        label = bool(score > THRESHOLD)

    return score, label


def main():
    validate_paths()

    print(f"Device: {DEVICE}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    print("\nLoading CKPT model...")
    model = load_model()
    print("Model loaded.")

    images = collect_images()
    if not images:
        raise RuntimeError(f"No images found in: {IMAGE_DIR}")

    print(f"\nTotal images: {len(images)}")

    print("\nWarmup...")
    warmup_tensor = preprocess_image(images[0]).to(DEVICE)

    with torch.no_grad():
        for _ in range(5):
            _ = model(warmup_tensor)
            if DEVICE == "cuda":
                torch.cuda.synchronize()

    rows = []
    latencies = []

    print("\nPredicting all images...")

    with torch.no_grad():
        for index, image_path in enumerate(images, start=1):
            input_tensor = preprocess_image(image_path).to(DEVICE)

            if DEVICE == "cuda":
                torch.cuda.synchronize()

            start_time = time.perf_counter()
            output = model(input_tensor)

            if DEVICE == "cuda":
                torch.cuda.synchronize()

            latency_ms = (time.perf_counter() - start_time) * 1000.0

            score, label = extract_score_and_label(output)

            latencies.append(latency_ms)

            rows.append({
                "image_path": str(image_path),
                "image_name": image_path.name,
                "device": DEVICE,
                "latency_ms": round(latency_ms, 3),
                "pred_score": score,
                "pred_label": label,
                "threshold": THRESHOLD,
            })

            print(
                f"[{index}/{len(images)}] "
                f"{image_path.name} | "
                f"{latency_ms:.2f} ms | "
                f"score={score:.6f} | "
                f"label={label}"
            )

    with CSV_PATH.open("w", newline="", encoding="utf-8") as csv_file:
        fieldnames = [
            "image_path",
            "image_name",
            "device",
            "latency_ms",
            "pred_score",
            "pred_label",
            "threshold",
        ]

        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    latencies = np.array(latencies, dtype=np.float32)

    print("\nDone.")
    print(f"CSV saved to     : {CSV_PATH}")
    print(f"Images processed : {len(images)}")
    print(f"Mean latency     : {latencies.mean():.2f} ms")
    print(f"Median latency   : {np.median(latencies):.2f} ms")
    print(f"Min latency      : {latencies.min():.2f} ms")
    print(f"Max latency      : {latencies.max():.2f} ms")
    print(f"FPS              : {1000.0 / latencies.mean():.2f}")


if __name__ == "__main__":
    main()