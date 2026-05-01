import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

/**
 * Trang monitor theo conveyor_code
 * URL:
 * /inspection/monitor/CONVEYOR-01
 */
export const monitor = async (req: Request, res: Response) => {
  try {
    const conveyorCode = String(
      req.params.conveyorCode || req.params.conveyorId || ""
    )
      .trim()
      .toUpperCase();

    if (!conveyorCode) {
      return res.status(400).send("Thiếu mã băng tải");
    }

    const conveyor = (await ConveyorConfig.findOne({
      conveyor_code: conveyorCode,
    })
      .select("-_id")
      .lean()) as any;

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy băng tải");
    }

    const latestInspection = (await InspectionResult.findOne({
      conveyor_code: conveyorCode,
    })
      .select("-_id")
      .sort({ timestamp: -1 })
      .lean()) as any;

    return res.render("dashboard/monitor", {
      title: `Theo dõi ${conveyor.name}`,
      conveyor,
      latestInspection,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyor.conveyor_code}`,
    });
  } catch (error) {
    console.error("Render monitor error:", error);
    return res.status(500).send("Server error");
  }
};

/**
 * API lấy kết quả mới nhất
 */
export const getLatestResult = async (req: Request, res: Response) => {
  try {
    const conveyorCode = req.query.conveyor_code
      ? String(req.query.conveyor_code).trim().toUpperCase()
      : "";

    const filter: any = {};

    if (conveyorCode) {
      filter.conveyor_code = conveyorCode;
    }

    const data = (await InspectionResult.findOne(filter)
      .select("-_id")
      .sort({ timestamp: -1 })
      .lean()) as any;

    if (!data) {
      return res.status(404).json({
        message: "No inspection result found",
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("getLatestResult error:", error);

    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

/**
 * API lấy kết quả theo job_id
 */
export const getResultByJobId = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);

    if (Number.isNaN(jobId)) {
      return res.status(400).json({
        message: "jobId must be a number",
      });
    }

    const data = (await InspectionResult.findOne({
      job_id: jobId,
    })
      .select("-_id")
      .lean()) as any;

    if (!data) {
      return res.status(404).json({
        message: `job_id=${jobId} not found`,
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("getResultByJobId error:", error);

    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

/**
 * MQTT handler: nhận payload từ Python AI, query MongoDB rồi emit socket ra web
 */
export const handleInspectionResultMessage = async (
  payload: any,
  io: Server
) => {
  try {
    const jobId = Number(payload.job_id);
    const inspectionId = payload.inspection_id
      ? String(payload.inspection_id)
      : "";

    if ((!jobId || Number.isNaN(jobId)) && !inspectionId) {
      console.warn("Invalid MQTT payload, missing job_id/inspection_id:", payload);
      return;
    }

    const filter: any = {};

    if (inspectionId) {
      filter.inspection_id = inspectionId;
    } else {
      filter.job_id = jobId;
    }

    const inspection = (await InspectionResult.findOne(filter)
      .select("-_id")
      .lean()) as any;

    console.log("Found inspection:", inspection);

    if (!inspection) {
      console.warn("Không tìm thấy inspection result:", filter);
      return;
    }

    io.emit("inspection_result", inspection);

    console.log(
      "inspection_result emitted:",
      inspection.inspection_id || inspection.job_id
    );
  } catch (error) {
    console.error("handleInspectionResultMessage error:", error);
  }
};