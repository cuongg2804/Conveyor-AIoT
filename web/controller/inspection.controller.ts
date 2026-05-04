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

<<<<<<< Updated upstream
    const canShowLatestInspection = ["STARTING", "RUNNING"].includes(String(conveyor.status || "").toUpperCase());
    const latestInspection = canShowLatestInspection
=======
    const isRunning = ["STARTING", "RUNNING"].includes(String((conveyor as any).status || "").toUpperCase());
    const latestInspection = isRunning
>>>>>>> Stashed changes
      ? await InspectionResult.findOne({ conveyor_code: conveyorCode })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean<InspectionResultView>()
      : null;

    return res.render("dashboard/monitor", {
<<<<<<< Updated upstream
      title: `Giám sát ${conveyor.name}`,
=======
      title: `Giam sat ${(conveyor as any).name}`,
>>>>>>> Stashed changes
      conveyor,
      latestInspection,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyorCode}`,
    });
  } catch (error) {
<<<<<<< Updated upstream
    console.error("Lỗi khi tải trang giám sát:", error);
    return res.status(500).send("Không thể tải trang giám sát.");
  }
};

export const getLatestResult = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.query.conveyor_code);
    const filter = conveyorCode ? { conveyor_code: conveyorCode } : {};
    // Tìm kiếm kết quả kiểm tra dựa trên conveyor_code nếu có, nếu không có thì lấy kết quả mới nhất bất kể băng tải nào
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
    
    if (!data) { // Nếu không tìm thấy kết quả nào với job_id, trả về 404 Not Found thay vì 200 OK với message lỗi
      return res.status(404).json({ message: `Không tìm thấy lượt kiểm tra ${jobId}.` });
    }

    return res.json(data); 
  } catch (error) {
    console.error("getResultByJobId lỗi:", error);
    return res.status(500).json({ message: "Không thể tải kết quả kiểm tra.", error });
=======
    console.error("Render monitor lỗi:", error);
    return res.status(500).send("Khong the tai trang giam sat.");
>>>>>>> Stashed changes
  }
};

export const handleInspectionResultMessage = async (payload: any, io: Server) => {
<<<<<<< Updated upstream
  try {
    const jobId = Number(payload.job_id);
    const inspectionId = String(payload.inspection_id || "").trim();
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (!jobId || Number.isNaN(jobId)) {
      console.warn("job_id không hợp lệ:", payload);
      return;
    }
// Tìm kiếm kết quả kiểm tra dựa trên inspection_id trước, nếu không có mới tìm theo job_id.
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

    if (!inspection && Array.isArray(payload.frames)) { //
      inspection = payload;
    }

    if (!inspection) {
      console.warn(`Không thể tìm thấy kết quả kiểm tra cho job_id=${jobId}`);
      return;
    }

    io.emit("inspection_result", inspection);
    console.log("inspection_result lỗi:", inspection.job_id);
  } catch (error) {
    console.error("handleInspectionResultMessage lỗi:", error);
=======
  const jobId = Number(payload.job_id);
  console.log(payload);

  if (!Number.isFinite(jobId)) {
    console.warn("Số job không hợp lệ:", payload);
    return;
>>>>>>> Stashed changes
  }
};
