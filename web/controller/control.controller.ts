import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = [
  "START_SYSTEM",
  "STOP_SYSTEM",
  "GET_STATUS",
  "RELOAD_CONFIG",
  "GET_SERIAL_PORT",
  "GET_SERIAL_PORTS",
  "GET_ARDUINO_CONFIG",
  "LIGHT_CHECK",
  "RESET_ARDUINO_CONFIG_DEFAULT",
  "APPLY_ARDUINO_CONFIG",
];

const arduinoCommands = [
  "GET_ARDUINO_CONFIG",
  "LIGHT_CHECK",
  "RESET_ARDUINO_CONFIG_DEFAULT",
  "APPLY_ARDUINO_CONFIG",
];

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

const publicErrorMessage = (error: any) => {
  const raw = String(error?.message || error || "").toLowerCase();
  if (
    raw.includes("mongodb.net") ||
    raw.includes("topologydescription") ||
    raw.includes("serverselection") ||
    raw.includes("replicasetnoprimary") ||
    raw.includes("networktimeout") ||
    raw.includes("timed out") ||
    raw.includes("sockettimeoutms") ||
    raw.includes("connecttimeoutms")
  ) {
    return "Khong ket noi duoc MongoDB Atlas. Kiem tra mang, DNS/VPN hoac IP whitelist roi thu lai.";
  }
  return "Khong gui duoc yeu cau toi he thong kiem tra.";
};

export const sendCommand = async (req: Request, res: Response) => {
  try {
    const { command, payload } = req.body || {};

    if (!command) {
      return res.status(400).json({ message: "Vui long chon thao tac dieu khien." });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({
        message: "Thao tac dieu khien khong hop le.",
        allowedCommands,
      });
    }

    const payloadData = payload && typeof payload === "object" ? payload : {};
    const conveyorCode = normalizeConveyorCode(payloadData.conveyor_id || payloadData.conveyor_code);

    if (!conveyorCode) {
      return res.status(400).json({ message: "Khong xac dinh duoc bang tai can dieu khien." });
    }

    if (!arduinoCommands.includes(command)) {
      const conveyor = await Conveyor.findOne({ conveyor_id: conveyorCode }).lean();
      if (!conveyor) {
        return res.status(404).json({ message: `Khong tim thay bang tai ${conveyorCode}.` });
      }
    }

    const data = publishControlCommand(command, {
      ...payloadData,
      conveyor_id: conveyorCode,
      conveyor_code: conveyorCode,
    });

    if (command === "START_SYSTEM") {
      await Conveyor.updateOne({ conveyor_id: conveyorCode }, { status: "STARTING" });
    }

    if (command === "STOP_SYSTEM") {
      await Conveyor.updateOne({ conveyor_id: conveyorCode }, { status: "STOP" });
    }

    return res.json({ message: "Da gui yeu cau toi he thong kiem tra.", data });
  } catch (error: any) {
    console.error("sendCommand loi:", error);
    return res.status(500).json({
      message: publicErrorMessage(error),
    });
  }
};
