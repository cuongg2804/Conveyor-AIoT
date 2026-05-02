import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = ["START_SYSTEM", "STOP_SYSTEM", "GET_STATUS", "RELOAD_CONFIG"];

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

export const sendCommand = async (req: Request, res: Response) => {
  try {
    const { command, payload } = req.body || {};

    if (!command) {
      return res.status(400).json({ message: "Vui lòng chọn thao tác điều khiển." });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({ message: "Thao tác điều khiển không hợp lệ.", allowedCommands });
    }

    const payloadData = payload && typeof payload === "object" ? payload : {};
    const conveyorCode = normalizeConveyorCode(payloadData.conveyor_code);

    if (!conveyorCode) {
      return res.status(400).json({ message: "Không xác định được băng tải cần điều khiển." });
    }

    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode }).lean();
    if (!conveyor) {
      return res.status(404).json({ message: `Không tìm thấy băng tải ${conveyorCode}.` });
    }

    const data = publishControlCommand(command, {
      ...payloadData,
      conveyor_code: conveyorCode,
    });

    if (command === "START_SYSTEM") {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "STARTING" });
    }

    if (command === "STOP_SYSTEM") {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "STOPPING" });
    }

    return res.json({ message: "Đã gửi yêu cầu tới hệ thống kiểm tra.", data });
  } catch (error: any) {
    console.error("sendCommand error:", error);
    return res.status(500).json({
      message: "Không gửi được yêu cầu tới hệ thống kiểm tra.",
      error: error.message,
    });
  }
};
