import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

const toNumber = (value: any, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const settings = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.params.conveyorCode);

    const conveyor = await ConveyorConfig.findOne({ conveyor_code: conveyorCode })
      .select("-_id")
      .lean();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải");
    }

    return res.render("setting/settings", {
      title: `Thiết lập ${conveyor.name}`,
      conveyor,
      updated: req.query.updated === "1",
      monitorUrl: `/inspection/monitor/${conveyor.conveyor_code}`,
      dashboardUrl: "/dashboard",
    });
  } catch (error) {
    console.error("Render settings error:", error);
    return res.status(500).send("Server error");
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const conveyorCode = normalizeConveyorCode(req.params.conveyorCode);

    const updateData = {
      name: String(req.body.name || "").trim(),
      description: String(req.body.description || "").trim(),
      camera_source: String(req.body.camera_source || "").trim(),
      camera_trigger_delay: toNumber(req.body.camera_trigger_delay, 0),
      serial_port: String(req.body.serial_port || "").trim(),
      baud_rate: toNumber(req.body.baud_rate, 9600),
      ai_threshold: toNumber(req.body.ai_threshold, 30.436506),
      is_active: req.body.is_active === "on",
    };

    if (!updateData.name) return res.status(400).send("Tên băng tải không được để trống");
    if (!updateData.camera_source) return res.status(400).send("Camera source không được để trống");
    if (!updateData.serial_port) return res.status(400).send("Serial port không được để trống");

    const conveyor = await ConveyorConfig.findOneAndUpdate(
      { conveyor_code: conveyorCode },
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải");
    }

    return res.redirect(`/settings/${conveyorCode}?updated=1`);
  } catch (error) {
    console.error("Update settings error:", error);
    return res.status(500).send("Server error");
  }
};
