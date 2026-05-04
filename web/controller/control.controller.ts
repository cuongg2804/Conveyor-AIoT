import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = ["START_SYSTEM", "STOP_SYSTEM", "GET_STATUS", "RELOAD_CONFIG"]; // Danh sách các lệnh điều khiển hợp lệ
// Hàm chuẩn hóa mã băng tải từ payload
const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();
// Controller để xử lý yêu cầu điều khiển băng tải
export const sendCommand = async (req: Request, res: Response) => {
  try { // Lấy lệnh và payload từ body của yêu cầu
    const { command, payload } = req.body || {};

    if (!command) {
      return res.status(400).json({ message: "Vui lòng chọn thao tác điều khiển." });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({ message: "Thao tác điều khiển không hợp lệ.", allowedCommands });
    }
    // Chuẩn hóa và xác định mã băng tải từ payload
    const payloadData = payload && typeof payload === "object" ? payload : {};
    const conveyorCode = normalizeConveyorCode(payloadData.conveyor_code);

    if (!conveyorCode) {
      return res.status(400).json({ message: "Không xác định được băng tải cần điều khiển." });
    }
    // Kiểm tra xem băng tải có tồn tại trong cơ sở dữ liệu hay không
    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode }).lean();
    if (!conveyor) {
      return res.status(404).json({ message: `Không tìm thấy băng tải ${conveyorCode}.` });
    }
    // Gửi lệnh điều khiển qua MQTT và cập nhật trạng thái băng tải nếu cần thiết
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
    console.error("sendCommand lỗi:", error);
    return res.status(500).json({
      message: "Không gửi được yêu cầu tới hệ thống kiểm tra.",
      error: error.message,
    });
  }
};
