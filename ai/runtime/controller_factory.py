from config import CKPT_PATH, MQTT_TOPIC_INSPECTION_RESULT
from controllers.controller import SystemController
from core.patchcore_engine import PatchCoreEngine
from devices.arduino_comm import ArduinoComm
from devices.camera_hik import HikCamera
from service.conveyor_config_service import ConveyorConfigService
from service.latency_logger import LatencyLogger
from service.mongo_service import MongoService
from service.mqtt_service import MQTTService
from service.pipeline_service import PipelineService
from service.result_queue import ResultQueue
from service.storage_service import StorageService


class StartupResources:
    def __init__(self, log_handler):
        self.items = []
        self.log = log_handler

    def add(self, name, obj, close_method):
        self.items.append((name, obj, close_method))
        return obj

    def release(self):
        self.items = []

    def cleanup(self):
        resources = list(self.items)
        self.items = []

        for name, obj, close_method in reversed(resources):
            try:
                if obj is not None:
                    getattr(obj, close_method)()
                    self.log(f"[RESET] Closed {name} after startup failure.")
            except Exception as e:
                self.log(f"[RESET] Close {name} error: {e}")


class ControllerFactory:
    def __init__(self, callbacks=None):
        self.callbacks = callbacks or {}

    def cb(self, name, *args):
        callback = self.callbacks.get(name)
        if callable(callback):
            callback(*args)

    def log(self, message):
        self.cb("log", message)

    def load_conveyor_config(self, conveyor_code: str) -> dict:
        if not conveyor_code:
            raise RuntimeError("conveyor_code is required to load conveyor config")

        conveyor_code = str(conveyor_code).strip().upper()
        service = None

        try:
            service = ConveyorConfigService()
            config = service.get_config(conveyor_code)
            self.log(f"Da doc cau hinh bang tai tu DB: {config}")
            return config
        finally:
            try:
                if service is not None and hasattr(service, "close"):
                    service.close()
            except Exception:
                pass

    def create(self, conveyor_code: str) -> tuple:
        resources = StartupResources(self.log)
        conveyor_code = str(conveyor_code).strip().upper()

        self.cb("set_status", "Dang khoi dong")
        self.cb("set_camera_status", "Dang ket noi")
        self.cb("set_model_status", "Dang tai")
        self.cb("set_arduino_status", "Dang ket noi")
        self.log("Bat dau khoi tao he thong...")

        try:
            self.log(f"[CONFIG] Loading conveyor config: {conveyor_code}")
            conveyor_config = self.load_conveyor_config(conveyor_code)

            serial_port = str(conveyor_config["serial_port"])
            baud_rate = int(conveyor_config["baud_rate"])
            image_threshold = float(conveyor_config["ai_threshold"])
            camera_trigger_delay = conveyor_config.get("camera_trigger_delay")
            camera_source = conveyor_config.get("camera_source")

            self.cb("set_threshold", str(image_threshold))
            self.log(
                f"[CONFIG] Loaded: conveyor={conveyor_code}, "
                f"camera_source={camera_source}, "
                f"serial={serial_port}, baud={baud_rate}, "
                f"threshold={image_threshold}, "
                f"camera_delay={camera_trigger_delay}"
            )

            model = self._create_model(image_threshold)
            arduino = self._create_arduino(resources, serial_port, baud_rate)
            camera = self._create_camera(resources, camera_trigger_delay)

            queue = ResultQueue()
            logger = LatencyLogger()
            storage = StorageService()
            mongo = self._create_optional_mongo(resources)
            mqtt = self._create_optional_mqtt(resources)

            pipeline = PipelineService(camera=camera, model=model)
            controller = SystemController(
                pipeline=pipeline,
                queue=queue,
                logger=logger,
                camera=camera,
                model=model,
                arduino=arduino,
                mqtt=mqtt,
                mongo=mongo,
                storage=storage,
                mqtt_topic_result=MQTT_TOPIC_INSPECTION_RESULT,
                callbacks=self.callbacks,
                conveyor_code=conveyor_code,
            )

            resources.release()
            self.cb("set_status", "Da khoi tao")
            self.log("Khoi tao he thong hoan tat.")
            return controller, conveyor_config

        except Exception:
            resources.cleanup()
            raise

    def _create_model(self, image_threshold):
        self.log("Load model...")
        model = PatchCoreEngine(
            CKPT_PATH,
            device="cuda",
            image_threshold=image_threshold,
        )
        self.cb("set_model_status", "Da tai")
        return model

    def _create_arduino(self, resources, serial_port, baud_rate):
        self.log("Ket noi Arduino...")
        arduino = ArduinoComm(
            port=serial_port,
            baudrate=baud_rate,
            timeout=1,
        )
        resources.add("Arduino", arduino, "close")
        arduino.connect()
        self.cb("set_arduino_status", f"Da ket noi ({serial_port})")
        return arduino

    def _create_camera(self, resources, camera_trigger_delay):
        self.log("Khoi tao camera...")
        camera = HikCamera()
        resources.add("Camera", camera, "stop")
        camera.start()
        self.cb("set_camera_status", "Dang chay")

        if camera_trigger_delay is not None:
            try:
                camera.set_trigger_delay(float(camera_trigger_delay))
                self.log(f"Da set camera trigger delay tu DB = {camera_trigger_delay}")
            except Exception as e:
                self.log(f"Khong set duoc camera trigger delay tu DB: {e}")

        try:
            delay_value = camera.get_trigger_delay()
            self.cb("set_camera_delay", str(delay_value))
            self.log(f"Camera delay hien tai = {delay_value}")
        except Exception as e:
            self.cb("set_camera_delay", "Khong doc duoc")
            self.log(f"Khong doc duoc camera delay: {e}")

        return camera

    def _create_optional_mongo(self, resources):
        try:
            mongo = MongoService()
            resources.add("MongoDB", mongo, "close")
            self.log("MongoDB connected.")
            return mongo
        except Exception as e:
            self.log(f"Khong ket noi duoc MongoDB, he thong van chay local: {e}")
            return None

    def _create_optional_mqtt(self, resources):
        try:
            mqtt = MQTTService()
            resources.add("MQTT", mqtt, "disconnect")
            mqtt.connect()
            self.log("MQTT connected.")
            return mqtt
        except Exception as e:
            self.log(f"Khong ket noi duoc MQTT, he thong van chay local: {e}")
            return None
