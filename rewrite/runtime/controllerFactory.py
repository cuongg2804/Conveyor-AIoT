from rewrite.devices.arduino_comm import ArduinoComm
from rewrite.devices.camera import Camera
from rewrite.services.pipeline_service import PipelineService
from rewrite.services.result_service import ResultService
from rewrite.services.storage_service import StorageService
from rewrite.services.model_cache_manager import ModelCacheManager
from rewrite.services.runtime_config_service import RuntimeConfigService
from rewrite.services.runtime_state_manager import RuntimeStateManager
from rewrite.services.latency_logger import LatencyLogger
from rewrite.runtime.model_factory import create_model_engine, detect_model_format

import uuid
import threading
import time

class SystemController:
  def __init__(self):
    self.running = False
    self.status = "STOPPED"

    # self.config = ConfigService()
    self.conveyor_id = None
    self.conveyor_config = None

    self.arduino = None
    self.arduino_status = "DISCONNECTED"

    self.camera = None
    self.camera_status = "DISCONNECTED"

    self.model = None
    self.model_format = None
    self.requested_model = None
    self.running_model = None
    self.rollback_model = None
    self.pipeline = None
    self.last_result = None

    self.inspection_thread = None
    self.loop_running = False
    self.on_result = None
    self.stop_event = threading.Event()

    self.result_service = None
    self.stt = 0

    self.storage_service = None
    self.model_cache = ModelCacheManager()
    self.runtime_state = RuntimeStateManager()
    self.logger = LatencyLogger()

  def start(self, conveyor_id,on_result=None):
    if self.running == True:
      print("System already running")
      return

    self.stop_event.clear()
    try:
      self.conveyor_id = conveyor_id
      config_service = RuntimeConfigService()
      config = config_service.get_config(conveyor_id)

      if config is None:
        raise RuntimeError("RuntimeConfigService returned empty config")
      self.conveyor_config = config
      self.requested_model = config.get("model")

      self.result_service = ResultService()
      self.stt = self.result_service.get_max_stt()

      self.storage_service = StorageService()

      threshold = float(config.get("ai_threshold"))
      runtime_threshold = threshold

      try:
        local_model_path = self.model_cache.ensure_cached(self.requested_model)
        self.model_format = detect_model_format(local_model_path, self.requested_model)
        self.model = create_model_engine(
          model_path=local_model_path,
          device="cuda",
          threshold=threshold,
          model_config=self.requested_model,
        )
        state = self.runtime_state.promote_current(self.requested_model, local_model_path)
        self.running_model = state.get("current_model")
        self.rollback_model = state.get("rollback_model")
        self.model_cache.prune([
          (self.running_model or {}).get("model_id"),
          (self.rollback_model or {}).get("model_id"),
        ])
      except Exception as model_error:
        self.model = None
        runtime_threshold = self.load_rollback_model(threshold, model_error)
        config["ai_threshold"] = runtime_threshold

      #Connect Arduino
      self.arduino = ArduinoComm(config.get("serial_port"),config.get("baud_rate"))
      self.arduino.connect()
      self.arduino_status = "CONNECTED"
      try:
        self.apply_arduino_config(config)
      except RuntimeError as arduino_config_error:
        if "config protocol is not responding" not in str(arduino_config_error):
          raise
        self.arduino_status = "CONNECTED_LEGACY"
        print(
          "Arduino config protocol unavailable; "
          f"continuing with firmware defaults: {arduino_config_error}"
        )

      self.camera = Camera(configure_trigger=True)
      self.camera.connect()
      self.apply_camera_trigger_delay(config)
      self.camera.start()
      self.camera_status = self.camera.get_status().get("status")

      self.pipeline = PipelineService(
        camera=self.camera,
        model=self.model,
        threshold=runtime_threshold,
        num_frames=3,
        should_stop=self.should_stop_requested,
      )

      self.arduino.send_line("START")
      self.running = True
      if self.status != "RUNNING_ROLLBACK":
        self.status = "RUNNING"
      self.start_inspection_loop(on_result=on_result)
      print(self.model_format)
      print("SYSTEM STARTED")
    except Exception as e:
      print(f"Start system failed: {e}")
      self.cleanup_startup_failure()
      raise

  def stop(self):

    if self.running == False:
      print("System already stopped")
      return

    self.running = False
    self.loop_running = False
    self.stop_event.set()
    self.status = "STOPPING"



    if self.inspection_thread is not None and self.inspection_thread.is_alive():
      self.inspection_thread.join(timeout=15)

    self.inspection_thread = None

    if self.arduino is not None:
      try:
        self.arduino.send_line("STOP")
      except Exception as e:
        print(f"Arduino stop command failed: {e}")
      self.arduino.close()
      self.arduino = None

    self.arduino_status = "DISCONNECTED"

    if self.camera is not None:
      self.camera.stop()
      self.camera = None

    # if self.config is not None:
    #   self.config.close()

    self.camera_status = "DISCONNECTED"

    if self.result_service is not None:
      self.result_service.close()
      self.result_service = None
    self.storage_service = None
    self.pipeline = None
    self.model = None
    self.requested_model = None
    self.running_model = None
    self.rollback_model = None
    self.model_format = None

    self.status = "STOPPED"
    print("SYSTEM STOPPED")

  def load_rollback_model(self, threshold, original_error):
    state = self.runtime_state.load()
    fallback = state.get("current_model") or state.get("rollback_model")

    if not fallback or not fallback.get("local_path"):
      raise RuntimeError(f"MODEL_LOAD_FAILED: {original_error}")

    try:
      self.model_format = detect_model_format(fallback.get("local_path"), fallback)
      self.model = create_model_engine(
        model_path=fallback.get("local_path"),
        device="cuda",
        threshold=float(fallback.get("threshold", threshold)),
        model_config=fallback,
      )
      self.running_model = fallback
      self.rollback_model = state.get("rollback_model")
      self.status = "RUNNING_ROLLBACK"
      print(f"MODEL_LOAD_FAILED, rollback active: {original_error}")
      return float(fallback.get("threshold", threshold))
    except Exception as rollback_error:
      raise RuntimeError(
        f"MODEL_LOAD_FAILED: {original_error}; ROLLBACK_LOAD_FAILED: {rollback_error}"
      )

  def run_once(self):
    if not self.running:
      print("System is not running")
      return None

    if self.should_stop_requested():
      return None

    if self.pipeline is None:
      raise RuntimeError("Pipeline is not initialized")


    controller_start = time.perf_counter()
    timings = {
      "controller_signature_ms": 0.0,
      "storage_ms": 0.0,
      "arduino_ms": 0.0,
      "queue_ms": 0.0,
      "gui_update_ms": 0.0,
      "mongo_ms": 0.0,
      "mqtt_ms": 0.0,
      "controller_postprocess_ms": 0.0,
      "end_to_end_ms": 0.0,
    }
    pipeline = self.pipeline
    result = pipeline.inspect_once()
    if result is None:
      if self.should_stop_requested():
        return None
      raise RuntimeError(pipeline.last_error or "Pipeline returned no result")
    timings.update(result.get("timings") or {})
    #Minio
    inspection_id = f"INS-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"

    storage_start = time.perf_counter()
    if self.storage_service is not None:
      for frame in result.get("frames", []):
        upload_result = self.storage_service.save_roi(
          conveyor_id=self.conveyor_id,
          inspection_id=inspection_id,
          frame_index=frame.get("frame_index"),
          roi_image=frame.get("roi"),
        )

        frame["roi_path"] = upload_result.get("url")
        frame["roi_object_key"] = upload_result.get("object_key")
    timings["storage_ms"] = (time.perf_counter() - storage_start) * 1000.0
    #End Minio
    self.stt += 1
    mongo_start = time.perf_counter()
    if self.result_service is not None:
      saved_doc = self.result_service.save_result(
        conveyor_id=self.conveyor_id,
        stt=self.stt,
        result=result,
        inspection_id=inspection_id,
      )
      result["inspection_id"] = saved_doc.get("inspection_id")
      result["stt"] = saved_doc.get("stt")
      result["timestamp"] = saved_doc.get("timestamp")
      print(f"Saved result: {saved_doc.get('inspection_id')}")

    timings["mongo_ms"] = (time.perf_counter() - mongo_start) * 1000.0
    self.last_result = result

    if self.arduino is not None:
      arduino_start = time.perf_counter()
      self.arduino.send_result(result["final_label"])
      timings["arduino_ms"] = (time.perf_counter() - arduino_start) * 1000.0

    frame_scores = [
      round(float(frame.get("pred_score", 0.0)), 3)
      for frame in result.get("frames", [])
    ]
    print(
      f"Inspection result: label={result['final_label']} "
      f"ng_count={result.get('ng_count')} "
      f"threshold={float(result['threshold']):.3f} "
      f"frame_scores={frame_scores}"
    )

    timings["controller_postprocess_ms"] = (time.perf_counter() - controller_start) * 1000.0
    timings["end_to_end_ms"] = (
      float(timings.get("pipeline_total_ms", 0.0)) + timings["controller_postprocess_ms"]
    )

    if self.logger is not None:
      model_status = self.model.get_status() if self.model is not None else {}
      running_model = self.running_model or {}
      self.logger.log({
        "timestamp": result.get("timestamp", time.time()),
        "stt": result.get("stt"),
        "inspection_id": result.get("inspection_id"),
        "conveyor_id": self.conveyor_id,
        "model_id": running_model.get("model_id"),
        "model_name": running_model.get("model_name"),
        "model_version": running_model.get("version"),
        "model_format": self.model_format,
        "model_provider": model_status.get("provider") or model_status.get("device"),
        "label": result.get("final_label"),
        "ng_count": int(result.get("ng_count", 0) or 0),
        "threshold": float(result.get("threshold", 0.0)),
        **timings,
      })

    return result
  def get_status(self):
    config = self.conveyor_config or {}

    camera_status = (
      self.camera.get_status().get("status")
      if self.camera is not None
      else "DISCONNECTED"
    )

    arduino_status = (
      self.arduino.get_status().get("status")
      if self.arduino is not None
      else "DISCONNECTED"
    )

    last_label = None
    if self.last_result is not None:
      last_label = self.last_result.get("final_label")

    return {
      "running": self.running,
      "status": self.status,
      "conveyor_id": self.conveyor_id,
      "camera_source": config.get("camera_source") or config.get("camera_id"),
      "camera_status": camera_status,
      "camera_trigger_delay": config.get("camera_trigger_delay_ms", config.get("camera_trigger_delay")),
      "serial_port": config.get("serial_port"),
      "baud_rate": config.get("baud_rate"),
      "ai_threshold": config.get("ai_threshold"),
      "arduino_status": arduino_status,
      "last_label" : last_label,
      "requested_model": self.requested_model,
      "running_model": self.running_model,
      "rollback_model": self.rollback_model,
      "model_format": self.model_format,
      "model_status": self.model.get_status() if self.model is not None else None,
    }

  def apply_camera_trigger_delay(self, config):
    if self.camera is None:
      raise RuntimeError("Camera is not initialized")

    delay = config.get("camera_trigger_delay_ms")
    if delay is None:
      delay = config.get("camera_trigger_delay")
    if delay is None:
      return None

    actual_delay = self.camera.set_trigger_delay(float(delay), persist=True)
    config["camera_trigger_delay"] = actual_delay
    config["camera_trigger_delay_ms"] = actual_delay
    print(f"Applied camera trigger delay: {actual_delay}")
    return actual_delay

  def apply_arduino_config(self, config):
    if self.arduino is None:
      raise RuntimeError("Arduino is not initialized")

    result = self.arduino.apply_config(
      speed_low_level=config.get("arduino_speed_low_level", 2),
      speed_high_level=config.get("arduino_speed_high_level", 5),
      servo_home_angle=config.get("arduino_servo_home_angle", 0),
      servo_gate_angle=config.get("arduino_servo_gate_angle", 130),
      light_min_lux=config.get("arduino_light_min_lux", 1000),
      light_max_lux=config.get("arduino_light_max_lux", 2000),
    )
    print("Applied Arduino runtime config")
    return result

  def apply_runtime_config(self, config):
    actual_delay = None
    arduino_config = None
    if self.running and self.camera is not None:
      actual_delay = self.apply_camera_trigger_delay(config)
    if self.running and self.arduino is not None:
      arduino_config = self.apply_arduino_config(config)

    threshold = float(config.get("ai_threshold", self.pipeline.threshold if self.pipeline else 0.0))
    if self.pipeline is not None:
      self.pipeline.threshold = threshold
    if self.model is not None:
      self.model.image_threshold = threshold

    self.conveyor_config = config
    return {
      "camera_trigger_delay": actual_delay,
      "arduino_config": arduino_config,
      "ai_threshold": threshold,
    }

  def start_inspection_loop(self, on_result=None):
    if self.loop_running:
      print("Inspection loop already running")
      return

    self.on_result = on_result
    self.loop_running = True

    self.inspection_thread = threading.Thread(
      target=self._inspection_loop,
      daemon=True
    )
    self.inspection_thread.start()

    print("Inspection loop started")

  def should_stop_requested(self):
    return self.stop_event.is_set() or not self.loop_running or not self.running

  def cleanup_startup_failure(self):
    self.running = False
    self.loop_running = False
    self.stop_event.set()

    if self.inspection_thread is not None and self.inspection_thread.is_alive():
      self.inspection_thread.join(timeout=5)

    self.inspection_thread = None

    if self.arduino is not None:
      try:
        self.arduino.close()
      except Exception as e:
        print(f"Close Arduino after start failure error: {e}")
      self.arduino = None

    if self.camera is not None:
      try:
        self.camera.stop()
      except Exception as e:
        print(f"Stop camera after start failure error: {e}")
      self.camera = None

    if self.result_service is not None:
      try:
        self.result_service.close()
      except Exception as e:
        print(f"Close ResultService after start failure error: {e}")
      self.result_service = None

    self.storage_service = None
    self.pipeline = None
    self.model = None
    self.model_format = None
    self.running_model = None
    self.arduino_status = "DISCONNECTED"
    self.camera_status = "DISCONNECTED"
    self.status = "ERROR"
  def _inspection_loop(self):
    while self.loop_running and self.running:
      try:
        result = self.run_once()

        if result is not None and callable(self.on_result):
          self.on_result(result)

      except Exception as e:
        if self.loop_running and self.running:
          print(f"Inspection loop error: {e}")
        time.sleep(0.1)

      time.sleep(0.02)
