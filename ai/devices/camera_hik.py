import cv2
import time
from harvesters.core import Harvester
from genicam.gentl import TimeoutException

CTI_PATH = r"C:\Program Files\IRayple\MVP\Application\win64\CameraProcol\Cti\MVProducerGEV.cti"


class HikCamera:
    def __init__(self, cti_path=CTI_PATH):
        print("--- Init Camera ---")

        self.h = None
        self.ia = None
        self._last_error_print = 0

        try:
            self.h = Harvester()
            self.h.add_file(cti_path)
            self.h.update()

            if len(self.h.device_info_list) == 0:
                raise RuntimeError("Khong tim thay camera.")

            self.ia = self.h.create(0)
            self._configure_camera()
        except Exception:
            self.stop()
            raise

    def _configure_camera(self):
        n = self.ia.remote_device.node_map

        print("=== CONFIG CAMERA FOR 3 FRAMES ===")

        try:
            if hasattr(n, "PixelFormat"):
                n.PixelFormat.value = "BayerRG8"
                print("PixelFormat = BayerRG8")
        except Exception as e:
            print(f"⚠️ PixelFormat: {e}")

        try:
            if hasattr(n, "ExposureMode"):
                n.ExposureMode.value = "Timed"
                print("ExposureMode = Timed")
        except Exception as e:
            print(f"⚠️ ExposureMode: {e}")

        try:
            if hasattr(n, "ExposureTime"):
                n.ExposureTime.value = 2300.0
                print(f"ExposureTime = {n.ExposureTime.value} us")
        except Exception as e:
            print(f"⚠️ ExposureTime: {e}")

        # MultiFrame
        try:
            if hasattr(n, "AcquisitionMode"):
                n.AcquisitionMode.value = "MultiFrame"
                print(f"AcquisitionMode = {n.AcquisitionMode.value}")
        except Exception as e:
            print(f"⚠️ AcquisitionMode: {e}")

        try:
            if hasattr(n, "AcquisitionFrameCount"):
                n.AcquisitionFrameCount.value = 3
                print(f"AcquisitionFrameCount = {n.AcquisitionFrameCount.value}")
        except Exception as e:
            print(f"⚠️ AcquisitionFrameCount: {e}")

        try:
            if hasattr(n, "AcquisitionFrameRateEnable"):
                n.AcquisitionFrameRateEnable.value = True
                print(f"AcquisitionFrameRateEnable = {n.AcquisitionFrameRateEnable.value}")
        except Exception as e:
            print(f"⚠️ AcquisitionFrameRateEnable: {e}")

        try:
            if hasattr(n, "AcquisitionFrameRate"):
                n.AcquisitionFrameRate.value = 60.0
                print(f"AcquisitionFrameRate = {n.AcquisitionFrameRate.value}")
        except Exception as e:
            print(f"⚠️ AcquisitionFrameRate: {e}")

        # Tắt FrameStart
        try:
            n.TriggerSelector.value = "FrameStart"
            n.TriggerMode.value = "Off"
            print("TriggerSelector = FrameStart | TriggerMode = Off")
        except Exception as e:
            print(f"⚠️ FrameStart Off: {e}")

        # Bật AcquisitionStart
        try:
            n.TriggerSelector.value = "AcquisitionStart"
            n.TriggerMode.value = "On"
            print("TriggerSelector = AcquisitionStart | TriggerMode = On")
        except Exception as e:
            print(f"⚠️ AcquisitionStart On: {e}")

        try:
            if hasattr(n, "TriggerSource"):
                n.TriggerSource.value = "Line1"
                print(f"TriggerSource = {n.TriggerSource.value}")
        except Exception as e:
            print(f"⚠️ TriggerSource: {e}")

        try:
            if hasattr(n, "TriggerActivation"):
                n.TriggerActivation.value = "FallingEdge"
                print(f"TriggerActivation = {n.TriggerActivation.value}")
        except Exception as e:
            print(f"⚠️ TriggerActivation: {e}")

        try:
            if hasattr(n, "TriggerDelay"):
                n.TriggerDelay.value = 0.0
                print(f"TriggerDelay = {n.TriggerDelay.value} us")
        except Exception as e:
            print(f"⚠️ TriggerDelay: {e}")

        print("✅ Camera configured")
    def start(self):
        if self.ia is None:
            raise RuntimeError("Camera is not initialized.")
        self.ia.start()
        print("Camera started")

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
        if had_resource:
            print("Camera stopped")

    def _print_limited(self, msg, interval=2.0):
        now = time.time()
        if now - self._last_error_print >= interval:
            print(msg)
            self._last_error_print = now

    def _get_delay_node(self):
        nodes = self.ia.remote_device.node_map

        if hasattr(nodes, "TriggerDelay"):
            return nodes.TriggerDelay, "TriggerDelay"
        if hasattr(nodes, "TriggerDelayAbs"):
            return nodes.TriggerDelayAbs, "TriggerDelayAbs"

        raise AttributeError("Camera không hỗ trợ TriggerDelay / TriggerDelayAbs")

    def get_trigger_delay(self):
        node, node_name = self._get_delay_node()
        try:
            value = node.value
            print(f"📷 {node_name} current = {value}")
            return value
        except Exception as e:
            raise RuntimeError(f"Không đọc được camera delay: {e}")

    def set_trigger_delay(self, value):
        node, node_name = self._get_delay_node()
        try:
            value = float(value)
            node.value = value
            print(f"📷 {node_name} updated = {node.value}")
            return node.value
        except Exception as e:
            raise RuntimeError(f"Không cập nhật được camera delay: {e}")

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

    def wait_for_trigger(self, timeout=1.0):
        try:
            with self.ia.fetch(timeout=timeout) as buf:
                return self._buffer_to_frame(buf)
        except TimeoutException:
            self._print_limited(f"Camera fetch timeout after {timeout}s; no frame returned.")
            return None
        except Exception as e:
            self._print_limited(f"⚠️ Capture error: {e}")
            return None

    def wait_for_n_frames(self, n=3, timeout_first=10.0, timeout_each=2.0):
        """
        Chờ frame đầu lâu hơn vì đang đợi trigger ngoài.
        Sau đó lấy tiếp các frame còn lại trong cùng sequence.
        """
        frames = []

        first = self.wait_for_trigger(timeout=timeout_first)
        if first is None:
            return frames

        frames.append(first)

        for _ in range(n - 1):
            frame = self.wait_for_trigger(timeout=timeout_each)
            if frame is None:
                break
            frames.append(frame)

        return frames
