import { MqttClient } from "mqtt";
import { Server } from "socket.io";
import { handleInspectionResultMessage } from "../controller/inspection.controller";

export const MQTT_TOPICS = {
  INSPECTION_RESULT: "inspection/result",

  CONTROL_COMMAND: "inspection/control/command",
  CONTROL_ACK: "inspection/control/ack",

  SYSTEM_STATUS: "inspection/system/status",
  SYSTEM_ERROR: "inspection/system/error",
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
  const msg = message.toString();

  console.log("MQTT raw message:", msg);

  try {
    return JSON.parse(msg);
  } catch (error) {
    throw new Error(`Invalid MQTT JSON message: ${msg}`);
  }
};

export const initMqttService = (client: MqttClient, io: Server): void => {
  client.on("connect", () => {
    console.log("MQTT connected");

    io.emit("mqtt_status", {
      status: "connected",
      message: "MQTT Broker connected successfully",
    });

    subscribeAll(client);
  });

  client.on("reconnect", () => {
    console.log("MQTT reconnecting");

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
    console.warn("MQTT offline");

    io.emit("mqtt_status", {
      status: "disconnected",
      message: "MQTT client offline",
    });
  });

  client.on("close", () => {
    console.warn("MQTT connection closed");

    io.emit("mqtt_status", {
      status: "disconnected",
      message: "MQTT connection closed",
    });
  });

  client.on("message", async (topic: string, message: Buffer) => {
    try {
      console.log("MQTT topic:", topic);

      const payload = parseJsonPayload(message);
      console.log("MQTT parsed payload:", payload);

      switch (topic) {
        case MQTT_TOPICS.INSPECTION_RESULT: {
          await handleInspectionResultMessage(payload, io);
          return;
        }

        case MQTT_TOPICS.CONTROL_ACK: {
          io.emit("control_ack", payload);
          return;
        }

        case MQTT_TOPICS.SYSTEM_STATUS: {
          io.emit("system_status", payload);
          return;
        }

        case MQTT_TOPICS.SYSTEM_ERROR: {
          io.emit("system_error", payload);
          return;
        }

        default: {
          console.warn("MQTT unhandled topic:", topic);
          return;
        }
      }
    } catch (error) {
      console.error("MQTT message error:", error);
    }
  });
};

const subscribeAll = (client: MqttClient): void => {
  SUBSCRIBE_TOPICS.forEach((topic) => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`MQTT subscribe error [${topic}]:`, err);
        return;
      }

      console.log(`MQTT subscribed: ${topic}`);
    });
  });
};

export const publish = (
  topic: string,
  payload: Record<string, any>,
  qos: 0 | 1 | 2 = 1
): void => {
  const { getClient } = require("../config/mqtt");
  const client: MqttClient | undefined = getClient?.();

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

  console.log("Published control command:", commandPayload);

  return commandPayload;
};