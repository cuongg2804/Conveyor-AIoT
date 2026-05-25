import { Server } from "socket.io";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

const mapRuntimeStatusToDbStatus = (payload: any) => {
  const running = payload.running === true;
  const rawStatus = String(payload.status || "").toUpperCase();

  if (rawStatus === "STARTING") return "STARTING";
  if (rawStatus === "STOPPING") return "STOPPING";
  if (running || rawStatus === "RUNNING") return "RUNNING";
  if (rawStatus === "ERROR" || rawStatus.includes("LỖI")) return "ERROR";
  if (rawStatus === "READY") return "READY";
  return "STOPPED";
};

export const handleSystemStatusMessage = async (payload: any, io: Server) => {
  try {
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (!conveyorCode) {
      console.warn("System status missing conveyor_code:", payload);
      io.emit("system_status", payload);
      return;
    }

    const dbStatus = mapRuntimeStatusToDbStatus(payload);

    const conveyor = await ConveyorConfig.findOneAndUpdate(
      { conveyor_code: conveyorCode },
      { status: dbStatus },
      { new: true, runValidators: true }
    )
      .select("-_id")
      .lean();

    if (!conveyor) {
      console.warn(`Không tìm thấy conveyor_config: ${conveyorCode}`);
    } else {
      console.log(`Conveyor ${conveyorCode} status updated: ${dbStatus}`);
    }

    io.emit("system_status", {
      ...payload,
      conveyor_code: conveyorCode,
      db_status: dbStatus,
    });
  } catch (error) {
    console.error("handleSystemStatusMessage error:", error);
    io.emit("system_status", payload);
  }
};

export const handleSystemErrorMessage = async (payload: any, io: Server) => {
  try {
    const conveyorCode = normalizeConveyorCode(payload.conveyor_code);

    if (conveyorCode) {
      await ConveyorConfig.updateOne({ conveyor_code: conveyorCode }, { status: "ERROR" });
    }

    io.emit("system_error", payload);
  } catch (error) {
    console.error("handleSystemErrorMessage error:", error);
    io.emit("system_error", payload);
  }
};
