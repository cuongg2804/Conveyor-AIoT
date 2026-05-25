import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";
import Conveyor from "../model/conveyor.model";
import Camera from "../model/camera.model";

export const index = async (req: Request, res: Response) => {
  try {
    const conveyors = await Conveyor.find({ is_active: true })
      .lean();
    const conveyorIds = conveyors.map((c: any) => c.conveyor_id);

    const configs = await ConveyorConfig.find({
      conveyor_id: { $in: conveyorIds },
    }).lean();

    const cameras = await Camera.find({
      camera_id: { $in: configs.map((c: any) => c.camera_id).filter(Boolean) },
    }).lean();

    const configMap = new Map(configs.map((c: any) => [c.conveyor_id, c]));
    const cameraMap = new Map(cameras.map((c: any) => [c.camera_id, c]));

    const conveyorList = conveyors.map((conveyor: any) => {
      const config: any = configMap.get(conveyor.conveyor_id) || {};
      const camera: any = cameraMap.get(config.camera_id) || {};

      return {
        ...conveyor,
        ...config,
        camera_name: camera.camera_name || "-",
        camera_ip: camera.camera_ip || "-",
      };
    });
    return res.render("dashboard/dashboard", {
      title: "Tổng quan",
      conveyorList,
      errorMessage: null,
    });
  } catch (error) {
    console.error("Dashboard lỗi:", error);

    return res.status(500).render("dashboard/dashboard.pug", {
      title: "Tổng quan",
      conveyorList: [],
      errorMessage: "Không thể tải danh sách băng tải từ cơ sở dữ liệu.",
    });
  }
};
