import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import ModelRegistry from "../model/modelRegister.model";
import Camera from "../model/camera.model";
import { publishControlCommand } from "../service/mqtt.service";
import { canAccessConveyor } from "../helper/conveyorAccess.helper";
import Control_log from "../model/control_logs.model";
import { randomUUID } from "crypto";

const allowedCommands = [
  "START_SYSTEM",
  "STOP_SYSTEM",
  "GET_STATUS",
  "RELOAD_CONFIG",
  "GET_SERIAL_PORTS",
  "GET_ARDUINO_CONFIG",
  "LIGHT_CHECK",
  "RESET_ARDUINO_CONFIG_DEFAULT",
  "APPLY_ARDUINO_CONFIG",
  "SCAN_CAMERAS",
];

const normalizeConveyorCode = (value: any) =>
  String(value || "").trim().toUpperCase();

const normalizeRuntimeMode = (value: any) => {
  const mode = String(value || "").trim().toUpperCase();
  return mode === "TEST" ? "TEST" : "PRODUCTION";
};

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
    return "Không kết nối được tới MongoDB";
  }
  return "Không gửi được yêu cầu tới hệ thống kiểm tra.";
};

const commandLogMessages: Record<string, string> = {
  GET_STATUS: "Kiểm tra trạng thái hệ thống.",
  RELOAD_CONFIG: "Áp dụng lại cấu hình cho băng tải.",
  GET_SERIAL_PORTS: "Quét cổng kết nối.",
  GET_ARDUINO_CONFIG: "Kiểm tra cấu hình Arduino.",
  LIGHT_CHECK: "Kiểm tra ánh sáng.",
  RESET_ARDUINO_CONFIG_DEFAULT: "Reset cấu hình mặc định." ,
  APPLY_ARDUINO_CONFIG: "Áp dụng cấu hình Arduino."
};

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
    const conveyorCode = normalizeConveyorCode(
      payloadData.conveyor_id || payloadData.conveyor_code
    );
    const runtimeMode = normalizeRuntimeMode(payloadData.mode);

    if (command === "SCAN_CAMERAS") {
      const data = publishControlCommand(command, {
        requested_by: res.locals.user?.user_id || "",
      });

      await Control_log.create({
        control_log_id: `CTRL-${randomUUID()}`,
        user_id: res.locals.user?.user_id || "",
        conveyor_id: conveyorCode,
        cmd: "SCAN_CAMERAS",
        status: "SUCCESS",
        message: "Người dùng thực hiện quét Camera",
        created_at: new Date(),
      });

      return res.json({
        message: "Đang quét camera.",
        data,
      });
    }

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

    const currentUser = res.locals.user;
    const allow = await canAccessConveyor(currentUser, conveyorCode);

    if (!allow) {
      return res.status(403).json({
        message: "Bạn không có quyền truy cập băng tải này.",
      });
    }

    const currentStatus = String(conveyor.status || "").toUpperCase();
    const runningStatuses = ["STARTING", "RUNNING", "STOPPING"];

    if (command === "RELOAD_CONFIG" && runningStatuses.includes(currentStatus)) {
      return res.status(400).json({
        message:
          "Không thể áp dụng cấu hình khi băng tải đang vận hành. Vui lòng dừng hệ thống trước.",
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

      if (!config.model_id) {
        return res.status(400).json({
          message:
            runtimeMode === "TEST"
              ? "Chưa chọn model kiểm thử."
              : "Chưa chọn model vận hành chính.",
        });
      }

      const camera = config.camera_id
        ? await Camera.findOne({ camera_id: config.camera_id }).lean<any>()
        : null;

      if (!camera) {
        return res.status(400).json({
          message: "Chưa chọn camera hợp lệ cho băng tải.",
        });
      }

      const cameraIp = String(camera.camera_ip || "").trim();

      if (!cameraIp) {
        return res.status(400).json({
          message: "Camera đã chọn có địa chỉ IP không hợp lệ.",
        });
      }

      const requiredModelStatus = runtimeMode === "TEST" ? "testing" : "active";

      const model = await ModelRegistry.findOne({
        model_id: config.model_id,
        status: requiredModelStatus,
      }).lean<any>();

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
        camera_ip: cameraIp,
        mode: runtimeMode,
        DelayTime: config.DelayTime ?? config.camera_trigger_delay_ms ?? config.camera_trigger_delay,
        config: {
          conveyor_id: conveyorCode,
          camera_id: config.camera_id,
          camera_ip: cameraIp,
          camera_trigger_delay: config.camera_trigger_delay,
          camera_trigger_delay_ms: config.camera_trigger_delay_ms,
          serial_port: config.serial_port,
          baud_rate: config.baud_rate,
          ai_threshold: config.ai_threshold,
          arduino_speed_low_level: config.arduino_speed_low_level,
          arduino_speed_high_level: config.arduino_speed_high_level,
          arduino_servo_home_angle: config.arduino_servo_home_angle,
          arduino_servo_gate_angle: config.arduino_servo_gate_angle,
          arduino_light_min_lux: config.arduino_light_min_lux,
          arduino_light_max_lux: config.arduino_light_max_lux,
        },

        model: {
          model_id: model.model_id,
          model_name: model.model_name,
          version: model.version,
          product_code: model.product_code,
          model_format: model.model_format || String(model.object_key || "").split(".").pop(),
          storage_type: model.storage_type,
          bucket: model.bucket,
          object_key: model.object_key,
          threshold: model.threshold,
          status: model.status,
        },
      });

      await Control_log.create({
        control_log_id: `CTRL-${randomUUID()}`,
        user_id: res.locals.user?.user_id || "",
        conveyor_id: conveyorCode,
        cmd: "START_INSPECTION_SESSION",
        status: "SUCCESS",
        message: "Người dùng bắt đầu phiên kiểm tra",
        created_at: new Date(),
      });

      return res.json({
        message:
          runtimeMode === "TEST"
            ? "Đã gửi yêu cầu bắt đầu phiên kiểm thử model."
            : "Đã gửi yêu cầu bắt đầu phiên kiểm tra.",
        data,
      });
    }

    if (command === "STOP_SYSTEM") {
      const data = publishControlCommand(command, {
        ...payloadData,
        conveyor_id: conveyorCode,
        mode: runtimeMode,
      });

      await Control_log.create({
        control_log_id: `CTRL-${randomUUID()}`,
        user_id: res.locals.user?.user_id || "",
        conveyor_id: conveyorCode,
        cmd: "STOP_INSPECTION_SESSION",
        status: "SUCCESS",
        message: "Người dùng kết thúc phiên kiểm tra",
        created_at: new Date(),
      });

      return res.json({
        message: "Đã gửi yêu cầu kết thúc phiên kiểm tra.",
        data,
      });
    }

    const data = publishControlCommand(command, {
      ...payloadData,
      conveyor_id: conveyorCode,
      mode: runtimeMode,
    });

    await Control_log.create({
      control_log_id: `CTRL-${randomUUID()}`,
      user_id: res.locals.user?.user_id || "",
      conveyor_id: conveyorCode,
      cmd: command,
      status: "SUCCESS",
      message: commandLogMessages[command],
      created_at: new Date(),
    });

    return res.json({
      message: "Đã gửi yêu cầu tới hệ thống kiểm tra.",
      data,
    });
  } catch (error: any) {
    console.error("sendCommand lỗi:", error);

    return res.status(500).json({
      message: publicErrorMessage(error),
    });
  }
};
