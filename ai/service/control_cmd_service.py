import time
import traceback
from typing import Callable, Optional

from service.mqtt_service import MQTTService
from config import (
    MQTT_BROKER,
    MQTT_PORT,
    MQTT_CLIENT_ID,
    MQTT_TOPIC_CONTROL_COMMAND,
    MQTT_TOPIC_CONTROL_ACK,
    MQTT_TOPIC_SYSTEM_STATUS,
    MQTT_TOPIC_SYSTEM_ERROR,
)
from devices.arduino_comm import ArduinoComm


class ControlCommandService:
    def __init__(
        self,
        start_handler: Callable[[dict], dict],
        stop_handler: Callable[[dict], dict],
        status_handler: Callable[[], dict],
        reload_config_handler: Optional[Callable[[dict], dict]] = None,
        log_handler: Optional[Callable[[str], None]] = None,
    ):
        self.start_handler = start_handler
        self.stop_handler = stop_handler
        self.status_handler = status_handler
        self.reload_config_handler = reload_config_handler
        self.log_handler = log_handler or print

        self.mqtt = MQTTService(
            broker=MQTT_BROKER,
            port=MQTT_PORT,
            client_id=f"{MQTT_CLIENT_ID}-control",
        )
        self.mqtt.set_message_handler(self.handle_mqtt_message)

    def connect(self):
        self.mqtt.connect()
        self.mqtt.subscribe(MQTT_TOPIC_CONTROL_COMMAND, qos=1)
        self.log("[CONTROL] MQTT control command service started")

    def disconnect(self):
        self.mqtt.disconnect()

    def log(self, message: str):
        self.log_handler(message)

    def normalize_command_payload(self, payload: dict) -> dict:
        command_payload = payload.get("payload") or {}
        if not isinstance(command_payload, dict):
            raise RuntimeError("Command payload must be an object")

        conveyor_id = command_payload.get("conveyor_id")
        if conveyor_id is not None:
            command_payload["conveyor_id"] = str(conveyor_id).strip().upper()
        return command_payload

    def require_conveyor_id(self, command_payload: dict) -> str:
        conveyor_id = command_payload.get("conveyor_id")
        if not conveyor_id:
            raise RuntimeError("Thiếu conveyor_id trong MQTT payload")
        conveyor_id = str(conveyor_id).strip().upper()
        if not conveyor_id:
            raise RuntimeError("conveyor_id không hợp lệ")
        command_payload["conveyor_id"] = conveyor_id
        return conveyor_id

    def handle_mqtt_message(self, topic: str, payload: dict):
        if topic != MQTT_TOPIC_CONTROL_COMMAND:
            return

        self.log(f"[CONTROL] Command received: {payload}")
        command_id = payload.get("command_id")
        command = payload.get("command")

        try:
            command_payload = self.normalize_command_payload(payload)

            if command == "START_SYSTEM":
                self.require_conveyor_id(command_payload)
                data = self.start_handler(command_payload)
                ack = self.success_ack(command_id, command, "Start command accepted", data)

            elif command == "STOP_SYSTEM":
                data = self.stop_handler(command_payload)
                ack = self.success_ack(command_id, command, "Stop command accepted", data)

            elif command == "GET_STATUS":
                data = self.status_handler()
                ack = self.success_ack(command_id, command, "System status returned", data)

            elif command == "RELOAD_CONFIG":
                self.require_conveyor_id(command_payload)
                if not callable(self.reload_config_handler):
                    raise RuntimeError("Reload config handler is not configured")
                data = self.reload_config_handler(command_payload)
                ack = self.success_ack(command_id, command, "Config reload accepted", data)

            elif command == "GET_SERIAL_PORTS":
                ports = ArduinoComm.scan_ports()

                ack = self.success_ack(
                    command_id,
                    command,
                    "Serial ports returned",
                    {
                        "ports": ports
                    }
                )

            else:
                ack = self.error_ack(command_id, command, f"Unsupported command: {command}")

            

            self.publish_ack(ack)

            # START/STOP chạy bất đồng bộ trên Tkinter main thread.
            # Không publish status ở đây để tránh gửi trạng thái cũ; GUI sẽ publish khi start/stop thật sự xong.
            if command == "GET_STATUS":
                self.publish_status()

        except Exception as e:
            self.log(f"[CONTROL] Command error: {e}")
            self.log(traceback.format_exc())
            self.publish_ack(self.error_ack(command_id, command, str(e)))
            self.publish_error("CONTROL_COMMAND", str(e), payload)

    def publish_ack(self, ack: dict):
        self.mqtt.publish_json(MQTT_TOPIC_CONTROL_ACK, ack, qos=1)

    def publish_status(self):
        self.mqtt.publish_json(MQTT_TOPIC_SYSTEM_STATUS, self.status_handler(), qos=1)

    def publish_error(self, source: str, message: str, payload=None):
        error_payload = {
            "source": source,
            "message": message,
            "timestamp": time.time(),
        }
        try:
            if payload:
                command_payload = payload.get("payload") or {}
                if command_payload.get("conveyor_id"):
                    error_payload["conveyor_id"] = str(command_payload.get("conveyor_id")).strip().upper()
        except Exception:
            pass
        self.mqtt.publish_json(MQTT_TOPIC_SYSTEM_ERROR, error_payload, qos=1)

    def success_ack(self, command_id, command, message="Command executed successfully", data=None):
        return {
            "command_id": command_id,
            "command": command,
            "status": "SUCCESS",
            "message": message,
            "data": data or {},
            "timestamp": time.time(),
        }

    def error_ack(self, command_id, command, message):
        return {
            "command_id": command_id,
            "command": command,
            "status": "ERROR",
            "message": message,
            "data": None,
            "timestamp": time.time(),
        }
