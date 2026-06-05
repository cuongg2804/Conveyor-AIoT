import cv2
import time
from harvesters.core import Harvester
from genicam.gentl import TimeoutException

CTI_PATH = r"C:\Program Files\IRayple\MVP\Application\win64\CameraProcol\Cti\MVProducerGEV.cti"

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

  def connect(self):
    if self.ia is not None:
      print("Cam already connected")
      self.camera_status = "CONNECTED"
      return

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
    except Exception as e:
      self.camera_status = "ERROR"
      self.stop()
      raise RuntimeError(f"Cannot connect camera: {e}")

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

    print(f"Loaded camera user set: {self.user_set}")

    self.print_camera_settings()

  def _set_node_value(self, nodes, name, value):
    if not hasattr(nodes, name):
      print(f"{name}: NOT_SUPPORTED")
      return

    try:
      getattr(nodes, name).value = value
      print(f"{name} = {getattr(nodes, name).value}")
    except Exception as e:
      print(f"{name}: SET_ERROR ({e})")

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
      self._set_node_value(nodes, "TriggerSelector", "FrameStart")
      self._set_node_value(nodes, "TriggerMode", "Off")

      self._set_node_value(nodes, "TriggerSelector", "AcquisitionStart")
      self._set_node_value(nodes, "TriggerMode", "On")
    else:
      print("TriggerSelector: NOT_SUPPORTED")

    self._set_node_value(nodes, "TriggerSource", "Line1")
    self._set_node_value(nodes, "TriggerActivation", "FallingEdge")

    if hasattr(nodes, "TriggerDelay"):
      self._set_node_value(nodes, "TriggerDelay", 0.0)
    elif hasattr(nodes, "TriggerDelayAbs"):
      self._set_node_value(nodes, "TriggerDelayAbs", 0.0)

    self.print_camera_settings()

  def start(self):
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

  def print_camera_settings(self):
    if self.ia is None:
      raise RuntimeError("Camera is not connected")

    nodes = self.ia.remote_device.node_map

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
