import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import Conveyor from "../model/conveyor.model";
import { withPublicFrameImageUrls, withPublicInspectionImageUrls } from "../helper/image-url";
import { canAccessConveyor } from "../helper/conveyorAccess.helper";

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

    const currentUser = res.locals.user
    const allow = await canAccessConveyor(currentUser, conveyorCode);
    if(!allow) {
      return res.status(403).send("Bạn không có quyền truy cập băng tải này.");
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
    const rawMode = String(req.query.mode || req.query.run_mode || "PRODUCTION")
      .trim()
      .toUpperCase();

    const mode = rawMode === "TEST" ? "TEST" : "PRODUCTION";

    const latestInspection: any = isRunning
      ? await InspectionResult.findOne({
          conveyor_id: conveyorCode,
          mode,
        })
          .select("-_id")
          .sort({ timestamp: -1 })
          .lean()
      : null;

    const latestInspectionView =
      latestInspection && Array.isArray(latestInspection.frames)
        ? withPublicInspectionImageUrls(latestInspection)
        : latestInspection;

    

    return res.render("dashboard/monitor", {
      title: `Giám sát ${(conveyor as any).name}`,
      conveyor,
      latestInspection: latestInspectionView,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyorCode}`,
      mode,
//      currentTab: mode === "TEST" ? "test" : "production",
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

    const stt = Number(payload.stt || payload.inspection_no);

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

    const rawMode = String(payload.mode || payload.run_mode || "PRODUCTION")
      .trim()
      .toUpperCase();

    const mode = rawMode === "TEST" ? "TEST" : "PRODUCTION";

    const frames = Array.isArray(payload.frames)
      ? payload.frames.map(normalizeFrame)
      : [];

    const frameScores = frames
      .map((frame: any) => Number(frame.predicted_score))
      .filter((score: number) => Number.isFinite(score));

    const avgScore =
      frameScores.length > 0
        ? frameScores.reduce((sum: number, score: number) => sum + score, 0) /
          frameScores.length
        : null;

    const document = {
      inspection_id: inspectionId,
      stt,
      conveyor_id: conveyorId,
      timestamp: Number(payload.timestamp || Date.now() / 1000),
      label: String(payload.label || "UNKNOWN").toUpperCase(),
      avg_score: avgScore,
      threshold: Number(payload.threshold || 0),
      frames,
      mode,
    };

    await InspectionResult.updateOne(
      { inspection_id: inspectionId },
      { $set: document },
      { upsert: true }
    );

    const framesForView = frames.map(withPublicFrameImageUrls);

    io.emit("inspection_result", {
      ...document,
      frames: framesForView,
    });

    console.log(`[MQTT] Đã lưu kết quả kiểm tra: ${inspectionId}, mode=${mode}`);
  } catch (error) {
    console.error("Lỗi:", error);
  }
};
