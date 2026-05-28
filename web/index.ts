import express from "express";
import path from "path";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import router from "./router/index.router";
import * as database from "./config/database";
import { connectMqtt, getClient } from "./config/mqtt";
import { initMqttService } from "./service/mqtt.service";
import User from "./model/user.model";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "view"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const resolveStoragePath = () => {
  if (process.env.STORAGE_PATH) {
    return path.resolve(process.env.STORAGE_PATH);
  }

  return path.join(__dirname, "storage");
};

const storagePath = resolveStoragePath();

app.use("/images", express.static(storagePath));
app.use(express.static(path.join(__dirname, "public")));

app.use(router);

const parseCookies = (cookieHeader: string = "") => {
  return cookieHeader.split(";").reduce((cookies: Record<string, string>, item) => {
    const [key, ...values] = item.trim().split("=");

    if (!key) return cookies;

    cookies[key] = decodeURIComponent(values.join("="));
    return cookies;
  }, {});
};

type ActiveUserSession = {
  socket_id: string;
  tab_id: string;
};

const activeUserSockets = new Map<string, ActiveUserSession>();
const offlineTimers = new Map<string, NodeJS.Timeout>();

io.on("connection", async (socket) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie || "");
    const token = cookies.token;

    if (!token) {
      socket.disconnect(true);
      return;
    }

    const tabId = String(socket.handshake.auth?.tab_id || "").trim();

    if (!tabId) {
      socket.emit("session_rejected", {
        message: "Không xác định được phiên tab trình duyệt.",
      });

      socket.disconnect(true);
      return;
    }

    const user = await User.findOne(
      { token },
      { password: 0 }
    ).lean();

    if (!user) {
      socket.disconnect(true);
      return;
    }

    const userId = String(user.user_id || "").trim();

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    const existingSession = activeUserSockets.get(userId);

    if (existingSession) {
      const existingSession = activeUserSockets.get(userId);

      if (existingSession) {
        const existingSocket = io.sockets.sockets.get(existingSession.socket_id);
        const existingSocketStillConnected = existingSocket?.connected === true;
        const isSameTab = existingSession.tab_id === tabId;

        if (existingSocketStillConnected && !isSameTab) {
          socket.emit("session_rejected", {
            message: "Tài khoản này đang được sử dụng trên một tab hoặc thiết bị khác.",
          });

          socket.disconnect(true);
          return;
        }

        if (existingSocket?.connected && isSameTab) {
          existingSocket.disconnect(true);
        }

        activeUserSockets.delete(userId);
      }
    }

    if (offlineTimers.has(userId)) {
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.delete(userId);
    }

    socket.data.user_id = userId;
    socket.data.tab_id = tabId;

    activeUserSockets.set(userId, {
      socket_id: socket.id,
      tab_id: tabId,
    });

    await User.updateOne(
      { user_id: userId },
      {
        $set: {
          status: "ONLINE",
        },
      }
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

      const currentSession = activeUserSockets.get(disconnectedUserId);

      if (!currentSession || currentSession.socket_id !== socket.id) {
        return;
      }

      activeUserSockets.delete(disconnectedUserId);

      const timer = setTimeout(async () => {
        try {
          const stillActiveSession = activeUserSockets.get(disconnectedUserId);

          if (!stillActiveSession) {
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
    socket.disconnect(true);
  }
});

const startServer = async () => {
  try {
    await database.connect();

    await User.updateMany(
      { status: "ONLINE" },
      {
        $set: {
          status: "OFFLINE",
          token: "",
        },
      }
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

export { io };