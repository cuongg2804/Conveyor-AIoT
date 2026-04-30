import csv
import os
from config import BASE_DIR


class LatencyLogger:
    def __init__(self, file_path=None):
        if file_path is None:
            file_path = os.path.join(BASE_DIR, "logs", "latency.csv")
        self.file_path = file_path
        self._init_file()

    def _init_file(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
        if not os.path.exists(self.file_path):
            with open(self.file_path, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["timestamp", "latency"])

    def log(self, latency):
        import time
        with open(self.file_path, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([time.time(), latency])
