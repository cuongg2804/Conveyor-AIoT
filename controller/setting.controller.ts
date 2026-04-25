// src/controller/setting.controller.ts
import { Request, Response } from "express";
// import Session from "../model/session.model";

export const index = async (req: Request, res: Response) => {
  res.render("setting/general",{
    pageTitle: "Cấu hình chung"
  })
}