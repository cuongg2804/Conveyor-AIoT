import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";


export const index = async (req: Request, res: Response) => {
  const conveyorList = 
    {
      id: "CONVEYOR-01",
      name: "Băng tải kiểm tra sản phẩm 01",
      description: "Băng tải chính dùng cho hệ thống phát hiện lỗi bằng AI",
      line_id: "LINE-01",
      station_id: "STATION-AI-01",
      camera_id: "CAM-01",
      statusText: "Sẵn sàng",
      statusClass: "ready",
    };

   res.render("dashboard/dashboard.pug", {
    title: "Dashboard",
    conveyorList : conveyorList,
  });
};

export const getLatestResult = async (req: Request, res: Response) => {
  try {
    const data = await InspectionResult.findOne({}, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!data) {
      return res.status(404).json({ message: "No inspection result found" });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

export const getResultByJobId = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);

    if (Number.isNaN(jobId)) {
      return res.status(400).json({ message: "jobId must be a number" });
    }

    const data = await InspectionResult.findOne(
      { job_id: jobId },
      { _id: 0 }
    ).lean();

    if (!data) {
      return res.status(404).json({ message: `job_id=${jobId} not found` });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

export const handleInspectionResultMessage = async (
  payload: any,
  io: Server
) => {
  try {
    const jobId = payload.job_id;
    if (!jobId) return;

    const inspection = await InspectionResult.findOne(
      { job_id: jobId },
      { _id: 0 }
    ).lean();

    console.log("Found inspection:", inspection);

    if (!inspection) {
      console.warn(`Không tìm thấy inspection result với job_id=${jobId}`);
      return;
    }

    io.emit("inspection_result", inspection);
    console.log("inspection_result emitted:", inspection.job_id);
  } catch (error) {
    console.error("handleInspectionResultMessage error:", error);
  }
};