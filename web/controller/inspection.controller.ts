import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

export const monitor = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.params.conveyorCode);
    if (!conveyorCode) return res.status(400).send("Thieu ma bang tai.");

    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode })
      .select("-_id")
      .lean();

    if (!conveyor) return res.status(404).send("Khong tim thay bang tai.");

    const isRunning = ["STARTING", "RUNNING"].includes(String(conveyor.status || "").toUpperCase());
    const latestInspection = isRunning
      ? await InspectionResult.findOne({ conveyor_code: conveyorCode })
        .select("-_id")
        .sort({ timestamp: -1 })
        .lean()
      : null;

    return res.render("dashboard/monitor", {
      title: `Giam sat ${conveyor.name}`,
      conveyor,
      latestInspection,
      dashboardUrl: "/dashboard",
      settingsUrl: `/settings/${conveyor.conveyor_code}`,
    });
  } catch (error) {
    console.error("Render monitor error:", error);
    return res.status(500).send("Khong the tai trang giam sat.");
  }
};

export const handleInspectionResultMessage = async (payload: any, io: Server) => {
  const jobId = Number(payload.job_id);

  if (!Number.isFinite(jobId)) {
    console.warn("Invalid inspection payload:", payload);
    return;
  }

  io.emit("inspection_result", {
    ...payload,
    job_id: jobId,
    conveyor_code: normalizeConveyorCode(payload.conveyor_code),
  });
};
