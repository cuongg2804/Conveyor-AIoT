import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = ["START_SYSTEM", "STOP_SYSTEM", "GET_STATUS"];

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

export const sendCommand = async (req: Request, res: Response) => {
  try {
    const { command, payload } = req.body || {};

    if (!command) {
      return res.status(400).json({ message: "command is required" });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({ message: "Invalid command", allowedCommands });
    }

    const payloadData = payload && typeof payload === "object" ? payload : {};
    const conveyorCode = normalizeConveyorCode(payloadData.conveyor_code);

    if (!conveyorCode) {
      return res.status(400).json({ message: "conveyor_code is required" });
    }

    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode }).lean();
    if (!conveyor) {
      return res.status(404).json({ message: `Không tìm thấy băng tải ${conveyorCode}` });
    }

    if (command === "START_SYSTEM") {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "STARTING" });
    }

    if (command === "STOP_SYSTEM") {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "STOPPING" });
    }

    const data = publishControlCommand(command, {
      ...payloadData,
      conveyor_code: conveyorCode,
    });

    return res.json({ message: "Command published", data });
  } catch (error: any) {
    console.error("sendCommand error:", error);
    return res.status(500).json({
      message: "Publish command failed",
      error: error.message,
    });
  }
};
