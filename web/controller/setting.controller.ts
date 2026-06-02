import { Request, Response } from "express";
import Conveyor from "../model/conveyor.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Camera from "../model/camera.model";
import User from "../model/user.model";
import Config_log from "../model/config_logs.model";
import { publishControlCommand } from "../service/mqtt.service";
import mongoose from "mongoose";
import ModelRegistry from "../model/modelRegister.model";
type ConveyorView = {
  conveyor_id: string;
  name: string;
  line_id?: string;
  status?: string;
  user_id?: string;
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
  model_id?: string;
  config_mode?: "PRODUCTION" | "TEST";
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

    const selectedTab =
      String(req.query.tab || "production").toLowerCase() === "test"
        ? "test"
        : "production";
    const selectedConfigMode = selectedTab === "test" ? "TEST" : "PRODUCTION";

    const usedOperatorIds = await Conveyor.find({
      conveyor_id: { $ne: conveyorId },
      user_id: { $ne: ""}
      }).distinct("user_id");
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

    const activeModels = await ModelRegistry.find({ status: "active" })
      .sort({ created_at: -1 })
      .lean();

    const testingModels = await ModelRegistry.find({ status: "testing" })
      .sort({ created_at: -1 })
      .lean();
    const selectedModel = config.model_id
      ? await ModelRegistry.findOne({ model_id: config.model_id }).lean()
      : null;
    const isTestingModelLocked =
      selectedTab === "test" &&
      config.config_mode === "TEST" &&
      !!config.model_id &&
      selectedModel?.status === "testing";

    return res.render("setting/settings", {
      title: `Cấu hình băng tải`,
      conveyor,
      config,
      cameras,
      operators,

      selectedTab,
      activeModels,
      testingModels,
      selectedConfigMode,
      selectedModel,
      isTestingModelLocked,

      updated: req.query.updated === "1",
      configSynced: req.query.synced === "1",
      configSyncFailed: req.query.synced === "0",
      started: req.query.started === "1",
      stopped: req.query.stopped === "1",
      approved: req.query.approved === "1",
      rejected: req.query.rejected === "1",

      monitorUrl: `/inspection/monitor/${conveyor.conveyor_id}`,
      dashboardUrl: "/dashboard",
      formAction: `/settings/${conveyor.conveyor_id}?tab=${selectedTab}`
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

    const selectedTab =
      String(req.query.tab || req.body.tab || "production").toLowerCase() === "test"
        ? "test"
        : "production";

    const selectedModelId = String(req.body.model_id || "").trim();

    console.log("[SETTINGS] Submit model:", {
      selectedTab,
      selectedModelId,
      bodyModelId: req.body.model_id,
    });

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
      status,
      user_id,
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

    let nextModelId = String(oldConfig.model_id || "").trim();
    let nextConfigMode = String(oldConfig.config_mode || "PRODUCTION").toUpperCase();

    const currentModel = oldConfig.model_id
      ? await ModelRegistry.findOne({ model_id: oldConfig.model_id }).lean()
      : null;

    const isTestingModelLocked =
      selectedTab === "test" &&
      oldConfig.config_mode === "TEST" &&
      !!oldConfig.model_id &&
      currentModel?.status === "testing";

    if (selectedTab === "production") {
      if (!selectedModelId) {
        return res.status(400).send("Vui lòng chọn model đã phê duyệt.");
      }

      const activeModel = await ModelRegistry.findOne({
        model_id: selectedModelId,
        status: "active",
      }).lean();

      if (!activeModel) {
        return res
          .status(400)
          .send("Model vận hành không tồn tại hoặc chưa được phê duyệt.");
      }

      nextModelId = activeModel.model_id;
      nextConfigMode = "PRODUCTION";
    }

    if (selectedTab === "test") {
      if (isTestingModelLocked) {
        nextModelId = String(oldConfig.model_id || "");
        nextConfigMode = "TEST";
      } else {
        if (!selectedModelId) {
          return res.status(400).send("Vui lòng chọn model cần kiểm thử.");
        }

        const testingModel = await ModelRegistry.findOne({
          model_id: selectedModelId,
          status: "testing",
        }).lean();

        if (!testingModel) {
          return res
            .status(400)
            .send("Model kiểm thử không tồn tại hoặc không ở trạng thái testing.");
        }

        nextModelId = testingModel.model_id;
        nextConfigMode = "TEST";
      }
    }

    if (oldCameraId && oldCameraId !== newCameraId) {
      await Camera.updateOne(
        { camera_id: oldCameraId },
        {
          $set: {
            status: "AVAILABLE",
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
    if (newCameraId) {
      await Camera.updateOne(
        { camera_id: newCameraId },
        {
          $set: {
            status: "IN_USE",
          },
        }
      );
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
          user_id: String(user_id || "").trim(),
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
          model_id: nextModelId,
          config_mode: nextConfigMode,
        },
      }
    );

    
    addChange("user_id", conveyor.user_id, user_id);
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
    addChange("model_id", oldConfig.model_id, nextModelId);
    addChange("config_mode", oldConfig.config_mode, nextConfigMode);

    

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

    let synced = "1";

    try {
      publishControlCommand("RELOAD_CONFIG", {
        conveyor_id: conveyorId,
      });
    } catch (mqttError) {
      synced = "0";
      console.error("[MQTT] RELOAD_CONFIG lỗi:", mqttError);
    }

    return res.redirect(`/settings/${conveyorId}?tab=${selectedTab}&updated=1&synced=${synced}`);
  } catch (error) {
    console.error("Update settings không thành công:", error);
    return res.status(500).send("Không thể cập nhật cấu hình.");
  }
};


export const approveModel = async (req: Request, res: Response) => {
  try {
    const conveyorId = normalizeCode(
      req.params.conveyor_id || req.params.conveyorCode
    );

    const decision = String(req.body.decision || "").toUpperCase();

    if (!["PASS", "FAIL"].includes(decision)) {
      return res.status(400).send("Lựa chọn phê duyệt không hợp lệ.");
    }

    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorId }).lean<any>();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy băng tải.");
    }

    if (String(conveyor.status || "").toUpperCase() === "RUNNING") {
      return res
        .status(400)
        .send("Chỉ được phê duyệt model sau khi đã dừng kiểm thử.");
    }

    const config = await ConveyorConfig.findOne({ conveyor_id: conveyorId }).lean<any>();

    if (!config || !config.model_id || config.config_mode !== "TEST") {
      return res.status(400).send("Không có model kiểm thử đang chờ phê duyệt.");
    }

    const model = await ModelRegistry.findOne({
      model_id: config.model_id,
      status: "testing",
    }).lean();

    if (!model) {
      return res
        .status(400)
        .send("Model kiểm thử không tồn tại hoặc đã được xử lý.");
    }

    if (decision === "PASS") {
      await ModelRegistry.updateOne(
        { model_id: config.model_id },
        {
          $set: {
            status: "active",
          },
        }
      );

      await ConveyorConfig.updateOne(
        { conveyor_id: conveyorId },
        {
          $set: {
            config_mode: "PRODUCTION",
            ai_threshold: model.threshold,
          },
        }
      );

      return res.redirect(`/settings/${conveyorId}?tab=test&approved=1`);
    }

    await ModelRegistry.updateOne(
      { model_id: config.model_id },
      {
        $set: {
          status: "failed",
        },
      }
    );

    await ConveyorConfig.updateOne(
      { conveyor_id: conveyorId },
      {
        $set: {
          model_id: "",
          config_mode: "TEST",
        },
      }
    );

    return res.redirect(`/settings/${conveyorId}?tab=test&rejected=1`);
  } catch (error) {
    console.error("Approve model error:", error);
    return res.status(500).send("Không thể phê duyệt model.");
  }
};