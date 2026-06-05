import cv2
import numpy as np

CONTOUR_VERSION = "multi_mask_best_contour_v4"
OUTPUT_SIZE = (256,256)
PADDING_RATIO = 0.08
MIN_CONTOUR_AREA = 1000
EDGE_MARGIN_X = 5
MIN_MASK_RATIO = 0.005
MAX_MASK_RATIO = 0.9
MIN_PRODUCT_FILL_RATIO = 0.015
MAX_PRODUCT_FILL_RATIO = 0.8

def order_points(pts):
  rect = np.zeros((4,2), dtype=np.float32)

  s = pts.sum(axis=1)
  rect[0] = pts[np.argmin(s)]
  rect[2] = pts[np.argmax(s)]

  diff = np.diff(pts, axis=1)
  rect[1] = pts[np.argmin(diff)]
  rect[3] = pts[np.argmax(diff)]

  return rect

def expand_box(rect_pts, pad_ratio):
  center = np.mean(rect_pts, axis = 0)
  expanded = center + (rect_pts - center) * (1.0 + pad_ratio)
  return expanded.astype(np.float32)

def clean_mask(mask):
  kernel = np.ones((5,5), np.uint8)
  mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
  mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
  return mask

def is_valid_mask(mask):
  mask_ratio = np.mean(mask == 255)
  return MIN_MASK_RATIO <= mask_ratio <= MAX_MASK_RATIO

def build_border_foreground_mask(image):
  h, w = image.shape[:2]
  border = max(5, int(min(h, w) * 0.04))

  lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
  border_pixels = np.concatenate([
    lab[:border, :, :].reshape(-1, 3),
    lab[-border:, :, :].reshape(-1, 3),
    lab[:, :border, :].reshape(-1, 3),
    lab[:, -border:, :].reshape(-1, 3),
  ], axis=0)

  background_color = np.median(border_pixels, axis=0)
  distance = np.linalg.norm(lab - background_color, axis=2)
  distance = cv2.GaussianBlur(distance.astype(np.float32), (5,5), 0)
  distance = cv2.normalize(distance, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

  _, mask = cv2.threshold(
    distance,
    0,
    255,
    cv2.THRESH_BINARY + cv2.THRESH_OTSU
  )
  return clean_mask(mask)

def build_saturation_mask(image):
  hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
  saturation = hsv[:, :, 1]

  _, mask = cv2.threshold(
    saturation,
    0,
    255,
    cv2.THRESH_BINARY + cv2.THRESH_OTSU
  )
  return clean_mask(mask)

def build_value_mask(image):
  hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
  value = hsv[:, :, 2]
  blur = cv2.GaussianBlur(value,(5,5), 0)

  _, th = cv2.threshold(
    blur,
    0,
    255,
    cv2.THRESH_BINARY + cv2.THRESH_OTSU
  )

  white_ratio = np.mean(th == 255)
  if white_ratio > 0.7:
    th = cv2.bitwise_not(th)

  return clean_mask(th)

def build_contour_masks(image):
  return [
    ("lab_border", build_border_foreground_mask(image)),
    ("saturation", build_saturation_mask(image)),
    ("value_otsu", build_value_mask(image)),
  ]

def preprocess_for_contour(image):
  candidates = build_contour_masks(image)

  valid_masks = [
    mask
    for _, mask in candidates
    if is_valid_mask(mask)
  ]

  if valid_masks:
    merged = np.zeros_like(valid_masks[0])
    for mask in valid_masks:
      merged = cv2.bitwise_or(merged, mask)
    return clean_mask(merged)

  return build_value_mask(image)

def find_contours(binary):
  contours, _ = cv2.findContours(
    binary,
    cv2.RETR_EXTERNAL,
    cv2.CHAIN_APPROX_SIMPLE
  )
  return contours

def score_contour(contour, image_shape):
  image_h, image_w = image_shape[:2]
  image_area = image_h * image_w
  x, y, w, h = cv2.boundingRect(contour)
  rect_area = max(1, w * h)
  contour_area = cv2.contourArea(contour)
  fill_ratio = contour_area / rect_area
  product_ratio = rect_area / max(1, image_area)
  aspect_ratio = max(w, h) / max(1, min(w, h))

  touches_border = (
    x <= EDGE_MARGIN_X or
    (x + w) >= (image_w - EDGE_MARGIN_X) or
    y <= EDGE_MARGIN_X or
    (y + h) >= (image_h - EDGE_MARGIN_X)
  )
  is_product_size = MIN_PRODUCT_FILL_RATIO <= product_ratio <= MAX_PRODUCT_FILL_RATIO
  is_reasonable_shape = aspect_ratio <= 3.5

  # Uu tien contour la san pham: khong dinh bien, kich thuoc hop ly, hinh khong qua mong.
  return (
    not touches_border,
    is_product_size,
    is_reasonable_shape,
    min(product_ratio, MAX_PRODUCT_FILL_RATIO),
    fill_ratio,
  )

def find_main_contour(binary):
  contours = find_contours(binary)

  if not contours:
    return None

  valid_contours = [
    contour
    for contour in contours
    if cv2.contourArea(contour) >= MIN_CONTOUR_AREA
  ]

  if not valid_contours:
    return None

  return max(valid_contours, key=lambda contour: score_contour(contour, binary.shape))

def find_best_contour_from_masks(image):
  best = None
  best_mask = None
  best_name = None
  best_score = None

  for name, mask in build_contour_masks(image):
    if not is_valid_mask(mask):
      continue

    for contour in find_contours(mask):
      if cv2.contourArea(contour) < MIN_CONTOUR_AREA:
        continue

      score = score_contour(contour, mask.shape)
      if best is None or score > best_score:
        best = contour
        best_mask = mask
        best_name = name
        best_score = score

  if best is not None:
    return best, best_mask, best_name

  fallback_mask = preprocess_for_contour(image)
  return find_main_contour(fallback_mask), fallback_mask, "fallback"

def crop_by_contour(image):
  h, w = image.shape[:2]
  debug = image.copy()

  contour, binary, mask_name = find_best_contour_from_masks(image)

  if contour is None:
    return None, debug, "No valid contour"

  cv2.drawContours(debug, [contour], -1, (0, 0, 255), 2)

  x, y, bw, bh = cv2.boundingRect(contour)

  if x <= EDGE_MARGIN_X or (x + bw) >= (w - EDGE_MARGIN_X):
    cv2.rectangle(debug, (x, y), (x + bw, y + bh), (0, 255, 255), 2)
    return None, debug, f"Too close to left/right border ({mask_name})"

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
    [0, max_height - 1],
  ], dtype=np.float32)

  matrix = cv2.getPerspectiveTransform(ordered, dst)

  warped = cv2.warpPerspective(
    image,
    matrix,
    (max_width, max_height),
    flags=cv2.INTER_LINEAR,
    borderMode=cv2.BORDER_REPLICATE
  )

  if warped.shape[0] > warped.shape[1]:
    warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

  roi = cv2.resize(warped, OUTPUT_SIZE)

  return roi, debug, f"OK:{mask_name}"
