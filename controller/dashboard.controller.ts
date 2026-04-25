// src/controller/dashboard.controller.ts
import { Request, Response } from "express";
import Session from "../model/inspection-result.model";

export const index = async (req: Request, res: Response) => {
  const conveyorList = [
    {
      id: "1",
      name: "Băng tải kiểm tra sản phẩm 01",
      description: "Băng tải chính dùng cho hệ thống phát hiện lỗi bằng AI",
      line_id: "LINE-01",
      station_id: "STATION-AI-01",
      camera_id: "CAM-01",
      statusText: "Sẵn sàng",
      statusClass: "ready",
    }];

   res.render("dashboard/dashboard.pug", {
    title: "Dashboard",
    conveyorList : conveyorList,
  });
};