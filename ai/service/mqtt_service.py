import json
import paho.mqtt.client as mqtt
from typing import Callable, Optional
from config import MQTT_BROKER, MQTT_PORT, MQTT_CLIENT_ID
import time


class MQTTService:
    def __init__(
        self,
        broker: str = MQTT_BROKER,
        port: int = MQTT_PORT,
        client_id: str = MQTT_CLIENT_ID,
    ):
        self.broker = broker
        self.port = port
        self.client_id = client_id
        self._message_handler: Optional[Callable[[str, dict], None]] = None
        self.connected = False
        self._subscriptions = []

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
        )

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def connect(self):
        self.client.connect(self.broker, self.port, 60)
        self.client.loop_start()

    def disconnect(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        finally:
            self.connected = False

    def publish(self, topic: str, payload: dict, qos: int = 1, retain: bool = False):
        self.publish_json(topic, payload, qos=qos, retain=retain)

    def publish_json(self, topic: str, payload: dict, qos: int = 1, retain: bool = False):
        message = json.dumps(payload, ensure_ascii=False)
        self.client.publish(topic, message, qos=qos, retain=retain)

    def subscribe(self, topic: str, qos: int = 1):
        item = (topic, qos)

        if item not in self._subscriptions:
            self._subscriptions.append(item)

        if self.connected:
            self.client.subscribe(topic, qos=qos)
            print(f"[MQTT] Subscribed: {topic}")

    def set_message_handler(self, handler: Callable[[str, dict], None]):
        self._message_handler = handler

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        self.connected = True
        print(f"[MQTT] Connected with reason code: {reason_code}")

        for topic, qos in self._subscriptions:
            client.subscribe(topic, qos=qos)
            print(f"[MQTT] Subscribed: {topic}")

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        self.connected = False
        print(f"[MQTT] Disconnected with reason code: {reason_code}")

    def _on_message(self, client, userdata, msg):
        print(f"[MQTT] Message received topic={msg.topic}, payload={msg.payload}")

        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            payload = {
                "raw": msg.payload.decode("utf-8", errors="ignore")
            }

        if self._message_handler:
            self._message_handler(msg.topic, payload)
        else:
            print("[MQTT] No message handler registered")