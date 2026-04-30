import mqtt, { MqttClient } from "mqtt";

let client: MqttClient;
export const connectMqtt = (): MqttClient => {
  client = mqtt.connect(`${process.env.mqtt_server}`, {
    username: `${process.env.mqtt_username}`,
    password: `${process.env.mqtt_password}`,
  });
  console.log("MQTT");
  client.on("connect", () => console.log("MQTT connected"));
  client.on("error", (err) => console.error("MQTT Error:", err));
  client.on("offline", () => console.warn("MQTT Offline"));
  client.on("reconnect", () => console.log("MQTT Reconnecting..."));

  return client;
};

export const getClient = (): MqttClient => client;
