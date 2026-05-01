import mqtt, { IClientOptions, MqttClient } from "mqtt";

let client: MqttClient | undefined;

export const connectMqtt = (): MqttClient => {
  if (client) return client;

  const mqttServer = process.env.mqtt_server || "mqtt://127.0.0.1:1883";

  const options: IClientOptions = {
    clientId: `web-backend-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  };

  if (process.env.mqtt_username) options.username = process.env.mqtt_username;
  if (process.env.mqtt_password) options.password = process.env.mqtt_password;

  client = mqtt.connect(mqttServer, options);

  client.on("connect", () => console.log("MQTT connected"));
  client.on("error", (err) => console.error("MQTT Error:", err));
  client.on("offline", () => console.warn("MQTT Offline"));
  client.on("reconnect", () => console.log("MQTT Reconnecting..."));

  return client;
};

export const getClient = (): MqttClient | undefined => client;
