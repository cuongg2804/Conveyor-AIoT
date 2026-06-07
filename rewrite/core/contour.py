import cv2
import numpy as np

CONTOUR_VERSION = "hsv_green_background_v1"

LOWER_BG = np.array([40, 40, 20], dtype=np.uint8)
UPPER_BG = np.array([90, 255, 140], dtype=np.uint8)
USE_MORPHOLOGY = True

OUTPUT_SIZE = (256, 256)
MIN_CONTOUR_AREA = 1000
MAX_CONTOUR_AREA_RATIO = 0.80
PADDING_RATIO = 0.08


def order_points(pts: np.ndarray) -> np.ndarray:
  rect = np.zeros((4, 2), dtype=np.float32)

  point_sum = pts.sum(axis=1)
  rect[0] = pts[np.argmin(point_sum)]
  rect[2] = pts[np.argmax(point_sum)]

  point_diff = np.diff(pts, axis=1)
  rect[1] = pts[np.argmin(point_diff)]
  rect[3] = pts[np.argmax(point_diff)]

  return rect


def expand_box(rect_pts: np.ndarray, pad_ratio: float) -> np.ndarray:
  center = np.mean(rect_pts, axis=0)
  expanded = center + (rect_pts - center) * (1.0 + pad_ratio)
  return expanded.astype(np.float32)


def preprocess_for_contour(image: np.ndarray) -> np.ndarray:
  hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

  background_mask = cv2.inRange(hsv, LOWER_BG, UPPER_BG)
  binary = cv2.bitwise_not(background_mask)

  if USE_MORPHOLOGY:
    kernel_close = np.ones((7, 7), np.uint8)
    kernel_open = np.ones((3, 3), np.uint8)

    binary = cv2.morphologyEx(
      binary,
      cv2.MORPH_CLOSE,
      kernel_close,
      iterations=2,
    )
    binary = cv2.morphologyEx(
      binary,
      cv2.MORPH_OPEN,
      kernel_open,
      iterations=1,
    )

  return binary


def find_main_contour(binary: np.ndarray):
  contours, _ = cv2.findContours(
    binary,
    cv2.RETR_EXTERNAL,
    cv2.CHAIN_APPROX_SIMPLE,
  )

  if not contours:
    return None

  img_h, img_w = binary.shape[:2]
  img_area = img_h * img_w
  candidates = []

  for contour in contours:
    area = cv2.contourArea(contour)

    if area < MIN_CONTOUR_AREA:
      continue

    if area / img_area > MAX_CONTOUR_AREA_RATIO:
      continue

    _, _, box_w, box_h = cv2.boundingRect(contour)
    if box_w < 20 or box_h < 20:
      continue

    candidates.append((area, contour))

  if not candidates:
    return None

  return max(candidates, key=lambda item: item[0])[1]


def _draw_if_enabled(debug, draw_fn):
  if debug is not None:
    draw_fn(debug)


def crop_by_contour(image: np.ndarray, draw_debug=False):
  img_h, img_w = image.shape[:2]
  debug = image.copy() if draw_debug else None

  binary = preprocess_for_contour(image)
  contour = find_main_contour(binary)

  if contour is None:
    return None, debug, "No valid contour"

  _draw_if_enabled(
    debug,
    lambda target: cv2.drawContours(target, [contour], -1, (0, 0, 255), 2),
  )

  rect = cv2.minAreaRect(contour)
  box = cv2.boxPoints(rect).astype(np.float32)

  _draw_if_enabled(
    debug,
    lambda target: cv2.polylines(
      target,
      [box.astype(np.int32)],
      True,
      (255, 0, 0),
      2,
    ),
  )

  box_expanded = expand_box(box, PADDING_RATIO)
  box_expanded[:, 0] = np.clip(box_expanded[:, 0], 0, img_w - 1)
  box_expanded[:, 1] = np.clip(box_expanded[:, 1], 0, img_h - 1)

  _draw_if_enabled(
    debug,
    lambda target: cv2.polylines(
      target,
      [box_expanded.astype(np.int32)],
      True,
      (0, 255, 0),
      2,
    ),
  )

  ordered = order_points(box_expanded)

  width_a = np.linalg.norm(ordered[2] - ordered[3])
  width_b = np.linalg.norm(ordered[1] - ordered[0])
  max_width = int(max(width_a, width_b))

  height_a = np.linalg.norm(ordered[1] - ordered[2])
  height_b = np.linalg.norm(ordered[0] - ordered[3])
  max_height = int(max(height_a, height_b))

  if max_width < 10 or max_height < 10:
    return None, debug, "Warp size too small"

  destination = np.array([
    [0, 0],
    [max_width - 1, 0],
    [max_width - 1, max_height - 1],
    [0, max_height - 1],
  ], dtype=np.float32)

  matrix = cv2.getPerspectiveTransform(ordered, destination)
  warped = cv2.warpPerspective(
    image,
    matrix,
    (max_width, max_height),
    flags=cv2.INTER_LINEAR,
    borderMode=cv2.BORDER_REPLICATE,
  )

  if warped.shape[0] > warped.shape[1]:
    warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

  roi = cv2.resize(warped, OUTPUT_SIZE)
  return roi, debug, "OK"
