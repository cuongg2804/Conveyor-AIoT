import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

const normalizeConveyorId = (value: any) => String(value || "").trim().toUpperCase();

export const getRuntimeConfig = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeConveyorId(req.params.conveyorId);

    if (!conveyorId) {
      return res.status(400).json({
        success: false,
        message: "Missing conveyor_id.",
      });
    }

    const config = (await ConveyorConfig.findOne({ conveyor_id: conveyorId })
      .populate("model_id")
      .lean()) as any;

    if (!config) {
      return res.status(404).json({
        success: false,
        message: `Runtime config not found for conveyor ${conveyorId}.`,
      });
    }

    const model = config.model_id as any;

    if (!model) {
      return res.status(404).json({
        success: false,
        message: `Model config not found for conveyor ${conveyorId}.`,
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
        mode: config.mode,
        status: config.status,
        threshold,
        model: {
          model_id: String(model._id),
          model_name: model.model_name,
          version: model.version,
          product_code: model.product_code,
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
      message: "Cannot load runtime config.",
      error: error.message,
    });
  }
};
