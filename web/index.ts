import express from "express";
import dotenv from "dotenv";
import router from "./router/index.router";
import * as database from "./config/database";
import { connectMqtt, getClient } from "./config/mqtt";
import { initMqttService } from "./service/mqtt.service";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import cookieParser from "cookie-parser";
import User from "./model/user.model";

dotenv.config({ override: true });

const app = express();
const server = http.createServer(app); 
const io = new Server(server); 

app.use(cookieParser());

app.set("view engine", "pug"); // 
app.set("views", path.join(__dirname, "view")); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const resolveStoragePath = () => {
  if (process.env.AI_STORAGE_PATH) return path.resolve(process.env.AI_STORAGE_PATH);

  const candidates = [
    path.resolve(process.cwd(), "../app/storage"),
    path.resolve(__dirname, "../app/storage"),
    path.resolve(__dirname, "../../app/storage"),
  ];

  return candidates.find((candidate) => require("fs").existsSync(candidate)) || candidates[0];
};

const parseCookies = (cookieHeader: string = "") => {
  return cookieHeader.split(";").reduce((cookies: any, item) => {
    const [key, ...values] = item.trim().split("=");
    if (!key) return cookies;

    cookies[key] = decodeURIComponent(values.join("="));
    return cookies;
  }, {});
};

const activeUserSockets = new Map<string, string>();
const offlineTimers = new Map<string, NodeJS.Timeout>();

const storagePath = resolveStoragePath();

app.use("/images", express.static(storagePath));
app.use(express.static(path.join(__dirname, "public")));


app.use(router);

io.on("connection", async (socket) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie || "");
    const token = cookies.token;

    if (!token) {
      socket.disconnect();
      return;
    }

    const user = await User.findOne(
      { token },
      { password: 0 }
    ).lean();

    if (!user) {
      socket.disconnect();
      return;
    }

    const userId = user.user_id;

    // Nếu user đã có 1 socket active khác thì chặn tab/thiết bị mới
    const existingSocketId = activeUserSockets.get(userId);

    if (existingSocketId && existingSocketId !== socket.id) {
      socket.emit("session_rejected", {
        message: "Tài khoản này đang được sử dụng trên một tab hoặc thiết bị khác.",
      });

      socket.disconnect(true);
      return;
    }

    socket.data.user_id = userId;
    activeUserSockets.set(userId, socket.id);

    if (offlineTimers.has(userId)) {
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.delete(userId);
    }

    await User.updateOne(
      { user_id: userId },
      { $set: { status: "ONLINE" } }
    );

    const mqttClient = getClient();

    socket.emit("mqtt_status", {
      status: mqttClient?.connected ? "connected" : "disconnected",
    });

    io.emit("user_status_changed", {
      user_id: userId,
      status: "ONLINE",
    });

    socket.on("disconnect", () => {
      const disconnectedUserId = socket.data.user_id;
      if (!disconnectedUserId) return;

      const currentSocketId = activeUserSockets.get(disconnectedUserId);

      // Chỉ xử lý OFFLINE nếu socket bị ngắt đúng là socket active hiện tại
      if (currentSocketId !== socket.id) return;

      activeUserSockets.delete(disconnectedUserId);

      const timer = setTimeout(async () => {
        try {
          const stillActiveSocket = activeUserSockets.get(disconnectedUserId);

          if (!stillActiveSocket) {
            await User.updateOne(
              { user_id: disconnectedUserId },
              {
                $set: {
                  status: "OFFLINE",
                  token: "",
                },
              }
            );

            io.emit("user_status_changed", {
              user_id: disconnectedUserId,
              status: "OFFLINE",
            });
          }
        } catch (error) {
          console.log("Lỗi cập nhật OFFLINE khi socket disconnect:", error);
        } finally {
          offlineTimers.delete(disconnectedUserId);
        }
      }, 5000);

      offlineTimers.set(disconnectedUserId, timer);
    });
  } catch (error) {
    console.log("Socket auth error:", error);
    socket.disconnect();
  }
});

const startServer = async () => {
  try {
    await database.connect();

    await User.updateMany(
      { status: "ONLINE" },
      { $set: { status: "OFFLINE", token: "" } }
    );

    console.log("Đã reset trạng thái ONLINE về OFFLINE khi khởi động server.");

    const mqttClient = connectMqtt();
    initMqttService(mqttClient, io);

    const port = process.env.PORT || 3000;

    server.listen(port, () => {
      console.log(`Connected to port ${port}`);
      console.log(`Static image path: ${storagePath}`);
    });
  } catch (error) {
    console.log("Lỗi khởi động server:", error);
    process.exit(1);
  }
};

startServer();