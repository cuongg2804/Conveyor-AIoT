import time
import traceback
import uuid
import cv2
import numpy as np

from config import (
    INSPECTION_DUPLICATE_HASH_DISTANCE,
    INSPECTION_DUPLICATE_WINDOW_SEC,
    MQTT_TOPIC_INSPECTION_RESULT,
)


class SystemController:
    def __init__(
        self,
        pipeline,
        queue,
        logger,
        camera=None,
        model=None,
        arduino=None,
        mqtt=None,
        mongo=None,
        storage=None,
        mqtt_topic_result=MQTT_TOPIC_INSPECTION_RESULT,
        callbacks=None,
        conveyor_code=None,
    ):
        self.pipeline = pipeline
        self.queue = queue
        self.logger = logger
        self.camera = camera
        self.model = model
        self.arduino = arduino
        self.mqtt = mqtt
        self.mongo = mongo
        self.storage = storage
        self.mqtt_topic_result = mqtt_topic_result
        self.callbacks = callbacks or {}
        self.conveyor_code = str(conveyor_code).strip().upper() if conveyor_code else None

        self.running = False
        self.job_id = 0
        self.batch_count = 0
        self.last_batch_signature = None
        self.last_batch_fingerprint = None
        self.last_batch_saved_at = 0.0

    def cb(self, name, *args, **kwargs):
        func = self.callbacks.get(name)
        if callable(func):
            func(*args, **kwargs)

    def _queue_item_to_text(self, item):
        try:
            return f"job_id={item['job_id']} | label={item['label']} | score={float(item['score']):.6f}"
        except Exception:
            return str(item)

    def _push_queue_debug(self):
        if self.queue is None:
            self.cb("set_queue_debug", [])
            return
        try:
            items = self.queue.to_list()
            self.cb("set_queue_debug", [self._queue_item_to_text(item) for item in items])
        except Exception:
            self.cb("set_queue_debug", [])

    def _frame_signature(self, frame):
        if frame is None:
            return None

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        small = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)
        mean_value = float(np.mean(small))
        bits = small > mean_value
        return "".join("1" if value else "0" for value in bits.flatten())

    def _batch_signature(self, frame_results):
        signatures = []
        for item in frame_results:
            signature = self._frame_signature(item.get("frame"))
            if signature is None:
                return None
            signatures.append(signature)
        return "".join(signatures)

    def _batch_fingerprint(self, frame_results):
        fingerprints = []
        for item in frame_results:
            frame = item.get("frame")
            if frame is None:
                return None
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
            small = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
            fingerprints.append(small.astype(np.float32))
        return np.stack(fingerprints)

    def _signature_distance(self, left, right):
        if not left or not right or len(left) != len(right):
            return None
        return sum(1 for a, b in zip(left, right) if a != b)

    def _fingerprint_distance(self, left, right):
        if left is None or right is None or left.shape != right.shape:
            return None
        return float(np.mean(np.abs(left - right)))

    def _is_duplicate_batch(self, signature, fingerprint, now):
        if (not signature or not self.last_batch_signature) and (
            fingerprint is None or self.last_batch_fingerprint is None
        ):
            return False

        if now - self.last_batch_saved_at > INSPECTION_DUPLICATE_WINDOW_SEC:
            return False

        hash_distance = self._signature_distance(signature, self.last_batch_signature)
        pixel_distance = self._fingerprint_distance(fingerprint, self.last_batch_fingerprint)

        hash_duplicate = hash_distance is not None and hash_distance <= INSPECTION_DUPLICATE_HASH_DISTANCE
        pixel_duplicate = pixel_distance is not None and pixel_distance <= 10.0
        return hash_duplicate or pixel_duplicate

    def _is_valid_result(self, result):
        try:
            frames = result.get("frames")
            if not isinstance(frames, list) or len(frames) == 0:
                return False

            for item in frames:
                if item.get("frame") is None:
                    return False
                if not np.isfinite(float(item.get("pred_score", 0.0))):
                    return False

            if not np.isfinite(float(result.get("avg_score", 0.0))):
                return False

            return True
        except Exception:
            return False

    def start(self):
        # Chặn start nếu đã đang chạy để tránh lỗi
        if self.running:
            self.cb("log", "System is already running.")
            return False

        self.running = True
        # Khởi tạo job_id từ database nếu có thể, để tránh trùng lặp khi restart
        if self.mongo is not None and hasattr(self.mongo, "get_max_job_id"):
            try:
                self.job_id = self.mongo.get_max_job_id()
                self.cb("log", f"Continue job_id from database: next={self.job_id + 1}")
            except Exception as e:
                print("[Controller] Cannot initialize job_id from database:", e)
                self.cb("log", f"Cannot initialize job_id from database: {e}")
        # 
        self.cb("set_status", "Dang chay")
        self.cb("log", f"Start system conveyor={self.conveyor_code}...")

        try:
            while self.running:
                self.cb("log", "Waiting trigger/capture 3 frames...")

                result = self.pipeline.process_batch()

                if result is None:
                    reason = getattr(self.pipeline, "last_skip_reason", None)
                    if reason:
                        self.cb("log", f"Batch skipped: {reason}")
                    else:
                        self.cb("log", "Batch returned None: not enough frames or pipeline skipped.")
                    time.sleep(0.05)
                    continue

                try:
                    self._handle_batch_result(result)
                except Exception as e:
                    error_trace = traceback.format_exc()
                    print("[Controller] Batch postprocess error:", e)
                    print(error_trace)
                    self.cb("log", f"Batch postprocess error, skipped this batch: {e}")
                    self.cb("log", error_trace)
                    time.sleep(0.05)
                    continue

        except Exception as e:
            print("[Controller] Fatal error in start():", e)
            print(traceback.format_exc())
            self.cb("log", f"Fatal error in start(): {e}")
            self.cb("log", traceback.format_exc())
        finally:
            self.cleanup()

        return True

    def _handle_batch_result(self, result):
        controller_start = time.perf_counter()
        timings = dict(result.get("timings") or {})
        timings.update({
            "controller_signature_ms": 0.0,
            "arduino_ms": 0.0,
            "queue_ms": 0.0,
            "storage_ms": 0.0,
            "gui_update_ms": 0.0,
            "mongo_ms": 0.0,
            "mqtt_ms": 0.0,
            "controller_postprocess_ms": 0.0,
            "end_to_end_ms": 0.0,
        })

        if not self._is_valid_result(result):
            self.cb("log", "Invalid batch result skipped; history was not updated.")
            return

        timestamp = time.time()
        signature_start = time.perf_counter()
        batch_signature = self._batch_signature(result["frames"])
        batch_fingerprint = self._batch_fingerprint(result["frames"])
        timings["controller_signature_ms"] = (time.perf_counter() - signature_start) * 1000.0
        is_duplicate_batch = self._is_duplicate_batch(batch_signature, batch_fingerprint, timestamp)
        if is_duplicate_batch:
            self.cb(
                "log",
                "Duplicate-like batch detected, but live result is still handled.",
            )

        self.job_id += 1
        self.batch_count += 1
        inspection_id = f"INS-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"

        final_label = result["final_label"]
        avg_score = float(result["avg_score"])
        threshold = float(result.get("threshold", getattr(self.model, "image_threshold", 0.0)))

        if self.arduino is not None:
            arduino_start = time.perf_counter()
            try:
                self.arduino.send_result(final_label)
                print(f"[Controller] Sent Arduino: job_id={self.job_id} | label={final_label}")
                self.cb("log", f"Sent Arduino: job_id={self.job_id} | label={final_label}")
            except Exception as e:
                print(f"[Controller] Arduino send error: {e}")
                self.cb("log", f"Arduino send error: {e}")
            finally:
                timings["arduino_ms"] = (time.perf_counter() - arduino_start) * 1000.0
        else:
            print(f"[Controller] Arduino not configured; skip send: job_id={self.job_id} | label={final_label}")
            self.cb("log", f"Arduino not configured; skip send: job_id={self.job_id} | label={final_label}")

        if self.queue is not None:
            queue_start = time.perf_counter()
            try:
                self.queue.push({"job_id": self.job_id, "label": final_label, "score": avg_score})
                self._push_queue_debug()
            except Exception as e:
                self.cb("log", f"Queue update error: {e}")
            finally:
                timings["queue_ms"] = (time.perf_counter() - queue_start) * 1000.0

        frame_documents = []
        storage_start = time.perf_counter()
        for idx, frame_result in enumerate(result["frames"], start=1):
            roi_frame = frame_result.get("frame")
            display_mask = frame_result.get("display_mask")

            if self.storage is not None:
                try:
                    bundle = self.storage.save_frame_bundle(
                        job_id=inspection_id,
                        frame_index=idx,
                        roi_image=roi_frame,
                        overlay_image=display_mask,
                        quality=60,
                    )
                except Exception as e:
                    print(f"[Controller] Save frame bundle failed frame {idx}: {e}")
                    print(traceback.format_exc())
                    self.cb("log", f"Save image error frame {idx}: {e}")
                    bundle = {"roi_path": None, "overlay_path": None}
            else:
                bundle = {"roi_path": None, "overlay_path": None}

            frame_documents.append({
                "frame_index": idx,
                "predicted_label": frame_result.get("pred_label", "UNKNOWN"),
                "predicted_score": float(frame_result.get("pred_score", 0.0)),
                "roi_path": bundle.get("roi_path"),
                "overlay_path": bundle.get("overlay_path"),
            })
        timings["storage_ms"] = (time.perf_counter() - storage_start) * 1000.0

        mongo_document = {
            "inspection_id": inspection_id,
            "job_id": self.job_id,
            "conveyor_code": self.conveyor_code,
            "timestamp": timestamp,
            "label": final_label,
            "average_score": avg_score,
            "threshold": threshold,
            "frames": frame_documents,
        }

        gui_start = time.perf_counter()
        self.cb("update_multiframe_results", result["frames"], avg_score, final_label, threshold)
        self.cb("set_score", f"{avg_score:.6f}")
        self.cb("set_label", final_label)
        self.cb("set_threshold", str(threshold))
        self.cb("set_count", str(self.batch_count))
        timings["gui_update_ms"] = (time.perf_counter() - gui_start) * 1000.0

        if self.mongo is not None:
            mongo_start = time.perf_counter()
            try:
                self.mongo.upsert_result(mongo_document)
                print(f"[Controller] MongoDB saved: job_id={self.job_id}, frames={len(frame_documents)}")
                self.cb("log", f"MongoDB saved: job_id={self.job_id}, frames={len(frame_documents)}")
            except Exception as e:
                print("[Controller] Mongo upsert failed:", e)
                print(traceback.format_exc())
                self.cb("log", f"MongoDB write error: {e}")
            finally:
                timings["mongo_ms"] = (time.perf_counter() - mongo_start) * 1000.0
        else:
            print("[Controller] MongoDB is not available; result was not saved.")
            self.cb("log", "MongoDB is not available; result was not saved.")

        if self.mqtt is not None:
            mqtt_start = time.perf_counter()
            try:
                mqtt_payload = mongo_document.copy()
                self.mqtt.publish(self.mqtt_topic_result, mqtt_payload, qos=1)
                self.cb("log", f"Published MQTT job_id={self.job_id}")
            except Exception as e:
                print("[Controller] MQTT publish failed:", e)
                print(traceback.format_exc())
                self.cb("log", f"MQTT publish error: {e}")
            finally:
                timings["mqtt_ms"] = (time.perf_counter() - mqtt_start) * 1000.0

        self.last_batch_signature = batch_signature
        self.last_batch_fingerprint = batch_fingerprint
        self.last_batch_saved_at = timestamp

        timings["controller_postprocess_ms"] = (time.perf_counter() - controller_start) * 1000.0
        timings["end_to_end_ms"] = float(timings.get("pipeline_total_ms", 0.0)) + timings["controller_postprocess_ms"]

        if self.logger is not None:
            try:
                self.logger.log({
                    "timestamp": timestamp,
                    "job_id": self.job_id,
                    "inspection_id": inspection_id,
                    "conveyor_code": self.conveyor_code,
                    "label": final_label,
                    "avg_score": avg_score,
                    "threshold": threshold,
                    **timings,
                })
            except Exception as e:
                self.cb("log", f"Latency log error: {e}")

    def stop(self):
        if not self.running:
            self.cb("log", "System already stopped.")
            return
        self.running = False
        self.cb("log", "Stop command received.")

    def close(self):
        self.running = False
        self.cleanup()

    def get_camera_delay(self):
        if self.camera is None:
            raise RuntimeError("Camera is not initialized.")
        value = self.camera.get_trigger_delay()
        self.cb("set_camera_delay", str(value))
        return value

    def set_camera_delay(self, value):
        if self.camera is None:
            raise RuntimeError("Camera is not initialized.")
        actual_value = self.camera.set_trigger_delay(value)
        self.cb("set_camera_delay", str(actual_value))
        return actual_value

    def cleanup(self):
        self.running = False

        for name, obj, method in [
            ("Arduino", self.arduino, "close"),
            ("MQTT", self.mqtt, "disconnect"),
            ("MongoDB", self.mongo, "close"),
            ("Camera", self.camera, "stop"),
        ]:
            try:
                if obj is not None:
                    getattr(obj, method)()
            except Exception as e:
                self.cb("log", f"Close {name} error: {e}")

        self.camera = None
        self.model = None
        self.arduino = None
        self.mqtt = None
        self.mongo = None
        self.storage = None
        self.pipeline = None
        self.queue = None
        self.logger = None
        self.cb("reset_ui")
