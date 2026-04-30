import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";

export const index = async (req: Request, res: Response) => {
  try {
    const label = String(req.query.label || "").trim();
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (label === "OK" || label === "NG") {
      filter.label = label;
    }

    if (fromDate || toDate) {
      filter.timestamp = {};

      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`);
        filter.timestamp.$gte = from.getTime() / 1000;
      }

      if (toDate) {
        const to = new Date(`${toDate}T23:59:59`);
        filter.timestamp.$lte = to.getTime() / 1000;
      }
    }

    const total = await InspectionResult.countDocuments(filter);

    const inspectionList = await InspectionResult.find(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const normalizedList = inspectionList.map((item: any) => {
      const frames = Array.isArray(item.frames) ? item.frames : [];
      const previewFrame = frames[1] || frames[0] || null;

      return {
        ...item,
        display_id: item.inspection_id || item.job_id || "-",
        preview_frame: previewFrame,
      };
    });

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.render("history/index", {
      title: "Lịch sử kiểm tra",
      inspectionList: normalizedList,
      filters: {
        label,
        fromDate,
        toDate,
      },
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: page - 1,
        nextPage: page + 1,
      },
    });
  } catch (error) {
    console.error("History page error:", error);
    return res.status(500).send("Server error");
  }
};