import { MqttClient } from "mqtt";
import { Server } from "socket.io";
import { getClient } from "../config/mqtt";
import { handleInspectionResultMessage } from "../controller/inspection.controller";
import { handleSystemStatusMessage, handleSystemErrorMessage } from "../controller/conveyor.controller";
// Định nghĩa các topic MQTT sử dụng trong ứng dụng, có thể cấu hình qua biến môi trường hoặc sử dụng giá trị mặc định nếu không có biến môi trường nào được thiết lập
export const MQTT_TOPICS = {
  INSPECTION_RESULT: process.env.MQTT_TOPIC_INSPECTION_RESULT || "inspection/result",
  CONTROL_COMMAND: process.env.MQTT_TOPIC_CONTROL_COMMAND || "inspection/control/command",
  CONTROL_ACK: process.env.MQTT_TOPIC_CONTROL_ACK || "inspection/control/ack",
  SYSTEM_STATUS: process.env.MQTT_TOPIC_SYSTEM_STATUS || "inspection/system/status",
  SYSTEM_ERROR: process.env.MQTT_TOPIC_SYSTEM_ERROR || "inspection/system/error",
} as const;
// Định nghĩa kiểu cho các topic MQTT
type ControlCommandPayload = {
  command_id: string;
  command: string;
  source: "WEB";
  timestamp: number;
  payload: Record<string, any>;
};
// Danh sách các topic MQTT mà ứng dụng sẽ subscribe để nhận dữ liệu từ hệ thống
const SUBSCRIBE_TOPICS = [
  MQTT_TOPICS.INSPECTION_RESULT,
  MQTT_TOPICS.CONTROL_ACK,
  MQTT_TOPICS.SYSTEM_STATUS,
  MQTT_TOPICS.SYSTEM_ERROR,
];
// Hàm tạo ID lệnh duy nhất, kết hợp giữa timestamp và một chuỗi ngẫu nhiên để đảm bảo tính duy nhất
const generateCommandId = (): string => {
  //
  return `CMD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const parseJsonPayload = (message: Buffer): any => {
  const raw = message.toString();
  console.log("MQTT raw message:", raw);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid MQTT JSON message: ${raw}`);
  }
};
// Hàm subscribe tất cả các topic MQTT đã định nghĩa, với QoS 1 để đảm bảo tin nhắn được nhận ít nhất một lần
const subscribeAll = (client: MqttClient): void => {
  client.subscribe(SUBSCRIBE_TOPICS, { qos: 1 }, (err) => {
    if (err) {
      console.error("MQTT subscribe lỗi:", err);
      return;
    }
    console.log("MQTT subscribed topics:", SUBSCRIBE_TOPICS);
  });
};
// Hàm khởi tạo dịch vụ MQTT, thiết lập các sự kiện để theo dõi trạng thái kết nối và xử lý tin nhắn nhận được từ các topic đã subscribe
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
      console.log("MQTT topic:", topic);
      const payload = parseJsonPayload(message);
      console.log("MQTT parsed payload:", payload);

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
          console.warn("MQTT topic không được xử lý:", topic);
          return;
      }
    } catch (error) {
      console.error("MQTT message lỗi:", error);
    }
  });
};

export const publish = (
  topic: string,
  payload: Record<string, any>, // Payload sẽ được JSON.stringify trước khi gửi
  qos: 0 | 1 | 2 = 1 // Mặc định QoS là 1 để đảm bảo tin nhắn được nhận ít nhất một lần
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
    timestamp: Date.now() / 1000, // Thời gian hiện tại tính bằng giây kể từ epoch
    payload, // Dữ liệu bổ sung đi kèm lệnh, ví dụ: { conveyor_code: "CONV01" }
  };

  publish(MQTT_TOPICS.CONTROL_COMMAND, commandPayload, 1);
  console.log("Published control command:", commandPayload);
  return commandPayload;
};
