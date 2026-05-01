import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

type ConveyorConfigView = {
  conveyor_code: string;
  name: string;
  status?: string;
};

type InspectionResultView = {
  job_id: number;
  [key: string]: any;
};

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

export const monitor = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.params.conveyorCode);

    if (!conveyorCode) {
      return res.status(400).send("Thiếu mã băng tải.");
    }

    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode })
      .select("-_id")
      .lean<ConveyorConfigView>();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy băng tải.");
    }

    const canShowLatestInspection = ["STARTING", "RUNNING"].includes(String(conveyor.status || "").toUpperCase());
    const latestInspection = canShowLatestInspection
      ? await InspectionResult.findOne({ conveyor_code: conveyorCode })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean<InspectionResultView>()
      : null;

    return res.render("dashboard/monitor", {
      title: `Giám sát ${conveyor.name}`,
      conveyor,
      latestInspection,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyor.conveyor_code}`,
    });
  } catch (error) {
    console.error("Render monitor error:", error);
    return res.status(500).send("Không thể tải trang giám sát.");
  }
};

export const getLatestResult = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.query.conveyor_code);
    const filter = conveyorCode ? { conveyor_code: conveyorCode } : {};

    const data = await InspectionResult.findOne(filter)
      .select("-_id")
      .sort({ timestamp: -1 })
      .lean();

    if (!data) {
      return res.status(404).json({ message: "Chưa có kết quả kiểm tra." });
    }

    return res.json(data);
  } catch (error) {
    console.error("getLatestResult error:", error);
    return res.status(500).json({ message: "Không thể tải kết quả kiểm tra.", error });
  }
};

export const getResultByJobId = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);

    if (Number.isNaN(jobId)) {
      return res.status(400).json({ message: "Mã lượt kiểm tra không hợp lệ." });
    }

    const data = await InspectionResult.findOne({ job_id: jobId })
      .select("-_id")
      .sort({ timestamp: -1 })
      .lean();

    if (!data) {
      return res.status(404).json({ message: `Không tìm thấy lượt kiểm tra ${jobId}.` });
    }

    return res.json(data);
  } catch (error) {
    console.error("getResultByJobId error:", error);
    return res.status(500).json({ message: "Không thể tải kết quả kiểm tra.", error });
  }
};

export const handleInspectionResultMessage = async (payload: any, io: Server) => {
  try {
    const jobId = Number(payload.job_id);
    const inspectionId = String(payload.inspection_id || "").trim();
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (!jobId || Number.isNaN(jobId)) {
      console.warn("Invalid inspection payload, missing job_id:", payload);
      return;
    }

    const filter: any = inspectionId ? { inspection_id: inspectionId } : { job_id: jobId };
    if (conveyorCode) filter.conveyor_code = conveyorCode;

    let inspection = await InspectionResult.findOne(filter)
      .select("-_id")
      .sort({ timestamp: -1 })
      .lean<InspectionResultView>();

    if (!inspection && inspectionId) {
      inspection = await InspectionResult.findOne({ inspection_id: inspectionId })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean<InspectionResultView>();
    }

    if (!inspection && !inspectionId) {
      inspection = await InspectionResult.findOne({ job_id: jobId })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean<InspectionResultView>();
    }

    if (!inspection && Array.isArray(payload.frames)) {
      inspection = payload;
    }

    if (!inspection) {
      console.warn(`Inspection result not found for job_id=${jobId}`);
      return;
    }

    io.emit("inspection_result", inspection);
    console.log("inspection_result emitted:", inspection.job_id);
  } catch (error) {
    console.error("handleInspectionResultMessage error:", error);
  }
};
