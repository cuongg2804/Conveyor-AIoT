import { Request, Response } from "express";
import ConveyorConfig from "../model/conveyorConfigSchema.model";

export const index = async (req: Request, res: Response) => {
  try {
    const conveyorList = await ConveyorConfig.find({ is_active: true })
      .select("-_id")
      .sort({ conveyor_code: 1 })
      .lean();

    return res.render("dashboard/dashboard.pug", {
      title: "Tổng quan",
      conveyorList,
    });
  } catch (error) {
    console.error("Dashboard index error:", error);

    return res.status(500).render("dashboard/dashboard.pug", {
      title: "Tổng quan",
      conveyorList: [],
      errorMessage: "Không thể tải danh sách băng tải từ cơ sở dữ liệu.",
    });
  }
};
