import mqtt, { IClientOptions, MqttClient } from "mqtt";

let client: MqttClient | undefined;

export const connectMqtt = (): MqttClient => {
  if (client) return client;

  const mqttServer =
    process.env.mqtt_server ||
    process.env.MQTT_SERVER ||
    `mqtt://${process.env.MQTT_BROKER || "127.0.0.1"}:${process.env.MQTT_PORT || "1883"}`;

  const options: IClientOptions = {
    clientId: `web-backend-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  };

  const username = process.env.mqtt_username || process.env.MQTT_USERNAME;
  const password = process.env.mqtt_password || process.env.MQTT_PASSWORD;

  if (username) options.username = username;
  if (password) options.password = password;

  client = mqtt.connect(mqttServer, options);

  client.on("connect", () => console.log("MQTT connected"));
  client.on("error", (err) => console.error("MQTT Error:", err));
  client.on("offline", () => console.warn("MQTT Offline"));
  client.on("reconnect", () => console.log("MQTT Reconnecting..."));

  return client;
};

export const getClient = (): MqttClient | undefined => client;
