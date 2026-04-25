import { Request, Response } from "express";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = [
  "START_SYSTEM",
  "STOP_SYSTEM",
  "GET_STATUS",
];

export const sendCommand = async (req: Request, res: Response) => {
  try {
    const { command, payload } = req.body;

    if (!command) {
      return res.status(400).json({
        message: "command is required",
      });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({
        message: "Invalid command",
        allowedCommands,
      });
    }

    const commandPayload = publishControlCommand(command, payload || {});

    return res.json({
      message: "Command published",
      data: commandPayload,
    });
  } catch (error: any) {
    console.error("sendCommand error:", error);

    return res.status(500).json({
      message: "Publish command failed",
      error: error.message,
    });
  }
};