import json
import paho.mqtt.client as mqtt

from rewrite.config.config import (
  MQTT_BROKER,
  MQTT_PORT,
  MQTT_CLIENT_ID,
)


class MQTTService:
  def __init__(self, broker=MQTT_BROKER, port=MQTT_PORT, client_id=MQTT_CLIENT_ID):
    self.broker = broker
    self.port = int(port)
    self.client_id = client_id
    self.client = mqtt.Client(client_id=self.client_id)
    self.message_handler = None

    self.client.on_connect = self._on_connect
    self.client.on_disconnect = self._on_disconnect
    self.client.on_message = self._on_message

  def set_message_handler(self, handler):
    self.message_handler = handler

  def connect(self):
    self.client.connect(self.broker, self.port, keepalive=60)
    self.client.loop_start()
    print(f"MQTT connected: {self.broker}:{self.port}")

  def disconnect(self):
    self.client.loop_stop()
    self.client.disconnect()
    print("MQTT disconnected")

  def subscribe(self, topic, qos=1):
    self.client.subscribe(topic, qos=qos)
    print(f"MQTT subscribed: {topic}")

  def publish_json(self, topic, payload, qos=1):
    data = json.dumps(payload, ensure_ascii=False, default=str)
    self.client.publish(topic, data, qos=qos)
    print(f"MQTT published: {topic}")

  def _on_connect(self, client, userdata, flags, rc):
    if rc == 0:
      print("MQTT broker connected")
    else:
      print(f"MQTT connect failed: rc={rc}")

  def _on_disconnect(self, client, userdata, rc):
    print(f"MQTT disconnected rc={rc}")

  def _on_message(self, client, userdata, msg):
    try:
      raw = msg.payload.decode("utf-8")
      payload = json.loads(raw)

      if callable(self.message_handler):
        self.message_handler(msg.topic, payload)

    except Exception as e:
      print(f"MQTT message error: {e}")