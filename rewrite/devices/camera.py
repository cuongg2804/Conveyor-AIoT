import os

SDK_BIN = r"C:\Program Files\IRayple\MVP\Application\win64"
SDK_CTI = r"C:\Program Files\IRayple\MVP\Application\win64\CameraProcol\Cti"
CTI_PATH = rf"{SDK_CTI}\MVProducerGEV.cti"

os.environ["PATH"] = SDK_BIN + os.pathsep + SDK_CTI + os.pathsep + os.environ.get("PATH", "")

import cv2
import threading
import time
from harvesters.core import Harvester
from genicam.gentl import TimeoutException

class Camera:
  def __init__(self, cti_path=CTI_PATH,user_set="UserSet1", configure_trigger=False):
    print("--- Init Camera ---")

    self.cti_path = cti_path
    self.user_set = user_set
    self.configure_trigger = configure_trigger

    self.h = None
    self.ia = None

    self.camera_status = "DISCONNECTED"
    self._last_error_print = 0
    self._acquisition_lock = threading.RLock()

  def connect(self, retries=3, retry_delay=3):
    if self.ia is not None:
      print("Cam already connected")
      self.camera_status = "CONNECTED"
      return

    last_error = None

    for attempt in range(1, retries + 1):
      try:
        self.h = Harvester()
        self.h.add_file(self.cti_path)
        self.h.update()

        if len(self.h.device_info_list) == 0:
          raise RuntimeError("No camera found")

        self.ia = self.h.create(0)
        self.load_user_set()
        if self.configure_trigger:
          self.configure_for_triggered_multiframe()
        self.camera_status = "CONNECTED"
        print("Camera connected")
        return
      except Exception as e:
        last_error = e
        self.stop()
        if attempt < retries:
          print(f"Camera connect attempt {attempt}/{retries} failed: {e}. Retrying...")
          time.sleep(retry_delay)

    self.camera_status = "ERROR"
    raise RuntimeError(f"Cannot connect camera after {retries} attempts: {last_error}")

  def load_user_set(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map

    if not hasattr(nodes, "UserSetSelector"):
      raise RuntimeError("Camera does not support UserSetSelector")

    if not hasattr(nodes, "UserSetLoad"):
      raise RuntimeError("Camera does not support UserSetLoad")

    nodes.UserSetSelector.value = self.user_set
    nodes.UserSetLoad.execute()
    time.sleep(0.2)

    print(f"Loaded camera user set: {self.user_set}")

    self.print_camera_settings()

  def save_user_set(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map

    if not hasattr(nodes, "UserSetSelector"):
      raise RuntimeError("Camera does not support UserSetSelector")
    if not hasattr(nodes, "UserSetSave"):
      raise RuntimeError("Camera does not support UserSetSave")

    nodes.UserSetSelector.value = self.user_set
    nodes.UserSetSave.execute()
    time.sleep(0.2)
    print(f"Saved camera settings to user set: {self.user_set}")

  def _set_node_value(self, nodes, name, value):
    if not hasattr(nodes, name):
      print(f"{name}: NOT_SUPPORTED")
      return

    try:
      getattr(nodes, name).value = value
      print(f"{name} = {getattr(nodes, name).value}")
    except Exception as e:
      print(f"{name}: SET_ERROR ({e})")

  def _disable_unused_frame_start_trigger(self, nodes):
    if not hasattr(nodes, "TriggerSelector") or not hasattr(nodes, "TriggerMode"):
      return

    try:
      nodes.TriggerSelector.value = "FrameStart"
      nodes.TriggerMode.value = "Off"
    except Exception as e:
      print(f"Cannot disable unused per-frame trigger: {e}")

  def configure_for_triggered_multiframe(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map
    print("=== Configure camera: one trigger -> 3 frames ===")

    self._set_node_value(nodes, "ExposureMode", "Timed")
    self._set_node_value(nodes, "AcquisitionMode", "MultiFrame")
    self._set_node_value(nodes, "AcquisitionFrameCount", 3)
    self._set_node_value(nodes, "AcquisitionFrameRateEnable", True)
    self._set_node_value(nodes, "AcquisitionFrameRate", 60.0)

    if hasattr(nodes, "TriggerSelector"):
      self._disable_unused_frame_start_trigger(nodes)
      self._set_node_value(nodes, "TriggerSelector", "AcquisitionStart")
      self._set_node_value(nodes, "TriggerMode", "On")
    else:
      print("TriggerSelector: NOT_SUPPORTED")

    self._set_node_value(nodes, "TriggerSource", "Line1")
    self._set_node_value(nodes, "TriggerActivation", "FallingEdge")

    self.print_camera_settings()

  def start(self):
    with self._acquisition_lock:
      if self.ia is None:
        self.connect()

      try:
        self.ia.start()
        self.camera_status = "RUNNING"
        print("Camera started")
      except Exception as e:
        self.camera_status = "ERROR"
        raise RuntimeError(f"Cannot start camera: {e}")

  def stop(self):
    with self._acquisition_lock:
      had_resource = self.ia is not None or self.h is not None

      try:
        if self.ia is not None:
          self.ia.stop()
      except Exception:
        pass

      try:
        if self.ia is not None:
          self.ia.destroy()
      except Exception:
        pass

      try:
        if self.h is not None:
          self.h.reset()
      except Exception:
        pass

      self.ia = None
      self.h = None
      self.camera_status = "DISCONNECTED"

      if had_resource:
        print("Camera stopped")

  def _get_trigger_delay_node(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map
    if hasattr(nodes, "TriggerSelector"):
      try:
        nodes.TriggerSelector.value = "AcquisitionStart"
      except Exception as e:
        raise RuntimeError(f"Cannot select AcquisitionStart trigger delay: {e}")

    if hasattr(nodes, "TriggerDelay"):
      return nodes.TriggerDelay, "TriggerDelay"
    if hasattr(nodes, "TriggerDelayAbs"):
      return nodes.TriggerDelayAbs, "TriggerDelayAbs"

    raise AttributeError("Camera does not support TriggerDelay / TriggerDelayAbs")

  def get_trigger_delay(self):
    node, node_name = self._get_trigger_delay_node()

    try:
      value = node.value
      print(f"{node_name} current = {value}")
      return value
    except Exception as e:
      raise RuntimeError(f"Cannot read camera trigger delay: {e}")

  def set_trigger_delay(self, value, persist=False):
    with self._acquisition_lock:
      was_running = self.camera_status == "RUNNING"
      requested_value = float(value)
      previous_value = None
      actual_value = None
      user_set_saved = False

      try:
        if was_running:
          self.ia.stop()

        node, node_name = self._get_trigger_delay_node()
        previous_value = float(node.value)
        node.value = requested_value
        actual_value = float(node.value)

        if persist and actual_value != previous_value:
          self.save_user_set()
          user_set_saved = True
      except Exception as e:
        raise RuntimeError(f"Cannot update camera trigger delay: {e}")
      finally:
        if was_running:
          try:
            self.ia.start()
            self.camera_status = "RUNNING"
          except Exception as e:
            self.camera_status = "ERROR"
            raise RuntimeError(f"Camera delay updated but acquisition could not restart: {e}")

      node, node_name = self._get_trigger_delay_node()
      actual_value = float(node.value)
      print(
        f"{node_name} AcquisitionStart requested={requested_value} "
        f"actual={actual_value} us user_set_saved={user_set_saved}"
      )
      return actual_value

  def print_camera_settings(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map
    if hasattr(nodes, "TriggerSelector"):
      try:
        nodes.TriggerSelector.value = "AcquisitionStart"
      except Exception as e:
        print(f"TriggerSelector AcquisitionStart: SET_ERROR ({e})")

    setting_names = [
      "UserSetSelector",
      "PixelFormat",
      "ExposureMode",
      "ExposureTime",
      "AcquisitionMode",
      "AcquisitionFrameCount",
      "AcquisitionFrameRateEnable",
      "AcquisitionFrameRate",
      "TriggerSelector",
      "TriggerMode",
      "TriggerSource",
      "TriggerActivation",
      "TriggerDelay",
      "TriggerDelayAbs",
    ]

    print("=== Camera Settings ===")

    for name in setting_names:
      if not hasattr(nodes, name):
        print(f"{name}: NOT_SUPPORTED")
        continue

      try:
        node = getattr(nodes, name)
        print(f"{name}: {node.value}")
      except Exception as e:
        print(f"{name}: READ_ERROR ({e})")

  def _buffer_to_frame(self, buf):
    if buf is None or buf.payload is None:
      return None

    components = buf.payload.components
    if components is None or len(components) == 0:
      return None

    comp = components[0]
    raw = comp.data.reshape(comp.height, comp.width)

    frame = cv2.cvtColor(raw, cv2.COLOR_BAYER_BG2BGR)

    return frame

  def wait_for_trigger(self, timeout=1.0, should_stop=None, poll_timeout=0.2):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    deadline = time.time() + float(timeout)

    while time.time() < deadline:
      if callable(should_stop) and should_stop():
        return None

      remaining = max(0.0, deadline - time.time())
      current_timeout = min(float(poll_timeout), remaining)

      try:
        with self.ia.fetch(timeout=current_timeout) as buf:
          return self._buffer_to_frame(buf)

      except TimeoutException:
        continue

      except Exception as e:
        if not callable(should_stop) or not should_stop():
          print(f"Capture error: {e}")
        return None

    print(f"Camera fetch timeout after {timeout}s")
    return None

  def drain_pending_frames(self, max_frames=20):
    if self.ia is None:
      return 0

    drained = 0
    for _ in range(max_frames):
      try:
        with self.ia.fetch(timeout=0.001):
          drained += 1
      except TimeoutException:
        break
      except Exception:
        break

    if drained:
      print(f"Drained stale camera frames: {drained}")

    return drained

  def wait_for_n_frames(self, n=3, timeout_first=10.0, timeout_each=2.0, should_stop=None):
    with self._acquisition_lock:
      frames = []
      self.drain_pending_frames()

      first = self.wait_for_trigger(timeout=timeout_first, should_stop=should_stop)
      if first is None:
        return frames

      frames.append(first)

      for _ in range(n - 1):
        frame = self.wait_for_trigger(timeout=timeout_each, should_stop=should_stop)
        if frame is None:
          break
        frames.append(frame)

      return frames

  def get_status(self):
    return {
      "status": self.camera_status,
      "connected": self.ia is not None,
      "user_set": self.user_set,
      "cti_path": self.cti_path,
    }
