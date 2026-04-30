import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_uint8_gray(image, keep_scale=False):
    """Convert any image-like array to a single-channel uint8 image.

    When ``keep_scale`` is True we also return a float32 copy of the original
    values (useful when the anomaly map carries meaningful absolute scores).
    """
    if image is None:
        return (None, None) if keep_scale else None

    img = np.asarray(image)

    if img.ndim == 3 and img.shape[-1] == 1:
        img = img[..., 0]
    if img.ndim == 3 and img.shape[0] == 1:
        img = img[0]
    if img.ndim == 3 and img.shape[-1] in (3, 4):
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if img.ndim != 2:
        return (None, None) if keep_scale else None

    raw = img.astype(np.float32, copy=True)

    if img.dtype != np.uint8:
        min_val = float(np.min(img)) if img.size else 0.0
        max_val = float(np.max(img)) if img.size else 0.0
        if max_val <= min_val:
            u8 = np.zeros_like(img, dtype=np.uint8)
        else:
            u8 = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    else:
        u8 = img

    return (u8, raw) if keep_scale else u8


def _resize_to_frame(arr, frame, interpolation=cv2.INTER_LINEAR):
    if arr is None or frame is None:
        return arr
    h, w = frame.shape[:2]
    if arr.shape[:2] != (h, w):
        arr = cv2.resize(arr, (w, h), interpolation=interpolation)
    return arr


def _touches_border(x, y, bw, bh, frame_shape, margin_ratio=0.025):
    h, w = frame_shape[:2]
    mx = max(2, int(w * margin_ratio))
    my = max(2, int(h * margin_ratio))
    return x <= mx or y <= my or (x + bw) >= (w - mx) or (y + bh) >= (h - my)


# ---------------------------------------------------------------------------
# Map quality estimation
#
# Quan trọng: cần biết heatmap có "thực sự nổi bật" hay chỉ là noise nền.
# Dùng tỉ lệ tail để ước lượng độ tương phản giữa vùng cao nhất và phần còn lại.
# ---------------------------------------------------------------------------

def _map_contrast(amap_u8):
    """Return a contrast score in [0, 1] indicating how 'peaky' the map is.

    A low value means the map is mostly flat (likely few/weak defects), so we
    should be more conservative; a high value means there are clear hotspots.
    """
    if amap_u8 is None or amap_u8.size == 0:
        return 0.0

    p50 = float(np.percentile(amap_u8, 50))
    p99 = float(np.percentile(amap_u8, 99))
    max_v = float(np.max(amap_u8))
    if max_v <= 1e-6:
        return 0.0
    # gap between top tail and median, relative to max
    return float(np.clip((p99 - p50) / max_v, 0.0, 1.0))


# ---------------------------------------------------------------------------
# Two-pass thresholding
#
# Pass A (fine): bắt các lỗi nhỏ, đốm, scratch — threshold cao, kernel nhỏ.
# Pass B (coarse): bắt vùng lỗi lớn / mờ — threshold thấp hơn, smoothing nhiều
# hơn để gộp các cluster rời rạc thành 1 region.
#
# Hai pass chạy độc lập, kết quả gộp lại rồi NMS theo IoU để tránh trùng.
# ---------------------------------------------------------------------------

def _threshold_pass(amap_u8, mode, contrast):
    """Build a binary mask from the anomaly map.

    ``mode`` is either 'fine' or 'coarse'. ``contrast`` modulates the threshold
    so flat maps don't produce noise contours.
    """
    if amap_u8 is None or amap_u8.size == 0:
        return np.zeros_like(amap_u8) if amap_u8 is not None else None

    max_val = float(np.max(amap_u8))
    if max_val <= 5:
        return np.zeros_like(amap_u8)

    mean_v = float(np.mean(amap_u8))
    std_v = float(np.std(amap_u8))

    # Khi contrast thấp (map phẳng), nâng hệ số std lên để tránh khoanh nhiễu.
    contrast_boost = 1.0 + (1.0 - contrast) * 0.6  # ∈ [1.0, 1.6]

    if mode == "fine":
        # Tail-based: lấy ~3% pixel sáng nhất, nhưng chặn trên ngưỡng std.
        t_pct = float(np.percentile(amap_u8, 97.0))
        t_std = mean_v + (2.2 * contrast_boost) * std_v
        thr = max(t_pct, t_std)
        thr = min(thr, max_val * 0.95)
        kernel_open = np.ones((2, 2), np.uint8)
        kernel_close = np.ones((3, 3), np.uint8)
        open_iter, close_iter = 1, 1
    else:  # coarse
        t_pct = float(np.percentile(amap_u8, 88.0))
        t_std = mean_v + (1.3 * contrast_boost) * std_v
        thr = max(t_pct, t_std)
        thr = min(thr, max_val * 0.85)
        kernel_open = np.ones((3, 3), np.uint8)
        kernel_close = np.ones((7, 7), np.uint8)
        open_iter, close_iter = 1, 2

    _, mask = cv2.threshold(amap_u8, thr, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_open, iterations=open_iter)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_close, iterations=close_iter)
    return mask


# ---------------------------------------------------------------------------
# Component scoring & filtering
# ---------------------------------------------------------------------------

def _component_metrics(label_mask, amap_u8):
    """Return list of dicts describing each connected component."""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        label_mask, connectivity=8
    )
    out = []
    for i in range(1, num_labels):
        x, y, w, h, area = stats[i]
        if area <= 0:
            continue
        comp_mask = (labels == i)
        values = amap_u8[comp_mask] if amap_u8 is not None else None
        if values is not None and values.size > 0:
            mean_score = float(np.mean(values))
            p90_score = float(np.percentile(values, 90))
            max_score = float(np.max(values))
        else:
            mean_score = p90_score = max_score = 0.0

        bbox_area = max(1, w * h)
        density = area / bbox_area  # how filled the bbox is
        elongation = max(w / max(h, 1), h / max(w, 1))

        out.append({
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "area": int(area),
            "bbox_area": int(bbox_area),
            "density": float(density),
            "elongation": float(elongation),
            "mean": mean_score,
            "p90": p90_score,
            "max": max_score,
            "mask": comp_mask,
            "centroid": (float(centroids[i, 0]), float(centroids[i, 1])),
        })
    return out


def _filter_components(components, frame_shape, amap_u8,
                       min_area, max_area_ratio, ignore_border,
                       min_score_ratio, contrast):
    if not components:
        return []

    frame_area = frame_shape[0] * frame_shape[1]
    global_max = float(np.max(amap_u8)) if amap_u8 is not None else 0.0
    # Khi contrast thấp, nâng ngưỡng score để tránh false positive.
    eff_score_ratio = min_score_ratio + (1.0 - contrast) * 0.15
    score_floor = global_max * eff_score_ratio

    kept = []
    for c in components:
        area_ratio = c["area"] / max(1, frame_area)

        # Lỗi đường nét (crack, scratch) thường rất thon dài → cần threshold
        # area thấp hơn so với lỗi đốm tròn.
        is_thin = c["elongation"] >= 3.0
        eff_min_area = min_area * (0.55 if is_thin else 1.0)

        if c["area"] < eff_min_area:
            continue
        if area_ratio > max_area_ratio:
            continue
        if c["w"] < 3 or c["h"] < 3:
            continue

        # Loại các vùng sát biên trừ khi chúng có score cao và không quá thon
        # (vì biên thường có artifact ánh sáng/viền sản phẩm).
        if ignore_border and _touches_border(
            c["x"], c["y"], c["w"], c["h"], frame_shape
        ):
            if c["p90"] < global_max * 0.85 and c["elongation"] > 2.5:
                continue
            if area_ratio < 0.005:
                continue

        # Score floor — nhưng cho qua nếu component rất đặc và đủ to (lỗi rõ).
        passes_score = c["p90"] >= score_floor or c["max"] >= score_floor * 1.1
        passes_strong = c["density"] >= 0.55 and area_ratio >= 0.002 and c["mean"] >= score_floor * 0.75
        if not (passes_score or passes_strong):
            continue

        # Composite score for ranking
        c["score"] = (
            c["p90"] * 0.55
            + c["mean"] * 0.25
            + min(area_ratio, 0.05) / 0.05 * 60.0  # area bonus capped
        )
        kept.append(c)

    return kept


# ---------------------------------------------------------------------------
# Merging components from fine + coarse passes
#
# Một lỗi lớn có thể bị tách thành nhiều fine-component nhỏ và đồng thời được
# coarse pass bắt thành 1 component lớn. Ta merge: nếu coarse-component chứa
# >=60% diện tích của 1+ fine-component, ta giữ coarse và bỏ fine bị nuốt.
# ---------------------------------------------------------------------------

def _merge_components(fine, coarse):
    if not coarse:
        return fine
    if not fine:
        return coarse

    out = list(coarse)
    for f in fine:
        absorbed = False
        for c in coarse:
            inter = np.logical_and(f["mask"], c["mask"]).sum()
            if inter / max(1, f["area"]) >= 0.6:
                absorbed = True
                break
        if not absorbed:
            out.append(f)

    # Khử trùng giữa các component trong out (IoU cao thì giữ score lớn hơn).
    out.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    final = []
    for c in out:
        keep = True
        for k in final:
            inter = np.logical_and(c["mask"], k["mask"]).sum()
            union = np.logical_or(c["mask"], k["mask"]).sum()
            if union > 0 and inter / union >= 0.5:
                keep = False
                break
        if keep:
            final.append(c)
    return final


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def _draw_components(overlay, components, color=(0, 0, 255), thickness=2):
    """Draw clean contours around each component without inflating the mask."""
    if not components:
        return overlay
    for c in components:
        m = c["mask"].astype(np.uint8) * 255
        # Smooth contour một chút để đường viền đỡ răng cưa, KHÔNG dilate
        # (dilate làm khoanh phình lệch khỏi vùng lỗi thật).
        m = cv2.medianBlur(m, 3)
        contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)
        if contours:
            cv2.drawContours(overlay, contours, -1, color, thickness, lineType=cv2.LINE_AA)
    return overlay


# ---------------------------------------------------------------------------
# Fallback when only pred_mask is available
# ---------------------------------------------------------------------------

def _components_from_pred_mask(pred_mask, frame, max_area_ratio):
    mask = _to_uint8_gray(pred_mask)
    if mask is None:
        return []
    mask = _resize_to_frame(mask, frame, interpolation=cv2.INTER_NEAREST)
    _, mb = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    mb = cv2.morphologyEx(mb, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)

    frame_area = frame.shape[0] * frame.shape[1]
    comps = _component_metrics(mb, mask)
    out = []
    for c in comps:
        ar = c["area"] / frame_area
        if ar <= 0 or ar > max_area_ratio:
            continue
        if c["w"] < 3 or c["h"] < 3:
            continue
        c["score"] = c["area"]
        out.append(c)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_overlay(
    frame,
    pred_mask=None,
    anomaly_map=None,
    pred_label=None,
    min_area=14,
    max_area_ratio=0.42,
    max_contours=5,
    min_score_ratio=0.40,
    ignore_border=True,
):
    """Draw defect contours on a copy of ``frame``.

    Strategy:
      1. Prefer ``anomaly_map`` because it carries dense scores.
      2. Run two threshold passes (fine + coarse) to cover small spots and
         broad regions simultaneously.
      3. Score components and merge across passes (coarse absorbs fine when
         they overlap heavily).
      4. Fall back to ``pred_mask`` only if anomaly_map is missing or returned
         nothing usable.
    """
    if frame is None:
        return None
    overlay = frame.copy()

    if pred_label is not None and str(pred_label).upper() == "OK":
        return overlay

    amap_u8 = None
    components = []

    if anomaly_map is not None:
        amap_u8 = _to_uint8_gray(anomaly_map)
        amap_u8 = _resize_to_frame(amap_u8, frame, interpolation=cv2.INTER_LINEAR)

    if amap_u8 is not None and float(np.max(amap_u8)) > 5:
        contrast = _map_contrast(amap_u8)

        fine_mask = _threshold_pass(amap_u8, "fine", contrast)
        coarse_mask = _threshold_pass(amap_u8, "coarse", contrast)

        fine_comps = _component_metrics(fine_mask, amap_u8)
        coarse_comps = _component_metrics(coarse_mask, amap_u8)

        fine_comps = _filter_components(
            fine_comps, frame.shape, amap_u8,
            min_area=min_area,
            max_area_ratio=max_area_ratio,
            ignore_border=ignore_border,
            min_score_ratio=min_score_ratio,
            contrast=contrast,
        )
        coarse_comps = _filter_components(
            coarse_comps, frame.shape, amap_u8,
            min_area=max(min_area, 40),  # coarse vùng lớn → yêu cầu area lớn hơn
            max_area_ratio=max_area_ratio,
            ignore_border=ignore_border,
            min_score_ratio=max(min_score_ratio - 0.05, 0.30),
            contrast=contrast,
        )

        components = _merge_components(fine_comps, coarse_comps)

    # Nếu anomaly_map không có hoặc không cho component nào hợp lệ → dùng pred_mask
    if not components and pred_mask is not None:
        components = _components_from_pred_mask(pred_mask, frame, max_area_ratio)

    if not components:
        return overlay

    components.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    components = components[:max_contours]

    return _draw_components(overlay, components)