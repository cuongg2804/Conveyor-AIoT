import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import Conveyor from "../model/conveyor.model";

const normalizeConveyorCode = (value: any) =>
  String(value || "").trim().toUpperCase();

const normalizeFrame = (frame: any) => {
  return {
    frame_index: Number(frame.frame_index || 0),
    predicted_label: String(frame.predicted_label || frame.pred_label || "UNKNOWN"),
    predicted_score: Number(frame.predicted_score || frame.pred_score || 0),

    roi_path: frame.roi_path || "",
    mask_path: frame.mask_path || "",
    overlay_path: frame.overlay_path || "",

    // MinIO object key mới
    // roi_object_key: frame.roi_object_key || "",
    // mask_object_key: frame.mask_object_key || "",
    // overlay_object_key: frame.overlay_object_key || "",

    // bucket: frame.bucket || "",
    // storage_type: frame.storage_type || (frame.roi_object_key || frame.overlay_object_key ? "minio" : "local"),
  };
};

export const monitor = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.params.conveyorCode);

    if (!conveyorCode) {
      return res.status(400).send("Thiếu mã băng tải.");
    }

    const conveyor = await Conveyor.findOne({ conveyor_id: conveyorCode })
      .select("-_id")
      .lean();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy băng tải.");
    }

    const isRunning = ["STARTING", "RUNNING"].includes(
      String((conveyor as any).status || "").toUpperCase()
    );

    const latestInspection: any = isRunning
      ? await InspectionResult.findOne({ conveyor_id: conveyorCode })
          .select("-_id")
          .sort({ timestamp: -1 })
          .lean()
      : null;

    const latestInspectionView =
      latestInspection && Array.isArray(latestInspection.frames)
        ? {
            ...latestInspection,
            frames: latestInspection.frames,
          }
        : latestInspection;

    return res.render("dashboard/monitor", {
      title: `Giám sát ${(conveyor as any).name}`,
      conveyor,
      latestInspection: latestInspectionView,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyorCode}`,
    });
  } catch (error) {
    console.error("Render monitor lỗi:", error);
    return res.status(500).send("Không thể tải trang giám sát.");
  }
};

export const handleInspectionResultMessage = async (payload: any, io: Server) => {
  try {
    const inspectionId = String(payload.inspection_id || "").trim();

    const conveyorId = normalizeConveyorCode(
      payload.conveyor_id || payload.conveyor_code
    );

    const stt = Number(payload.stt || payload.inspection_no || payload.job_id);

    if (!inspectionId) {
      console.warn("Thiếu inspection_id trong MQTT payload:", payload);
      return;
    }

    if (!conveyorId) {
      console.warn("Thiếu conveyor_id/conveyor_code trong MQTT payload:", payload);
      return;
    }

    if (!Number.isFinite(stt)) {
      console.warn("Số thứ tự kiểm tra không hợp lệ:", payload);
      return;
    }

    const frames = Array.isArray(payload.frames)
      ? payload.frames.map(normalizeFrame)
      : [];

    const document = {
      inspection_id: inspectionId,
      stt,
      conveyor_id: conveyorId,
      timestamp: Number(payload.timestamp || Date.now() / 1000),
      label: String(payload.label || "UNKNOWN").toUpperCase(),
      average_score: Number(payload.average_score || payload.avg_score || 0),
      threshold: Number(payload.threshold || 0),
      frames,
    };

    await InspectionResult.updateOne(
      { inspection_id: inspectionId },
      { $set: document },
      { upsert: true }
    );

    const framesForView = frames;

    io.emit("inspection_result", {
      ...document,
      frames: framesForView,
    });

    console.log(`[MQTT] Saved inspection_result: ${inspectionId}`);
  } catch (error) {
    console.error("Handle inspection result error:", error);
  }
};