import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import router from "./router/index.router";
import * as database from "./config/database";
import { connectMqtt, getClient } from "./config/mqtt";
import { initMqttService, publishControlCommand } from "./service/mqtt.service";
import User from "./model/user.model";
import Conveyor from "./model/conveyor.model";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(__dirname, ".env"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

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

  const candidates = [
    path.resolve(process.cwd(), "../app/storage"),
    path.resolve(__dirname, "../app/storage"),
    path.resolve(__dirname, "../../app/storage"),
    path.join(__dirname, "storage"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
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

type MonitorViewer = {
  socket_id: string;
  user_id: string;
  role: string;
};

const activeUserSockets = new Map<string, ActiveUserSession>();

const operatorDisconnectTimers = new Map<string, NodeJS.Timeout>();
const tokenExpireTimers = new Map<string, NodeJS.Timeout>();

const autoStoppedConveyors = new Set<string>();
const conveyorMonitorViewers = new Map<string, Map<string, MonitorViewer>>();
const replacedSocketIds = new Set<string>();

const AUTO_STOP_DELAY_MS = 30_000;
const TOKEN_EXPIRE_DELAY_MS = 60_000;

const RUNNING_STATUSES = ["STARTING", "RUNNING", "STOPPING"];

const normalizeCode = (value: any) => String(value || "").trim().toUpperCase();

const isAdminUser = (user: any) =>
  String(user?.role || "").toUpperCase() === "ADMIN";

const removeSocketFromMonitorViewers = (socketId: string) => {
  for (const [conveyorId, viewers] of conveyorMonitorViewers.entries()) {
    viewers.delete(socketId);

    if (viewers.size === 0) {
      conveyorMonitorViewers.delete(conveyorId);
    }
  }
};

const hasActiveMonitorViewer = (conveyorId: string) => {
  const viewers = conveyorMonitorViewers.get(conveyorId);

  if (!viewers || viewers.size === 0) return false;

  for (const viewer of viewers.values()) {
    const viewerSocket = io.sockets.sockets.get(viewer.socket_id);

    if (viewerSocket?.connected === true) {
      return true;
    }
  }

  return false;
};

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

    const user = await User.findOne({ token }, { password: 0 }).lean<any>();

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
      const existingSocket = io.sockets.sockets.get(existingSession.socket_id);
      const existingSocketStillConnected = existingSocket?.connected === true;
      const isSameTab = existingSession.tab_id === tabId;


      if (existingSocketStillConnected && existingSocket) {
        if(!isSameTab) {
          socket.emit("session_rejected", {
          message: "Tài khoản này đang được sử dụng trên một tab hoặc thiết bị khác.",
          });
          socket.disconnect(true);
          return;
        }
        replacedSocketIds.add(existingSocket.id);
        activeUserSockets.delete(userId);
        existingSocket.disconnect(true)
      } else {
        activeUserSockets.delete(userId)
      }
    }

    const tokenTimer = tokenExpireTimers.get(userId);

    if (tokenTimer) {
      clearTimeout(tokenTimer);
      tokenExpireTimers.delete(userId);

      //console.log("[SESSION] User reconnected, cancel token expiration:", {
      //  userId,
      //});
    }

    socket.data.user_id = userId;
    socket.data.tab_id = tabId;
    socket.data.user = user;

    if (isAdminUser(user)) {
      socket.join("admins");
    }

    activeUserSockets.set(userId, {
      socket_id: socket.id,
      tab_id: tabId,
    });

    const assignedConveyors = await Conveyor.find({
      user_id: userId,
      is_active: true,
    }).lean<any[]>();

    for (const conveyor of assignedConveyors) {
      const conveyorId = normalizeCode(conveyor.conveyor_id);
      const conveyorName = conveyor.name || conveyorId;

      const autoStopTimer = operatorDisconnectTimers.get(conveyorId);
      const wasAutoStopped = autoStoppedConveyors.has(conveyorId);

      if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        operatorDisconnectTimers.delete(conveyorId);
      }

      if (wasAutoStopped) {
        io.to("admins").emit("user_reconnected", {
          user_id: userId,
          user_name: user.fullname || user.username || userId,
          conveyor_id: conveyorId,
          conveyor_name: conveyorName,
          auto_stopped: true,
          message: `User ${user.fullname || user.username || userId} đã kết nối lại`,
        });
        autoStoppedConveyors.delete(conveyorId);
      }
    }

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

    socket.on("join_monitor", async (payload) => {
      try {
        const conveyorId = normalizeCode(payload?.conveyor_id);

        if (!conveyorId) return;

        const currentUser = socket.data.user;

        const conveyor = await Conveyor.findOne({
          conveyor_id: conveyorId,
          is_active: true,
        }).lean<any>();

        if (!conveyor) return;

        const allowed =
          isAdminUser(currentUser) ||
          String(conveyor.user_id || "") === String(currentUser.user_id || "");

        if (!allowed) {
          socket.emit("monitor_access_denied", {
            conveyor_id: conveyorId,
            message: "Bạn không có quyền giám sát băng tải này.",
          });
          return;
        }

        let viewers = conveyorMonitorViewers.get(conveyorId);

        if (!viewers) {
          viewers = new Map<string, MonitorViewer>();
          conveyorMonitorViewers.set(conveyorId, viewers);
        }

        viewers.set(socket.id, {
          socket_id: socket.id,
          user_id: currentUser.user_id,
          role: currentUser.role,
        });

        console.log("[MONITOR] viewer joined:", {
          conveyorId,
          userId: currentUser.user_id,
          role: currentUser.role,
        });
      } catch (error) {
        console.error("[MONITOR] join_monitor error:", error);
      }
    });

    socket.on("disconnect", async () => {
      const disconnectedUserId = socket.data.user_id;
      const disconnectedUser = socket.data.user;

      if (replacedSocketIds.has(socket.id)) {
        replacedSocketIds.delete(socket.id);
        removeSocketFromMonitorViewers(socket.id);
        return;
      }

      if (!disconnectedUserId) return;

      const currentSession = activeUserSockets.get(disconnectedUserId);

      if (!currentSession || currentSession.socket_id !== socket.id) {
        removeSocketFromMonitorViewers(socket.id);
        return;
      }

      activeUserSockets.delete(disconnectedUserId);
      removeSocketFromMonitorViewers(socket.id);

      try {
        const runningConveyors = await Conveyor.find({
          user_id: disconnectedUserId,
          status: { $in: RUNNING_STATUSES },
          is_active: true,
        }).lean<any[]>();

        if (runningConveyors.length === 0) {
          await User.updateOne(
            { user_id: disconnectedUserId },
            {
              $set: {
                token: "",
                status: "OFFLINE",
              },
            }
          );

          io.emit("user_status_changed", {
            user_id: disconnectedUserId,
            status: "OFFLINE",
          });

          return;
        }

        for (const conveyor of runningConveyors) {
          const conveyorId = normalizeCode(conveyor.conveyor_id);
          const conveyorName = conveyor.name || conveyorId;
          const userName =
            disconnectedUser.fullname ||
            disconnectedUser.username ||
            disconnectedUserId;

          

          if (!operatorDisconnectTimers.has(conveyorId)) {
            const autoStopTimer = setTimeout(async () => {
              try {
                const latestConveyor = await Conveyor.findOne({
                  conveyor_id: conveyorId,
                }).lean<any>();

                if (!latestConveyor) {
                  operatorDisconnectTimers.delete(conveyorId);
                  return;
                }

                const latestStatus = String(latestConveyor.status || "").toUpperCase();

                if (!RUNNING_STATUSES.includes(latestStatus)) {
                  operatorDisconnectTimers.delete(conveyorId);
                  return;
                }

                const operatorReconnected = activeUserSockets.has(disconnectedUserId);
                const hasViewer = hasActiveMonitorViewer(conveyorId);

                if (operatorReconnected || hasViewer) {
                  operatorDisconnectTimers.delete(conveyorId);

                  io.to("admins").emit("auto_stop_cancelled", {
                    user_id: disconnectedUserId,
                    user_name: userName,
                    conveyor_id: conveyorId,
                    conveyor_name: conveyorName,
                    message: `Đã hủy tự động dừng băng tải ${conveyorName}`,
                  });

                  return;
                }
                io.to("admins").emit("user_disconnected", {
                  user_id: disconnectedUserId,
                  user_name: userName,
                  conveyor_id: conveyorId,
                  conveyor_name: conveyorName,
                  countdown_seconds: 30,
                  message: `User ${userName} đã mất kết nối quá 30 giây khi đang vận hành băng tải ${conveyorName}.`,
                });

                publishControlCommand("STOP_SYSTEM", {
                  conveyor_id: conveyorId,
                  source: "WEB_AUTO_STOP",
                  reason: "NO_OPERATOR_OR_VIEWER_AFTER_30S",
                });

                autoStoppedConveyors.add(conveyorId);

                await Conveyor.updateOne(
                  { conveyor_id: conveyorId },
                  {
                    $set: {
                      status: "STOPPING",
                    },
                  }
                );

                io.to("admins").emit("auto_stop_triggered", {
                  user_id: disconnectedUserId,
                  user_name: userName,
                  conveyor_id: conveyorId,
                  conveyor_name: conveyorName,
                  message: `Không có người vận hành hoặc người giám sát sau 30 giây. Hệ thống đã tự động gửi lệnh dừng băng tải ${conveyorName}.`,
                });

                io.emit("conveyor_status_changed", {
                  conveyor_id: conveyorId,
                  status: "STOPPING",
                });

                operatorDisconnectTimers.delete(conveyorId);
              } catch (error) {
                console.error("[AUTO_STOP] Timer error:", error);
                operatorDisconnectTimers.delete(conveyorId);
              }
            }, AUTO_STOP_DELAY_MS);

            operatorDisconnectTimers.set(conveyorId, autoStopTimer);
          }
        }

        if (!tokenExpireTimers.has(disconnectedUserId)) {
          const tokenTimer = setTimeout(async () => {
            try {
              const userReconnected = activeUserSockets.has(disconnectedUserId);

              if (userReconnected) {
                tokenExpireTimers.delete(disconnectedUserId);
                return;
              }

              await User.updateOne(
                { user_id: disconnectedUserId },
                {
                  $set: {
                    token: "",
                    status: "OFFLINE",
                  },
                }
              );

              io.emit("user_status_changed", {
                user_id: disconnectedUserId,
                status: "OFFLINE",
              });

              io.to("admins").emit("user_session_expired", {
                user_id: disconnectedUserId,
                user_name:
                  disconnectedUser.fullname ||
                  disconnectedUser.username ||
                  disconnectedUserId,
                message: `User ${disconnectedUser.fullname || disconnectedUser.username || disconnectedUserId} đã mất kết nối quá 60 giây. Phiên đăng nhập đã bị vô hiệu hóa.`,
              });
            } catch (error) {
              console.error("[SESSION] Token expiration error:", error);
            } finally {
              tokenExpireTimers.delete(disconnectedUserId);
            }
          }, TOKEN_EXPIRE_DELAY_MS);

          tokenExpireTimers.set(disconnectedUserId, tokenTimer);
        }
      } catch (error) {
        console.error("[DISCONNECT] handling error:", error);
      }
    });
  } catch (error) {
    console.log("Socket auth error:", error);
    socket.disconnect(true);
  }
});

const startServer = async () => {
  try {
    await database.connect();

    try {
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
    } catch (error) {
      console.error("Không thể reset trạng thái ONLINE khi khởi động:", error);
    }

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