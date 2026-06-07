from argparse import ArgumentParser
from pathlib import Path

import cv2
import numpy as np


def read_image(path: Path):
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def write_image(path: Path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    success, encoded = cv2.imencode(path.suffix or ".png", image)
    if not success:
        raise RuntimeError(f"Cannot encode image: {path}")
    encoded.tofile(str(path))


def make_binary(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    _, binary = cv2.threshold(
        blur,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )

    white_ratio = np.mean(binary == 255)
    if white_ratio > 0.7:
        binary = cv2.bitwise_not(binary)

    kernel = np.ones((5, 5), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)

    return binary


def build_preview(original, binary):
    binary_bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    height = min(original.shape[0], 720)
    scale = height / original.shape[0]
    width = int(original.shape[1] * scale)

    original_small = cv2.resize(original, (width, height))
    binary_small = cv2.resize(binary_bgr, (width, height))

    return np.hstack([original_small, binary_small])


def parse_args():
    parser = ArgumentParser(description="Tao va hien thi anh nhi phan de test contour.")
    parser.add_argument("image", help="Duong dan anh can test.")
    parser.add_argument(
        "--output",
        default=None,
        help="Duong dan luu anh nhi phan. Mac dinh: debug_binary_output/<ten_anh>_binary.png",
    )
    parser.add_argument(
        "--no-show",
        action="store_true",
        help="Chi luu file, khong mo cua so xem anh.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    image_path = Path(args.image).resolve()
    image = read_image(image_path)

    if image is None:
        raise SystemExit(f"Khong doc duoc anh: {image_path}")

    binary = make_binary(image)

    if args.output:
        output_path = Path(args.output).resolve()
    else:
        output_path = Path("debug_binary_output") / f"{image_path.stem}_binary.png"

    write_image(output_path, binary)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print("Da luu anh nhi phan:", output_path.resolve())
    print("So contour:", len(contours))
    print("Ti le pixel trang:", round(float(np.mean(binary == 255)), 4))

    if not args.no_show:
        preview = build_preview(image, binary)
        cv2.imshow("original | binary", preview)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
