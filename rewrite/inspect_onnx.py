import csv
import time
from pathlib import Path

import cv2
import numpy as np
import onnx
import onnxruntime as ort


BASE_DIR = Path(__file__).resolve().parent

ONNX_PATH = BASE_DIR / "models" / "model (1).onnx"
IMAGE_DIR = Path(r"C:\Users\ASUS\Downloads\archive (1)\dataset_21_4\val\ok")
CSV_PATH = BASE_DIR / "onnx_predictions_cuda_from_ram.csv"

REQUESTED_OUTPUTS = ["pred_score", "pred_label"]
IMAGE_EXTENSIONS = {".bmp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


def validate_paths():
    if not ONNX_PATH.exists():
        raise FileNotFoundError(f"ONNX model not found: {ONNX_PATH}")

    if not IMAGE_DIR.exists():
        raise FileNotFoundError(f"Image folder not found: {IMAGE_DIR}")


def get_input_hw(input_shape):
    h = input_shape[2] if len(input_shape) > 2 and isinstance(input_shape[2], int) else 256
    w = input_shape[3] if len(input_shape) > 3 and isinstance(input_shape[3], int) else 256
    return h, w


def collect_images():
    return sorted(
        p for p in IMAGE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )


def preprocess_image(image_path, height, width):
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot read image: {image_path}")

    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = cv2.resize(image, (width, height))
    image = image.astype(np.float32) / 255.0
    image = np.transpose(image, (2, 0, 1))
    return np.expand_dims(image, axis=0)


def load_images_to_ram(image_paths, height, width):
    ram_images = []

    for index, image_path in enumerate(image_paths, start=1):
        tensor = preprocess_image(image_path, height, width)
        ram_images.append((image_path, tensor))
        print(f"[LOAD {index}/{len(image_paths)}] {image_path.name}")

    return ram_images


def scalar_output(value):
    arr = np.squeeze(np.asarray(value))
    if arr.size == 1:
        return arr.item()
    return ""


def main():
    validate_paths()

    model = onnx.load(ONNX_PATH)
    onnx.checker.check_model(model)
    print("ONNX check: OK")

    available = ort.get_available_providers()
    print("Available providers:", available)

    if "CUDAExecutionProvider" not in available:
        raise RuntimeError("CUDAExecutionProvider not available. Check onnxruntime-gpu installation.")

    session_options = ort.SessionOptions()
    session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

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

    session = ort.InferenceSession(
        str(ONNX_PATH),
        sess_options=session_options,
        providers=providers,
    )

    active_provider = session.get_providers()[0]

    input_info = session.get_inputs()[0]
    input_name = input_info.name
    height, width = get_input_hw(input_info.shape)

    print(f"Active provider: {active_provider}")
    print(f"Input name     : {input_name}")
    print(f"Input size     : {height}x{width}")

    print("\nOutputs:")
    for out in session.get_outputs():
        print({
            "name": out.name,
            "shape": out.shape,
            "type": out.type,
        })

    images = collect_images()
    if not images:
        raise RuntimeError(f"No images found in: {IMAGE_DIR}")

    images = images[:3]

    print(f"\nTotal images used: {len(images)}")

    print(f"\nTotal images found: {len(images)}")

    print("\nLoading images to RAM...")
    ram_images = load_images_to_ram(images, height, width)
    print(f"Loaded to RAM: {len(ram_images)} images")

    warmup_tensor = ram_images[0][1]

    print("\nWarmup CUDA...")
    for _ in range(10):
        session.run(REQUESTED_OUTPUTS, {input_name: warmup_tensor})

    rows = []
    latencies = []

    print("\nPredicting from RAM with CUDA...")

    for index, (image_path, input_tensor) in enumerate(ram_images, start=1):
        start_time = time.perf_counter()
        outputs = session.run(REQUESTED_OUTPUTS, {input_name: input_tensor})
        latency_ms = (time.perf_counter() - start_time) * 1000.0

        pred_score = scalar_output(outputs[0])
        pred_label = scalar_output(outputs[1])

        latencies.append(latency_ms)

        rows.append({
            "image_path": str(image_path),
            "image_name": image_path.name,
            "provider": active_provider,
            "latency_ms": round(latency_ms, 3),
            "pred_score": pred_score,
            "pred_label": pred_label,
        })

        print(
            f"[{index}/{len(ram_images)}] "
            f"{image_path.name} | "
            f"{latency_ms:.2f} ms | "
            f"score={pred_score} | "
            f"label={pred_label}"
        )

    with CSV_PATH.open("w", newline="", encoding="utf-8") as csv_file:
        fieldnames = [
            "image_path",
            "image_name",
            "provider",
            "latency_ms",
            "pred_score",
            "pred_label",
        ]

        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    latencies = np.array(latencies, dtype=np.float32)

    print("\nDone.")
    print(f"CSV saved to     : {CSV_PATH}")
    print(f"Images processed : {len(ram_images)}")
    print(f"Mean latency     : {latencies.mean():.2f} ms")
    print(f"Median latency   : {np.median(latencies):.2f} ms")
    print(f"Min latency      : {latencies.min():.2f} ms")
    print(f"Max latency      : {latencies.max():.2f} ms")
    print(f"FPS              : {1000.0 / latencies.mean():.2f}")


if __name__ == "__main__":
    main()