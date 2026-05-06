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

    const isRunning = ["STARTING", "RUNNING"].includes(String((conveyor as any).status || "").toUpperCase());
    const latestInspection = isRunning
      ? await InspectionResult.findOne({ conveyor_code: conveyorCode })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean<InspectionResultView>()
      : null;

    return res.render("dashboard/monitor", {
      title: `Giam sat ${(conveyor as any).name}`,
      conveyor,
      latestInspection,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyorCode}`,
    });
  } catch (error) {
    console.error("Render monitor lỗi:", error);
    return res.status(500).send("Khong the tai trang giam sat.");
  }
};

export const handleInspectionResultMessage = async (payload: any, io: Server) => {
  const jobId = Number(payload.job_id);
  console.log(payload);

  if (!Number.isFinite(jobId)) {
    console.warn("Số job không hợp lệ:", payload);
    return;
  }
};
