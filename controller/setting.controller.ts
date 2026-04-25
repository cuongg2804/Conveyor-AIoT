import { Request, Response } from "express";
import { Server } from "socket.io";
import InspectionResult from "../model/inspection-result.model";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
export const settings = async (req: Request, res: Response) => {
  try {
    const conveyorCode = String(req.params.conveyorCode || "").toUpperCase();
    console.log("Render settings for conveyorCode:", conveyorCode);
    const conveyor = await ConveyorConfig.findOne({
      conveyor_code: conveyorCode,
    }).lean();

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
    console.error("Render conveyor settings error:", error);
    return res.status(500).send("Server error");
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const conveyorCode = String(req.params.conveyorCode || "").toUpperCase();

    const {
      name,
      description,
      camera_source,
      camera_trigger_delay,
      serial_port,
      baud_rate,
      ai_threshold,
      is_active,
    } = req.body;

    const updateData = {
      name: String(name || "").trim(),
      description: String(description || "").trim(),
      camera_source: String(camera_source || "").trim(),
      camera_trigger_delay: Number(camera_trigger_delay || 0),
      serial_port: String(serial_port || "").trim(),
      baud_rate: Number(baud_rate || 9600),
      ai_threshold: Number(ai_threshold || 30.436506),
      is_active: is_active === "on",
    };

    if (!updateData.name) {
      return res.status(400).send("Tên băng tải không được để trống");
    }

    if (!updateData.camera_source) {
      return res.status(400).send("Camera source không được để trống");
    }

    if (!updateData.serial_port) {
      return res.status(400).send("Serial port không được để trống");
    }

    const conveyor = await ConveyorConfig.findOneAndUpdate(
      { conveyor_code: conveyorCode },
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).lean();

    if (!conveyor) {
      return res.status(404).send("Không tìm thấy cấu hình băng tải");
    }

    return res.redirect(`/settings/${conveyorCode}?updated=1`);
  } catch (error) {
    console.error("Update conveyor settings error:", error);
    return res.status(500).send("Server error");
  }
};