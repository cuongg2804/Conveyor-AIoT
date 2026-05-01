import express from "express";
import dotenv from "dotenv";
import router from "./router/index.router";
import * as database from "./config/database";
import { connectMqtt, getClient } from "./config/mqtt";
import { initMqttService } from "./service/mqtt.service";
import { Server } from "socket.io";
import http from "http";
import path from "path";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "view"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storagePath = process.env.AI_STORAGE_PATH
  ? path.resolve(process.env.AI_STORAGE_PATH)
  : path.resolve(__dirname, "../app/storage");

app.use("/images", express.static(storagePath));
app.use(express.static(path.join(__dirname, "public")));

app.use(router);

database.connect();

const mqttClient = connectMqtt();
initMqttService(mqttClient, io);

io.on("connection", (socket) => {
  const client = getClient();
  socket.emit("mqtt_status", {
    status: client?.connected ? "connected" : "disconnected",
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Connected to port ${port}`);
  console.log(`Static image path: ${storagePath}`);
});
