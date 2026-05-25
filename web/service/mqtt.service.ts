import { MqttClient } from "mqtt";
import { Server } from "socket.io";
import { getClient } from "../config/mqtt";
import { handleInspectionResultMessage } from "../controller/inspection.controller";
import { handleSystemStatusMessage, handleSystemErrorMessage } from "../controller/conveyor.controller";

export const MQTT_TOPICS = {
  INSPECTION_RESULT: process.env.MQTT_TOPIC_INSPECTION_RESULT || "inspection/result",
  CONTROL_COMMAND: process.env.MQTT_TOPIC_CONTROL_COMMAND || "inspection/control/command",
  CONTROL_ACK: process.env.MQTT_TOPIC_CONTROL_ACK || "inspection/control/ack",
  SYSTEM_STATUS: process.env.MQTT_TOPIC_SYSTEM_STATUS || "inspection/system/status",
  SYSTEM_ERROR: process.env.MQTT_TOPIC_SYSTEM_ERROR || "inspection/system/error",
} as const;

type ControlCommandPayload = {
  command_id: string;
  command: string;
  source: "WEB";
  timestamp: number;
  payload: Record<string, any>;
};

const SUBSCRIBE_TOPICS = [
  MQTT_TOPICS.INSPECTION_RESULT,
  MQTT_TOPICS.CONTROL_ACK,
  MQTT_TOPICS.SYSTEM_STATUS,
  MQTT_TOPICS.SYSTEM_ERROR,
];

const generateCommandId = (): string => {
  return `CMD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const parseJsonPayload = (message: Buffer): any => {
  const raw = message.toString();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid MQTT JSON message: ${raw}`);
  }
};

const subscribeAll = (client: MqttClient): void => {
  client.subscribe(SUBSCRIBE_TOPICS, { qos: 1 }, (err) => {
    if (err) {
      console.error("MQTT subscribe error:", err);
      return;
    }
    console.log("MQTT subscribed topics:", SUBSCRIBE_TOPICS);
  });
};

export const initMqttService = (client: MqttClient, io: Server): void => {
  client.on("connect", () => {
    io.emit("mqtt_status", {
      status: "connected",
      message: "MQTT Broker connected successfully",
    });
    subscribeAll(client);
  });

  client.on("reconnect", () => {
    io.emit("mqtt_status", {
      status: "reconnecting",
      message: "MQTT reconnecting",
    });
  });

  client.on("error", (err) => {
    console.error("MQTT Error:", err);
    io.emit("mqtt_status", {
      status: "disconnected",
      message: err.message,
    });
  });

  client.on("offline", () => {
    io.emit("mqtt_status", {
      status: "disconnected",
      message: "MQTT client offline",
    });
  });

  client.on("close", () => {
    io.emit("mqtt_status", {
      status: "disconnected",
      message: "MQTT connection closed",
    });
  });

  client.on("message", async (topic: string, message: Buffer) => {
    try {
      const payload = parseJsonPayload(message);

      switch (topic) {
        case MQTT_TOPICS.INSPECTION_RESULT:
          await handleInspectionResultMessage(payload, io);
          return;

        case MQTT_TOPICS.CONTROL_ACK:
          io.emit("control_ack", payload);
          return;

        case MQTT_TOPICS.SYSTEM_STATUS:
          await handleSystemStatusMessage(payload, io);
          return;

        case MQTT_TOPICS.SYSTEM_ERROR:
          await handleSystemErrorMessage(payload, io);
          return;

        default:
          console.warn("MQTT unhandled topic:", topic);
          return;
      }
    } catch (error) {
      console.error("MQTT message error:", error);
    }
  });
};

export const publish = (
  topic: string,
  payload: Record<string, any>,
  qos: 0 | 1 | 2 = 1
): void => {
  const client = getClient();

  if (!client || !client.connected) {
    throw new Error("MQTT client is not connected");
  }

  client.publish(topic, JSON.stringify(payload), { qos });
};

export const publishControlCommand = (
  command: string,
  payload: Record<string, any> = {}
): ControlCommandPayload => {
  const commandPayload: ControlCommandPayload = {
    command_id: generateCommandId(),
    command,
    source: "WEB",
    timestamp: Date.now() / 1000,
    payload,
  };

  publish(MQTT_TOPICS.CONTROL_COMMAND, commandPayload, 1);
  return commandPayload;
};
