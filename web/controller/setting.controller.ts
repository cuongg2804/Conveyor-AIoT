import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import { publishControlCommand } from "../service/mqtt.service";

type ConveyorConfigView = {
  conveyor_code: string;
  name: string;
};

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
      .lean<ConveyorConfigView>();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải.");
    }

    return res.render("setting/settings", {
      title: `Cấu hình ${conveyor.name}`,
      conveyor,
      updated: req.query.updated === "1",
      configSynced: req.query.synced === "1",
      configSyncFailed: req.query.synced === "0",
      monitorUrl: `/inspection/monitor/${conveyor.conveyor_code}`,
      dashboardUrl: "/dashboard",
    });
  } catch (error) {
    console.error("Render settings error:", error);
    return res.status(500).send("Không thể tải trang cấu hình.");
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
      ai_threshold: toNumber(req.body.ai_threshold, 30.436506), // Giá trị mặc định nếu không có input hợp lệ
      is_active: req.body.is_active === "on", // Checkbox trả về "on" nếu được chọn, ngược lại là undefined
    };

    if (!updateData.name) return res.status(400).send("Tên băng tải không được để trống.");
    if (!updateData.camera_source) return res.status(400).send("Nguồn camera không được để trống.");
    if (!updateData.serial_port) return res.status(400).send("Cổng kết nối không được để trống.");

    const conveyor = await ConveyorConfig.findOneAndUpdate(
      { conveyor_code: conveyorCode },
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải.");
    }

    let synced = "1";
    try {
      publishControlCommand("RELOAD_CONFIG", {
        conveyor_code: conveyorCode,
      });
    } catch (syncError) {
      synced = "0";
<<<<<<< Updated upstream
      console.error("Không thể đồng bộ cấu hình:", syncError);
=======
      console.error("Publish reload config command lỗi:", syncError);
>>>>>>> Stashed changes
    }

    return res.redirect(`/settings/${conveyorCode}?updated=1&synced=${synced}`);
  } catch (error) {
<<<<<<< Updated upstream
    console.error("Cập nhật cấu hình lỗi:", error);
=======
    console.error("Update settings lỗi:", error);
>>>>>>> Stashed changes
    return res.status(500).send("Không thể cập nhật cấu hình.");
  }
};
