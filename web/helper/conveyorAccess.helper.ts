import Conveyor from "../model/conveyor.model";

export const RUNNING_STATUSES = ["STARTING", "RUNNING", "STOPPING"];

export const CONFIG_LOCKED_STATUSES = ["STARTING", "RUNNING", "STOPPING"];

export const isAdmin = (user: any) => {
  return String(user?.role || "").toUpperCase() === "ADMIN";
};

export const canAccessConveyor = async (user: any, conveyorId: string) => {
  if (!user) return false;

  if (isAdmin(user)) return true;

  const conveyor = await Conveyor.findOne({
    conveyor_id: conveyorId,
    is_active: true,
  }).lean<any>();

  if (!conveyor) return false;

  return String(conveyor.user_id || "") === String(user.user_id || "");
};

export const canConfigureByStatus = (status: any) => {
  const normalizedStatus = String(status || "").toUpperCase();
  return !CONFIG_LOCKED_STATUSES.includes(normalizedStatus);
};