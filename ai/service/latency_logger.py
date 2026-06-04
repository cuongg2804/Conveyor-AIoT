import csv
import os
import time

from config import BASE_DIR


class LatencyLogger:
    FIELDNAMES = [
        "timestamp",
        "job_id",
        "inspection_id",
        "conveyor_code",
        "label",
        "avg_score",
        "threshold",
        "capture_ms",
        "contour_ms",
        "infer_total_ms",
        "infer_write_temp_ms",
        "infer_engine_predict_ms",
        "infer_postprocess_ms",
        "infer_frame_1_ms",
        "infer_frame_2_ms",
        "infer_frame_3_ms",
        "fusion_ms",
        "overlay_ms",
        "pipeline_total_ms",
        "controller_signature_ms",
        "arduino_ms",
        "queue_ms",
        "storage_ms",
        "gui_update_ms",
        "mongo_ms",
        "mqtt_ms",
        "controller_postprocess_ms",
        "end_to_end_ms",
    ]

    def __init__(self, file_path=None):
        if file_path is None:
            file_path = os.path.join(BASE_DIR, "logs", "latency.csv")
        self.file_path = file_path
        self._init_file()
        print(f"[LatencyLogger] file={self.file_path}")

    def _init_file(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)

        if not os.path.exists(self.file_path):
            self._write_header()
            return

        try:
            with open(self.file_path, "r", newline="", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
        except Exception:
            header = None

        if header != self.FIELDNAMES:
            legacy_path = self._legacy_path()
            os.replace(self.file_path, legacy_path)
            print(f"[LatencyLogger] moved old latency file to {legacy_path}")
            self._write_header()

    def _legacy_path(self):
        base, ext = os.path.splitext(self.file_path)
        suffix = time.strftime("%Y%m%d_%H%M%S")
        return f"{base}_legacy_{suffix}{ext}"

    def _write_header(self):
        with open(self.file_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.FIELDNAMES)
            writer.writeheader()

    def log(self, row):
        if not isinstance(row, dict):
            row = {
                "timestamp": time.time(),
                "pipeline_total_ms": float(row) * 1000.0,
                "end_to_end_ms": float(row) * 1000.0,
            }

        clean_row = {}
        for field in self.FIELDNAMES:
            value = row.get(field, "")
            if isinstance(value, float):
                value = f"{value:.3f}"
            clean_row[field] = value

        with open(self.file_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.FIELDNAMES)
            writer.writerow(clean_row)

        print(
            "[LatencyLogger] wrote "
            f"job_id={clean_row.get('job_id')} "
            f"end_to_end_ms={clean_row.get('end_to_end_ms')}"
        )
