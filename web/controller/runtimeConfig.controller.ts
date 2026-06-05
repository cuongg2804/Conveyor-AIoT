import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import ModelRegistry from "../model/modelRegister.model";

const normalizeConveyorId = (value: any) =>
  String(value || "").trim().toUpperCase();

export const getRuntimeConfig = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeConveyorId(req.params.conveyorId);

    if (!conveyorId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu conveyor_id.",
      });
    }

    const config = await ConveyorConfig.findOne({
      conveyor_id: conveyorId,
    }).lean<any>();

    if (!config) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy cấu hình cho băng tải ${conveyorId}.`,
      });
    }

    const model = config.model_id
      ? await ModelRegistry.findOne({ model_id: config.model_id }).lean<any>()
      : null;

    if (!model) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy model cho băng tải ${conveyorId}.`,
      });
    }

    const threshold =
      config.threshold_override !== null && config.threshold_override !== undefined
        ? Number(config.threshold_override)
        : Number(model.threshold);

    return res.json({
      success: true,
      data: {
        conveyor_id: config.conveyor_id,
        camera_id: config.camera_id,
        serial_port: config.serial_port,
        baud_rate: config.baud_rate,
        camera_trigger_delay: config.camera_trigger_delay,
        camera_trigger_delay_ms: config.camera_trigger_delay_ms,
        ai_threshold: config.ai_threshold,
        speed: config.speed,
        goc_home: config.goc_home,
        goc_gat: config.goc_gat,
        arduino_speed_low_level: config.arduino_speed_low_level,
        arduino_speed_high_level: config.arduino_speed_high_level,
        arduino_servo_home_angle: config.arduino_servo_home_angle,
        arduino_servo_gate_angle: config.arduino_servo_gate_angle,
        arduino_light_min_lux: config.arduino_light_min_lux,
        arduino_light_max_lux: config.arduino_light_max_lux,
        mode: config.mode,
        config_mode: config.config_mode,
        status: config.status,
        threshold,
        model: {
          model_id: model.model_id,
          model_name: model.model_name,
          version: model.version,
          product_code: model.product_code,
          model_format: model.model_format || String(model.object_key || "").split(".").pop(),
          storage_type: model.storage_type,
          bucket: model.bucket,
          object_key: model.object_key,
          threshold,
          registry_threshold: model.threshold,
          status: model.status,
        },
      },
    });
  } catch (error: any) {
    console.error("getRuntimeConfig error:", error);

    return res.status(500).json({
      success: false,
      message: "Không thể lấy cấu hình runtime.",
      error: error.message,
    });
  }
};