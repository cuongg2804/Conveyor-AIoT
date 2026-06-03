import time
import traceback

from rewrite.devices.arduino_comm import ArduinoComm
from rewrite.services.mqtt_service import MQTTService
from rewrite.config.config import (
  MQTT_TOPIC_CONTROL_COMMAND,
  MQTT_TOPIC_CONTROL_ACK,
  MQTT_TOPIC_SYSTEM_STATUS,
  MQTT_TOPIC_SYSTEM_ERROR,
)

class ControlCommandService:
  def __init__(
    self,
    start_handler,
    stop_handler,
    status_handler,
    reload_config_handler=None,
    arduino_command_handler=None,
    log_handler=None,
  ):
    self.start_handler = start_handler
    self.stop_handler = stop_handler
    self.status_handler = status_handler
    self.reload_config_handler = reload_config_handler
    self.arduino_command_handler = arduino_command_handler
    self.log_handler = log_handler or print

    self.mqtt = MQTTService(client_id="rewrite_ai_control")
    self.mqtt.set_message_handler(self.handle_mqtt_message)

  def connect(self):
    self.mqtt.connect()
    self.mqtt.subscribe(MQTT_TOPIC_CONTROL_COMMAND, qos=1)
    self.log("[CONTROL] MQTT control service started")

  def disconnect(self):
    self.mqtt.disconnect()

  def log(self, message):
    self.log_handler(message)

  def normalize_command_payload(self, payload):
    command_payload = payload.get("payload") or {}

    if not isinstance(command_payload, dict):
      raise RuntimeError("Command payload must be an object")

    conveyor_id = command_payload.get("conveyor_id") or command_payload.get("conveyor_code")

    if conveyor_id is not None:
      conveyor_id = str(conveyor_id).strip().upper()
      command_payload["conveyor_id"] = conveyor_id
      command_payload["conveyor_code"] = conveyor_id

    return command_payload

  def require_conveyor_id(self, command_payload):
    conveyor_id = command_payload.get("conveyor_id") or command_payload.get("conveyor_code")

    if not conveyor_id:
      raise RuntimeError("Missing conveyor_id in MQTT payload")

    conveyor_id = str(conveyor_id).strip().upper()

    if not conveyor_id:
      raise RuntimeError("Invalid conveyor_id")

    command_payload["conveyor_id"] = conveyor_id
    command_payload["conveyor_code"] = conveyor_id

    return conveyor_id
  def handle_mqtt_message(self, topic, payload):
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
        self.publish_status()

      elif command == "RELOAD_CONFIG":
        self.require_conveyor_id(command_payload)
        if not callable(self.reload_config_handler):
          raise RuntimeError("Reload config handler is not configured")
        data = self.reload_config_handler(command_payload)
        ack = self.success_ack(command_id, command, "Config reload accepted", data)

      elif command == "GET_SERIAL_PORTS":
        ack = self.success_ack(
          command_id,
          command,
          "Serial ports returned",
          {
            "ports": ArduinoComm.scan_ports(),
          },
        )

      elif command in [
        "APPLY_ARDUINO_CONFIG",
        "GET_ARDUINO_CONFIG",
        "LIGHT_CHECK",
        "RESET_ARDUINO_CONFIG_DEFAULT",
      ]:
        self.require_conveyor_id(command_payload)
        if not callable(self.arduino_command_handler):
          raise RuntimeError("Arduino command handler is not configured")
        data = self.arduino_command_handler(command, command_payload)
        ack = self.success_ack(command_id, command, "Arduino command executed", data)

      else:
        ack = self.error_ack(command_id, command, f"Unsupported command: {command}")

      self.publish_ack(ack)

    except Exception as e:
      self.log(f"[CONTROL] Command error: {e}")
      self.log(traceback.format_exc())
      self.publish_ack(self.error_ack(command_id, command, str(e)))
      self.publish_error("CONTROL_COMMAND", str(e), payload)

  def publish_ack(self, ack):
    self.mqtt.publish_json(MQTT_TOPIC_CONTROL_ACK, ack, qos=1)

  def publish_status(self):
    self.mqtt.publish_json(MQTT_TOPIC_SYSTEM_STATUS, self.status_handler(), qos=1)

  def publish_error(self, source, message, payload=None):
    error_payload = {
      "source": source,
      "message": message,
      "timestamp": time.time(),
    }

    try:
      command_payload = (payload or {}).get("payload") or {}
      conveyor_id = command_payload.get("conveyor_id") or command_payload.get("conveyor_code")
      if conveyor_id:
        error_payload["conveyor_id"] = str(conveyor_id).strip().upper()
        error_payload["conveyor_code"] = str(conveyor_id).strip().upper()
    except Exception:
      pass

    self.mqtt.publish_json(MQTT_TOPIC_SYSTEM_ERROR, error_payload, qos=1)

  def success_ack(self, command_id, command, message, data=None):
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
