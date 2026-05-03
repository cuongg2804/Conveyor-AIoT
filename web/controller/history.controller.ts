import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";

const PAGE_SIZE = 10;

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const dayRange = (dateValue: string) => {
  const date = dateValue || todayInputValue();
  const start = new Date(`${date}T00:00:00`).getTime() / 1000;
  const noon = new Date(`${date}T12:00:00`).getTime() / 1000;
  const end = new Date(`${date}T23:59:59.999`).getTime() / 1000;
  return { date, start, noon, end };
};

const validInspectionFilter = {
  inspection_id: { $exists: true, $ne: "" },
  conveyor_code: { $exists: true, $ne: "" },
  "frames.2": { $exists: true },
};

const summarize = (items: any[]) => {
  const total = items.length;
  const ok = items.filter((item) => item.label === "OK").length;
  const ng = items.filter((item) => item.label === "NG").length;
  const scores = items.map((item) => Number(item.average_score)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;

  return {
    total,
    ok,
    ng,
    okRate: total ? (ok / total) * 100 : 0,
    ngRate: total ? (ng / total) * 100 : 0,
    avgScore,
  };
};

const url = (query: Record<string, string | number>) => `/history?${new URLSearchParams(
  Object.entries(query).filter(([, value]) => String(value) !== "") as [string, string][]
).toString()}`;

const previewItem = (item: any) => ({
  ...item,
  display_id: item.job_id || "-",
  preview_frame: Array.isArray(item.frames) ? item.frames[1] || item.frames[0] : null,
});

export const index = async (req: Request, res: Response) => {
  try {
    const label = String(req.query.label || "");
    const shift = ["morning", "afternoon"].includes(String(req.query.shift)) ? String(req.query.shift) : "all";
    const page = Math.max(Number(req.query.page || 1), 1);
    const { date, start, noon, end } = dayRange(String(req.query.statsDate || ""));

    const dayFilter: any = {
      ...validInspectionFilter,
      timestamp: { $gte: start, $lte: end },
    };

    const listFilter: any = { ...dayFilter, timestamp: { ...dayFilter.timestamp } };
    if (shift === "morning") listFilter.timestamp = { $gte: start, $lt: noon };
    if (shift === "afternoon") listFilter.timestamp = { $gte: noon, $lte: end };
    if (label === "OK" || label === "NG") listFilter.label = label;

    const [dayItems, total, items] = await Promise.all([
      InspectionResult.find(dayFilter, { _id: 0 }).sort({ timestamp: -1 }).lean(),
      InspectionResult.countDocuments(listFilter),
      InspectionResult.find(listFilter, { _id: 0 })
        .sort({ timestamp: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
    ]);

    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const commonQuery = { statsDate: date, label };

    return res.render("history/index", {
      title: "Lich su kiem tra",
      inspectionList: items.map(previewItem),
      filters: { label, statsDate: date, shift },
      shiftLinks: {
        all: url({ ...commonQuery, shift: "all" }),
        morning: url({ ...commonQuery, shift: "morning" }),
        afternoon: url({ ...commonQuery, shift: "afternoon" }),
      },
      dailyStats: {
        date,
        total: summarize(dayItems),
        morning: summarize(dayItems.filter((item: any) => Number(item.timestamp) < noon)),
        afternoon: summarize(dayItems.filter((item: any) => Number(item.timestamp) >= noon)),
      },
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevUrl: url({ ...commonQuery, shift, page: page - 1 }),
        nextUrl: url({ ...commonQuery, shift, page: page + 1 }),
      },
    });
  } catch (error) {
    console.error("History page error:", error);
    return res.status(500).send("Khong the tai lich su kiem tra.");
  }
};

export const detail = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) return res.status(400).send("Ma luot kiem tra khong hop le.");

    const filter: any = { ...validInspectionFilter, job_id: jobId };
    if (req.query.conveyor_code) {
      filter.conveyor_code = String(req.query.conveyor_code).trim().toUpperCase();
    }

    const inspection: any = await InspectionResult.findOne(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) return res.status(404).send("Khong tim thay luot kiem tra.");

    return res.render("history/detail", {
      title: `Chi tiet luot ${jobId}`,
      inspection: {
        ...inspection,
        display_id: inspection.job_id || "-",
        frames: Array.isArray(inspection.frames)
          ? inspection.frames.sort((a: any, b: any) => Number(a.frame_index) - Number(b.frame_index))
          : [],
      },
      backUrl: "/history",
    });
  } catch (error) {
    console.error("History detail error:", error);
    return res.status(500).send("Khong the tai chi tiet luot kiem tra.");
  }
};
