import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Camera from "../model/camera.model";
import User from "../model/user.model";
import ModelRegistry from "../model/modelRegister.model";
import ConfigLog from "../model/config_logs.model";
import { publishControlCommand } from "../service/mqtt.service";

type ConveyorView = {
  conveyor_id: string;
  name: string;
  line_id?: string;
  status?: string;
  operator_id?: string;
  description?: string;
  is_active?: boolean;
};

type ConveyorConfigView = {
  conveyor_id: string;
  camera_id?: string;
  camera_trigger_delay?: number;
  camera_trigger_delay_ms?: number;
  serial_port?: string;
  baud_rate?: number;
  ai_threshold?: number;
  arduino_speed_low_level?: number;
  arduino_speed_high_level?: number;
  arduino_servo_home_angle?: number;
  arduino_servo_gate_angle?: number;
  arduino_light_min_lux?: number;
  arduino_light_max_lux?: number;
  threshold_override?: number | null;
  mode?: string;
  model_id?: any;
};

const normalizeCode = (value: any) => String(value || "").trim().toUpperCase();

const speedPresets = [
  { level: 1, key: "VERY_SLOW", label: "Very Slow", pwm: 153, rpm: 7.95 },
  { level: 2, key: "SLOW", label: "Slow", pwm: 179, rpm: 9.07 },
  { level: 3, key: "NORMAL", label: "Normal", pwm: 204, rpm: 9.88 },
  { level: 4, key: "FAST", label: "Fast", pwm: 230, rpm: 10.54 },
  { level: 5, key: "MAX", label: "Max", pwm: 255, rpm: 12.0 },
];

const defaultArduinoConfig = {
  speed_low_level: 2,
  speed_high_level: 5,
  servo_home_angle: 0,
  servo_gate_angle: 130,
  light_min_lux: 1000,
  light_max_lux: 2000,
};

const optionalNumber = (value: any) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const readNumber = (value: any, fallback: number) => {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const buildArduinoConfig = (config?: ConveyorConfigView | null) => ({
  speed_low_level: readNumber(config?.arduino_speed_low_level, defaultArduinoConfig.speed_low_level),
  speed_high_level: readNumber(config?.arduino_speed_high_level, defaultArduinoConfig.speed_high_level),
  servo_home_angle: readNumber(config?.arduino_servo_home_angle, defaultArduinoConfig.servo_home_angle),
  servo_gate_angle: readNumber(config?.arduino_servo_gate_angle, defaultArduinoConfig.servo_gate_angle),
  light_min_lux: readNumber(config?.arduino_light_min_lux, defaultArduinoConfig.light_min_lux),
  light_max_lux: readNumber(config?.arduino_light_max_lux, defaultArduinoConfig.light_max_lux),
});

const validateArduinoConfig = (config: typeof defaultArduinoConfig) => {
  if (
    !Number.isInteger(config.speed_low_level) ||
    !Number.isInteger(config.speed_high_level) ||
    config.speed_low_level < 1 ||
    config.speed_high_level > 5 ||
    config.speed_low_level >= config.speed_high_level
  ) {
    return "Toc do LOW phai nho hon toc do HIGH va nam trong khoang level 1-5.";
  }

  if (
    config.servo_home_angle < 0 ||
    config.servo_home_angle > 180 ||
    config.servo_gate_angle < 0 ||
    config.servo_gate_angle > 180
  ) {
    return "Goc servo HOME/GAT phai nam trong khoang 0-180 do.";
  }

  if (
    config.light_min_lux < 0 ||
    config.light_max_lux > 3000 ||
    config.light_min_lux >= config.light_max_lux
  ) {
    return "Nguong anh sang phai thoa 0 <= minLux < maxLux <= 3000.";
  }

  return null;
};

export const settings = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeCode(req.params.conveyor_id || req.params.conveyorCode);

    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorView | null>();

    const config = await ConveyorConfig.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorConfigView | null>();

    const modelRegistryList = await ModelRegistry.find({
      status: "active",
    }).lean();

    if (!conveyor || !config) {
      return res.status(404).send("Khong tim thay bang tai hoac cau hinh.");
    }

    const cameras = await Camera.find({
      $or: [
        { status: "AVAILABLE" },
        ...(config.camera_id ? [{ camera_id: config.camera_id }] : []),
      ],
    }).lean();

    const usedOperatorIds = await Conveyor.find({
      conveyor_id: { $ne: conveyorId },
      operator_id: { $ne: "" },
    }).distinct("operator_id");

    const operators = await User.find(
      {
        user_id: { $nin: usedOperatorIds },
      },
      {
        _id: 0,
        user_id: 1,
        username: 1,
        fullname: 1,
      }
    ).lean();

    return res.render("setting/settings", {
      title: "Cau hinh bang tai",
      conveyor,
      config,
      cameras,
      operators,
      updated: req.query.updated === "1",
      configSynced: req.query.synced === "1",
      configSyncFailed: req.query.synced === "0",
      monitorUrl: `/inspection/monitor/${conveyor.conveyor_id}`,
      dashboardUrl: "/dashboard",
      formAction: req.originalUrl.split("?")[0],
      ModelRegistryList: modelRegistryList,
      speedPresets,
      arduinoConfig: buildArduinoConfig(config),
    });
  } catch (error) {
    console.error("Loi render:", error);
    return res.status(500).send("Khong the tai trang cau hinh.");
  }
};

export const scanPorts = async (_req: Request, res: Response) => {
  try {
    const command = publishControlCommand("GET_SERIAL_PORTS", {});
    return res.json({
      success: true,
      command_id: command.command_id,
      message: "Da gui yeu cau scan",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Khong the gui yeu cau scan",
    });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeCode(req.params.conveyor_id || req.params.conveyorCode);
    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorId }).lean<ConveyorView | null>();

    if (!conveyor) {
      return res.status(404).send("Khong tim thay bang tai.");
    }

    const oldConfig = await ConveyorConfig.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorConfigView | null>();

    if (!oldConfig) {
      return res.status(404).send("Khong tim thay cau hinh bang tai.");
    }

    const {
      name,
      line_id,
      status,
      operator_id,
      description,
      camera_id,
      camera_trigger_delay,
      camera_trigger_delay_ms,
      serial_port,
      baud_rate,
      ai_threshold,
      threshold_override,
      mode,
      model_id,
      arduino_speed_low_level,
      arduino_speed_high_level,
      arduino_servo_home_angle,
      arduino_servo_gate_angle,
      arduino_light_min_lux,
      arduino_light_max_lux,
      save_arduino_default,
    } = req.body;

    const arduinoConfig = {
      speed_low_level: readNumber(arduino_speed_low_level, defaultArduinoConfig.speed_low_level),
      speed_high_level: readNumber(arduino_speed_high_level, defaultArduinoConfig.speed_high_level),
      servo_home_angle: readNumber(arduino_servo_home_angle, defaultArduinoConfig.servo_home_angle),
      servo_gate_angle: readNumber(arduino_servo_gate_angle, defaultArduinoConfig.servo_gate_angle),
      light_min_lux: readNumber(arduino_light_min_lux, defaultArduinoConfig.light_min_lux),
      light_max_lux: readNumber(arduino_light_max_lux, defaultArduinoConfig.light_max_lux),
    };

    const arduinoConfigError = validateArduinoConfig(arduinoConfig);
    if (arduinoConfigError) {
      return res.status(400).send(arduinoConfigError);
    }

    const selectedModelId = String(model_id || "").trim();
    if (selectedModelId) {
      const model = await ModelRegistry.findById(selectedModelId).lean();
      if (!model) {
        return res.status(400).send("Model khong ton tai.");
      }
    }

    const newCameraId = normalizeCode(camera_id);
    const oldCameraId = normalizeCode(oldConfig.camera_id);

    if (oldCameraId && oldCameraId !== newCameraId) {
      await Camera.updateOne(
        { camera_id: oldCameraId },
        {
          $set: {
            status: "AVAILABLE",
            conveyor_id: "",
          },
        }
      );
    }

    if (newCameraId) {
      const newCamera = await Camera.findOne({ camera_id: newCameraId }).lean<any>();

      if (!newCamera) {
        return res.status(400).send("Camera khong ton tai.");
      }

      if (
        newCamera.status === "IN_USE" &&
        normalizeCode(newCamera.conveyor_id) !== conveyorId
      ) {
        return res.status(400).send("Camera nay dang duoc gan cho bang tai khac.");
      }

      await Camera.updateOne(
        { camera_id: newCameraId },
        {
          $set: {
            status: "IN_USE",
            conveyor_id: conveyorId,
          },
        }
      );
    }

    const cameraDelay = Number(camera_trigger_delay_ms ?? camera_trigger_delay ?? 0);
    const thresholdOverride = optionalNumber(threshold_override);
    const legacyThreshold =
      thresholdOverride !== null ? thresholdOverride : Number(ai_threshold || 30.436506);

    const changes: Record<string, { old: any; new: any }> = {};
    const addChange = (field: string, oldValue: any, newValue: any) => {
      if (String(oldValue ?? "") !== String(newValue ?? "")) {
        changes[field] = {
          old: oldValue ?? "",
          new: newValue ?? "",
        };
      }
    };

    addChange("name", conveyor.name, name);
    addChange("line_id", conveyor.line_id, line_id);
    addChange("status", conveyor.status, normalizeCode(status || "ONLINE"));
    addChange("operator_id", conveyor.operator_id, operator_id);
    addChange("description", conveyor.description, description);
    addChange("camera_id", oldConfig.camera_id, newCameraId);
    addChange(
      "camera_trigger_delay_ms",
      oldConfig.camera_trigger_delay_ms ?? oldConfig.camera_trigger_delay,
      cameraDelay
    );
    addChange("serial_port", oldConfig.serial_port, serial_port);
    addChange("baud_rate", oldConfig.baud_rate, Number(baud_rate || 9600));
    addChange("arduino_speed_low_level", oldConfig.arduino_speed_low_level, arduinoConfig.speed_low_level);
    addChange("arduino_speed_high_level", oldConfig.arduino_speed_high_level, arduinoConfig.speed_high_level);
    addChange("arduino_servo_home_angle", oldConfig.arduino_servo_home_angle, arduinoConfig.servo_home_angle);
    addChange("arduino_servo_gate_angle", oldConfig.arduino_servo_gate_angle, arduinoConfig.servo_gate_angle);
    addChange("arduino_light_min_lux", oldConfig.arduino_light_min_lux, arduinoConfig.light_min_lux);
    addChange("arduino_light_max_lux", oldConfig.arduino_light_max_lux, arduinoConfig.light_max_lux);
    addChange("threshold_override", oldConfig.threshold_override, thresholdOverride);
    addChange("mode", oldConfig.mode, normalizeCode(mode || "AUTO"));
    addChange("model_id", oldConfig.model_id, selectedModelId);

    await Conveyor.updateOne(
      { conveyor_id: conveyorId },
      {
        $set: {
          name: String(name || "").trim(),
          line_id: String(line_id || "").trim(),
          status: normalizeCode(status || "ONLINE"),
          operator_id: String(operator_id || "").trim(),
          description: String(description || "").trim(),
        },
      }
    );

    await ConveyorConfig.updateOne(
      { conveyor_id: conveyorId },
      {
        $set: {
          camera_id: newCameraId,
          camera_trigger_delay: cameraDelay,
          camera_trigger_delay_ms: cameraDelay,
          serial_port: String(serial_port || "").trim(),
          baud_rate: Number(baud_rate || 9600),
          arduino_speed_low_level: arduinoConfig.speed_low_level,
          arduino_speed_high_level: arduinoConfig.speed_high_level,
          arduino_servo_home_angle: arduinoConfig.servo_home_angle,
          arduino_servo_gate_angle: arduinoConfig.servo_gate_angle,
          arduino_light_min_lux: arduinoConfig.light_min_lux,
          arduino_light_max_lux: arduinoConfig.light_max_lux,
          ai_threshold: legacyThreshold,
          threshold_override: thresholdOverride,
          mode: normalizeCode(mode || "AUTO"),
          model_id: selectedModelId || null,
        },
      }
    );

    if (Object.keys(changes).length > 0) {
      await ConfigLog.create({
        config_log_id: `CFG_${Date.now()}`,
        conveyor_id: conveyorId,
        user_id: res.locals.user?.user_id || req.cookies?.user_id || "UNKNOWN",
        action: "UPDATE_CONFIG",
        changes,
        message: String(description || "").trim() || "Cap nhat cau hinh bang tai",
      });
    }

    try {
      publishControlCommand("APPLY_ARDUINO_CONFIG", {
        conveyor_id: conveyorId,
        conveyor_code: conveyorId,
        speed_low_level: arduinoConfig.speed_low_level,
        speed_high_level: arduinoConfig.speed_high_level,
        servo_home_angle: arduinoConfig.servo_home_angle,
        servo_gate_angle: arduinoConfig.servo_gate_angle,
        light_min_lux: arduinoConfig.light_min_lux,
        light_max_lux: arduinoConfig.light_max_lux,
        save_default: save_arduino_default === "1" || save_arduino_default === "on" || save_arduino_default === true,
      });
    } catch (error) {
      console.error("Publish APPLY_ARDUINO_CONFIG failed:", error);
      return res.redirect(`/settings/${conveyorId}?updated=1&synced=0`);
    }

    return res.redirect(`/settings/${conveyorId}?updated=1`);
  } catch (error) {
    console.error("Update settings khong thanh cong:", error);
    return res.status(500).send("Khong the cap nhat cau hinh.");
  }
};
