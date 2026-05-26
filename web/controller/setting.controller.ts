import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Camera from "../model/camera.model";
import User from "../model/user.model";
import Config_log from "../model/config_logs.model";
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
  serial_port?: string;
  baud_rate?: number;
  ai_threshold?: number;
  speed?: number;
  goc_home?: number;
  goc_gat?: number;
};

const normalizeCode = (value: any) =>
  String(value || "").trim().toUpperCase();

const toNumberInRange = (
  value: any,
  defaultValue: number,
  min: number,
  max: number
) => {
  const num = Number(value);

  if (Number.isNaN(num)) return defaultValue;

  return Math.min(Math.max(num, min), max);
};

export const settings = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeCode(req.params.conveyor_id || req.params.conveyorCode);

    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorView | null>();

    const config = await ConveyorConfig.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorConfigView | null>();

    if (!conveyor || !config) {
      return res.status(404).send("Không tìm thấy băng tải hoặc cấu hình.");
    }

    const cameras = await Camera.find({
      $or: [
        { status: "AVAILABLE" },
        ...(config.camera_id ? [{ camera_id: config.camera_id }] : []),
      ],
    }).lean();

    const usedOperatorIds = await Conveyor.find({
      conveyor_id: { $ne: conveyorId },
      operator_id: { $ne: ""}
      }).distinct("operator_id");
      const operators = await User.find(
        {
          user_id: { $nin: usedOperatorIds },
        },
        {
          _id: 0,
          user_id: 1,
          fullname: 1,
        }
      ).lean();

    return res.render("setting/settings", {
      title: `Cấu hình băng tải`,
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
    });
  } catch (error) {
    console.error("Lỗi render:", error);
    return res.status(500).send("Không thể tải trang cấu hình. ");
  }
};

export const scanPorts = async (req: Request, res: Response) => {
  try {
    const command = publishControlCommand("GET_SERIAL_PORTS", {})
     return res.json({
      success: true,
      command_id: command.command_id,
      message: "Đã gửi yêu cầu scan"
     })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Không thể gửi yêu cầu scan",
    })
  }
}

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const getConveyorId = (req: Request) =>
    normalizeCode(req.params.conveyor_id || req.params.conveyorCode);
    const conveyorId = getConveyorId(req);
    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorId }).lean<ConveyorView | null>();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy băng tải.");
    }

    const oldConfig = await ConveyorConfig.findOne({ conveyor_id: conveyorId })
      .lean<ConveyorConfigView | null>();

    if (!oldConfig) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải.");
    }

    const {
      name,
      /*line_id,*/
      status,
      operator_id,
      description,

      camera_id,
      camera_trigger_delay,
      serial_port,
      baud_rate,
      ai_threshold,
      speed,
      goc_home,
      goc_gat,
    } = req.body;

    const newCameraId = normalizeCode(camera_id);
    const oldCameraId = normalizeCode(oldConfig.camera_id);
    const newSpeed = toNumberInRange(speed, 150, 0, 255);
    const newGocHome = toNumberInRange(goc_home, 0, 0, 180);
    const newGocGat = toNumberInRange(goc_gat, 120, 0, 180);
    const newBaudRate = toNumberInRange(baud_rate, 9600, 1200, 115200);
    const newCameraTriggerDelay = toNumberInRange(camera_trigger_delay, 0, 0, 10000);
    const newAiThreshold = Number(ai_threshold || 30.436506);

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
    if (newCameraId) {
      const newCamera = await Camera.findOne({ camera_id: newCameraId }).lean<any>();

      if (!newCamera) {
        return res.status(400).send("Camera không tồn tại.");
      }

      if (
        newCamera.status === "IN_USE" &&
        normalizeCode(newCamera.conveyor_id) !== conveyorId
      ) {
        return res.status(400).send("Camera này đang được gán cho băng tải khác.");
      }
    }

    const changes: any = {};

    const addChange = (field: string, oldValue: any, newValue: any) => {
      if(String(oldValue ?? "") !== String(newValue ?? "")) {
        changes[field] = {
          old: oldValue ?? "",
          new: newValue ?? ""
        }
      }
    }

    await Conveyor.updateOne(
      { conveyor_id: conveyorId },
      {
        $set: {
          name: String(name || "").trim(),
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
          camera_trigger_delay: newCameraTriggerDelay,
          serial_port: String(serial_port || "").trim(),
          baud_rate: newBaudRate,
          ai_threshold: newAiThreshold,
          speed: newSpeed,
          goc_home: newGocHome,
          goc_gat: newGocGat,
        },
      }
    );

    
    addChange("operator_id", conveyor.operator_id, operator_id);
    addChange("camera_id", oldConfig.camera_id, newCameraId);
    addChange("serial_port", oldConfig.serial_port, serial_port);
    addChange("name", conveyor.name, name);
    addChange("status", conveyor.status, normalizeCode(status || "ONLINE"));
    addChange("description", conveyor.description, description);
    addChange("baud_rate", oldConfig.baud_rate, newBaudRate);
    addChange("speed", oldConfig.speed, newSpeed);
    addChange("goc_home", oldConfig.goc_home, newGocHome);
    addChange("goc_gat", oldConfig.goc_gat, newGocGat);
    addChange("ai_threshold", oldConfig.ai_threshold, newAiThreshold);

    if (Object.keys(changes).length > 0) {
      await Config_log.create({
        config_log_id: `CFG_${Date.now()}`,
        conveyor_id: conveyorId,
        user_id: res.locals.user?.user_id || req.cookies?.user_id || "UNKNOWN",
        action: "UPDATE_CONFIG",
        changes,
        message:  String(description || "").trim() || "Cập nhật cấu hình băng tải",
      });
    }

    return res.redirect(`/settings/${conveyorId}?updated=1`);
  } catch (error) {
    console.error("Update settings không thành công:", error);
    return res.status(500).send("Không thể cập nhật cấu hình.");
  }
};