import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Camera from "../model/camera.model";
import User from "../model/user.model";

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
  mode?: string;
  conveyor_speed?: number;
  goc_home?: number;
  goc_gat?: number;
};

const normalizeCode = (value: any) =>
  String(value || "").trim().toUpperCase();

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
      operator_id: { $ne: "" },
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
    return res.status(500).send("Không thể tải trang cấu hình.");
  }
};

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
      line_id,
      status,
      operator_id,
      description,

      camera_id,
      camera_trigger_delay,
      serial_port,
      baud_rate,
      ai_threshold,
      mode,
      speed,
      goc_home,
      goc_gat,
    } = req.body;

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
          camera_trigger_delay: Number(camera_trigger_delay || 0),
          serial_port: String(serial_port || "").trim(),
          baud_rate: Number(baud_rate || 9600),
          ai_threshold: Number(ai_threshold || 30.436506),
          mode: normalizeCode(mode || "AUTO"),
          speed: Number(speed || 150),
          goc_home: Number(goc_home || 0),
          goc_gat: Number(goc_gat || 120)
        },
      }
    );

    return res.redirect(`/settings/${conveyorId}?updated=1`);
  } catch (error) {
    console.error("Update settings không thành công:", error);
    return res.status(500).send("Không thể cập nhật cấu hình.");
  }
};