import { MqttClient } from "mqtt";
import { Server } from "socket.io";
import { handleInspectionResultMessage } from "../controller/inspection.controller";

const TOPICS = {
  INSPECTION_RESULT: "inspection/result",
} as const;

export const initMqttService = (client: MqttClient, io: Server): void => {
  // Emit socket status theo mqtt connection events
  client.on("connect", () => {
    io.emit("mqtt_status", {
      status: "connected",
      message: "MQTT Broker connected successfully",
    });

    subscribeAll(client);
  });

  client.on("error", () => io.emit("mqtt_status", { status: "disconnected" }));
  client.on("offline", () => io.emit("mqtt_status", { status: "disconnected" }));

  // Xử lý message
  client.on("message", async (topic: string, message: Buffer) => {
    try {
      const msg = message.toString();
      console.log("MQTT topic:", topic);
      console.log("MQTT raw message:", msg);

      const payload = JSON.parse(msg);
      console.log("MQTT parsed payload:", payload);

      switch (topic) {
        case TOPICS.INSPECTION_RESULT:
          await handleInspectionResultMessage(payload, io);
          break;

        default:
          console.warn("MQTT unhandled topic:", topic);
      }
    } catch (error) {
      console.error("MQTT message error:", error);
    }
  });
};

const subscribeAll = (client: MqttClient): void => {
  Object.values(TOPICS).forEach((topic) => {
    client.subscribe(topic, (err) => {
      // if (err) console.error(`MQTT subscribe error [${topic}]:`, err);
      // else console.log(`MQTT subscribed: ${topic}`);
    });
  });
};

export const publish = (topic: string, payload: object): void => {
  const { getClient } = require("../config/mqtt");
  getClient()?.publish(topic, JSON.stringify(payload));
};