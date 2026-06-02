import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import ModelRegistry from "../model/modelRegister.model";
import { publishControlCommand } from "../service/mqtt.service";

const allowedCommands = [
  "START_SYSTEM",
  "STOP_SYSTEM",
  "GET_STATUS",
  "RELOAD_CONFIG",
  "GET_SERIAL_PORTS",
];

const normalizeConveyorCode = (value: any) =>
  String(value || "").trim().toUpperCase();

const normalizeRuntimeMode = (value: any) =>
  String(value || "PRODUCTION").toUpperCase() === "TEST"
    ? "TEST"
    : "PRODUCTION";

export const sendCommand = async (req: Request, res: Response) => {
  try {
    const { command, payload } = req.body || {};

    if (!command) {
      return res.status(400).json({
        message: "Vui lòng chọn thao tác điều khiển.",
      });
    }

    if (!allowedCommands.includes(command)) {
      return res.status(400).json({
        message: "Thao tác điều khiển không hợp lệ.",
        allowedCommands,
      });
    }

    const payloadData = payload && typeof payload === "object" ? payload : {};
    const conveyorCode = normalizeConveyorCode(payloadData.conveyor_id);
    const runtimeMode = normalizeRuntimeMode(payloadData.mode);

    if (!conveyorCode) {
      return res.status(400).json({
        message: "Không xác định được băng tải cần điều khiển.",
      });
    }

    const conveyor = await Conveyor.findOne({
      conveyor_id: conveyorCode,
    }).lean<any>();

    if (!conveyor) {
      return res.status(404).json({
        message: `Không tìm thấy băng tải ${conveyorCode}.`,
      });
    }

    const currentStatus = String(conveyor.status || "").toUpperCase();

    if (
      command === "START_SYSTEM" &&
      ["STARTING", "RUNNING", "STOPPING"].includes(currentStatus)
    ) {
      return res.status(409).json({
        message: `Băng tải ${conveyorCode} đang ${currentStatus}, không thể khởi động thêm chế độ khác.`,
      });
    }

    const config = await ConveyorConfig.findOne({
      conveyor_id: conveyorCode,
    }).lean<any>();

    if (!config) {
      return res.status(404).json({
        message: "Không tìm thấy cấu hình băng tải.",
      });
    }

    if (command === "START_SYSTEM") {
      const configMode = normalizeRuntimeMode(config.config_mode);

      if (configMode !== runtimeMode) {
        return res.status(400).json({
          message:
            runtimeMode === "TEST"
              ? "Cấu hình hiện tại không ở chế độ TEST. Vui lòng vào tab Kiểm thử model để lưu cấu hình trước."
              : "Cấu hình hiện tại không ở chế độ PRODUCTION. Vui lòng vào tab Vận hành thật để lưu cấu hình trước.",
        });
      }

      if (!config.model_id) {
        return res.status(400).json({
          message:
            runtimeMode === "TEST"
              ? "Chưa chọn model kiểm thử."
              : "Chưa chọn model vận hành thật.",
        });
      }

      const requiredModelStatus = runtimeMode === "TEST" ? "testing" : "active";

      const model = await ModelRegistry.findOne({
        model_id: config.model_id,
        status: requiredModelStatus,
      }).lean();

      if (!model) {
        return res.status(400).json({
          message:
            runtimeMode === "TEST"
              ? "Model kiểm thử không tồn tại hoặc không còn ở trạng thái testing."
              : "Model vận hành không tồn tại hoặc chưa được phê duyệt active.",
        });
      }

      const data = publishControlCommand(command, {
        ...payloadData,
        conveyor_id: conveyorCode,
        mode: runtimeMode,

        config: {
          conveyor_id: conveyorCode,
          camera_id: config.camera_id,
          camera_trigger_delay: config.camera_trigger_delay,
          serial_port: config.serial_port,
          baud_rate: config.baud_rate,
          ai_threshold: config.ai_threshold,
          speed: config.speed,
          goc_home: config.goc_home,
          goc_gat: config.goc_gat,
        },

        model: {
          model_id: model.model_id,
          model_name: model.model_name,
          version: model.version,
          product_code: model.product_code,
          storage_type: model.storage_type,
          bucket: model.bucket,
          object_key: model.object_key,
          threshold: model.threshold,
          status: model.status,
        },
      });

      await Conveyor.updateOne(
        { conveyor_id: conveyorCode },
        { $set: { status: "STARTING" } }
      );

      return res.json({
        message:
          runtimeMode === "TEST"
            ? "Đã gửi lệnh khởi động kiểm thử model."
            : "Đã gửi lệnh khởi động vận hành thật.",
        data,
      });
    }

    if (command === "STOP_SYSTEM") {
      const data = publishControlCommand(command, {
        ...payloadData,
        conveyor_id: conveyorCode,
        mode: runtimeMode,
      });

      await Conveyor.updateOne(
        { conveyor_id: conveyorCode },
        { $set: { status: "STOPPING" } }
      );

      return res.json({
        message: "Đã gửi lệnh dừng hệ thống.",
        data,
      });
    }

    const data = publishControlCommand(command, {
      ...payloadData,
      conveyor_id: conveyorCode,
      mode: runtimeMode,
    });

    return res.json({
      message: "Đã gửi yêu cầu tới hệ thống kiểm tra.",
      data,
    });
  } catch (error: any) {
    console.error("sendCommand lỗi:", error);

    return res.status(500).json({
      message: "Không gửi được yêu cầu tới hệ thống kiểm tra.",
      error: error.message,
    });
  }
};