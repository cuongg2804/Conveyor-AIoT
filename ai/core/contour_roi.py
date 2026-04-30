import cv2
import numpy as np

OUTPUT_SIZE = (256, 256)
PADDING_RATIO = 0.08
MIN_CONTOUR_AREA = 1000
EDGE_MARGIN_X = 5


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)

    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left
    rect[2] = pts[np.argmax(s)]   # bottom-right

    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left

    return rect


def expand_box(rect_pts: np.ndarray, pad_ratio: float) -> np.ndarray:
    center = np.mean(rect_pts, axis=0)
    expanded = center + (rect_pts - center) * (1.0 + pad_ratio)
    return expanded.astype(np.float32)


def preprocess_for_contour(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    white_ratio = np.mean(th == 255)
    if white_ratio > 0.7:
        th = cv2.bitwise_not(th)

    kernel = np.ones((5, 5), np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel, iterations=2)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel, iterations=1)

    return th


def find_main_contour(binary: np.ndarray):
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)

    if cv2.contourArea(contour) < MIN_CONTOUR_AREA:
        return None

    return contour


def crop_by_contour(image: np.ndarray):
    """
    Returns:
        roi: ảnh ROI đã crop/warp/resize
        debug: ảnh debug có vẽ contour/box
        msg: thông báo
    """
    h, w = image.shape[:2]
    debug = image.copy()

    binary = preprocess_for_contour(image)
    contour = find_main_contour(binary)

    if contour is None:
        return None, debug, "No valid contour"

    cv2.drawContours(debug, [contour], -1, (0, 0, 255), 2)

    x, y, bw, bh = cv2.boundingRect(contour)

    if x <= EDGE_MARGIN_X or (x + bw) >= (w - EDGE_MARGIN_X):
        cv2.rectangle(debug, (x, y), (x + bw, y + bh), (0, 255, 255), 2)
        return None, debug, "Too close to left/right border"

    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    box = np.array(box, dtype=np.float32)

    cv2.polylines(debug, [box.astype(np.int32)], True, (255, 0, 0), 2)

    box_expanded = expand_box(box, PADDING_RATIO)
    box_expanded[:, 0] = np.clip(box_expanded[:, 0], 0, w - 1)
    box_expanded[:, 1] = np.clip(box_expanded[:, 1], 0, h - 1)

    cv2.polylines(debug, [box_expanded.astype(np.int32)], True, (0, 255, 0), 2)

    ordered = order_points(box_expanded)

    width_a = np.linalg.norm(ordered[2] - ordered[3])
    width_b = np.linalg.norm(ordered[1] - ordered[0])
    max_width = int(max(width_a, width_b))

    height_a = np.linalg.norm(ordered[1] - ordered[2])
    height_b = np.linalg.norm(ordered[0] - ordered[3])
    max_height = int(max(height_a, height_b))

    if max_width < 10 or max_height < 10:
        return None, debug, "Warp size too small"

    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(
        image,
        M,
        (max_width, max_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE
    )

    if warped.shape[0] > warped.shape[1]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

    roi = cv2.resize(warped, OUTPUT_SIZE)

    return roi, debug, "OK"