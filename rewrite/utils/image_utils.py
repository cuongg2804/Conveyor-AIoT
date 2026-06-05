import cv2
import numpy as np

def _to_uint8_gray(image):
  if image is None:
    return None

  arr = np.asarray(image)

  if arr.ndim == 3 and arr.shape[-1] == 1:
    arr = arr[..., 0]

  if arr.ndim == 3 and arr.shape[0] == 1:
    arr = arr[0]

  if arr.ndim == 3 and arr.shape[-1] in [3, 4]:
    arr = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)

  if arr.dtype == np.uint8:
    return arr

  min_value = float(np.min(arr))
  max_value = float(np.max(arr))

  if max_value <= min_value:
    return np.zeros_like(arr, dtype=np.uint8)

  return cv2.normalize(arr, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

def _resize_to_frame(mask, frame):
  if mask is None or frame is None:
    return mask

  height, width = frame.shape[:2]

  if mask.shape[:2] != (height, width):
    mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)

  return mask

def build_overlay(frame, pred_mask=None, anomaly_map=None, pred_label=None):
  if frame is None:
    return None

  overlay = frame.copy()

  if pred_label is not None and str(pred_label).upper() == "OK":
    return overlay

  mask = None

  if anomaly_map is not None:
    amap = _to_uint8_gray(anomaly_map)
    amap = _resize_to_frame(amap, frame)

    if amap is not None and float(np.max(amap)) > 0:
      threshold = max(
        float(np.percentile(amap, 95)),
        float(np.mean(amap) + 2.0 * np.std(amap)),
      )
      _, mask = cv2.threshold(amap, threshold, 255, cv2.THRESH_BINARY)

  if mask is None and pred_mask is not None:
    mask = _to_uint8_gray(pred_mask)
    mask = _resize_to_frame(mask, frame)
    if mask is not None:
      _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

  if mask is None:
    return overlay

  kernel = np.ones((3, 3), np.uint8)
  mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
  mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

  contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

  for contour in contours:
    area = cv2.contourArea(contour)
    if area < 20:
      continue

    cv2.drawContours(
      overlay,
      [contour],
      -1,
      (0, 0, 255),
      2,
      lineType=cv2.LINE_AA,
    )

  return overlay