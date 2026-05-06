import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";

const PAGE_SIZE = 10;

// Lay ngay hien tai theo dinh dang yyyy-mm-dd de gan vao input type="date".
const todayInputValue = () => new Date().toISOString().slice(0, 10);

// Tao moc thoi gian bat dau/nghia trua/cuoi ngay.
// Database dang luu timestamp theo giay, nen can chia getTime() cho 1000.
const dayRange = (dateValue: string) => {
  const date = dateValue || todayInputValue();
  const start = new Date(`${date}T00:00:00`).getTime() / 1000;
  const noon = new Date(`${date}T12:00:00`).getTime() / 1000;
  const end = new Date(`${date}T23:59:59.999`).getTime() / 1000;
  return { date, start, noon, end };
};

// Dieu kien de chi lay cac lan kiem tra hop le:
// - co inspection_id
// - co conveyor_code
// - co du 3 frame, vi "frames.2" la frame thu 3 trong mang.
const validInspectionFilter = {
  inspection_id: { $exists: true, $ne: "" },
  conveyor_code: { $exists: true, $ne: "" },
  "frames.2": { $exists: true },
};

// Tinh so luong OK/NG, ti le OK/NG va diem trung binh de hien thi o phan thong ke.
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

// Tao URL cho cac nut chuyen ca va phan trang.
// Gia tri rong se bi bo qua de URL gon hon.
const url = (query: Record<string, string | number>) => `/history?${new URLSearchParams(
  Object.entries(query).filter(([, value]) => String(value) !== "") as [string, string][]
).toString()}`;

// Moi dong trong bang history can them anh preview.
// Uu tien frame thu 2, neu khong co thi lay frame dau tien.
const previewItem = (item: any) => ({
  ...item,
  display_id: item.job_id || "-",
  preview_frame: Array.isArray(item.frames) ? item.frames[1] || item.frames[0] : null,
});

export const index = async (req: Request, res: Response) => {
  try {
    // 1. Lay gia tri nguoi dung chon tren giao dien
    // label: loc ket qua OK/NG. Neu rong thi hien thi tat ca.
    const selectedLabel = String(req.query.label || "");

    // shift: loc ca sang/ca chieu. Neu khong hop le thi mac dinh la "all".
    const selectedShift = ["morning", "afternoon"].includes(String(req.query.shift))
      ? String(req.query.shift)
      : "all";

    // page: trang hien tai cua bang history. Gia tri nho nhat la 1.
    const page = Math.max(Number(req.query.page || 1), 1);

    // selectedDay gom: ngay dang xem, moc bat dau ngay, 12h trua va cuoi ngay.
    const selectedDay = dayRange(String(req.query.statsDate || ""));
// 2. Lay tat ca ket qua trong ngay de tinh thong ke
    // Filter nay khong loc theo ca va khong loc OK/NG,
    // vi phan thong ke phia tren can tinh tong ca ngay.
    const wholeDayFilter: any = {
      inspection_id: validInspectionFilter.inspection_id,
      conveyor_code: validInspectionFilter.conveyor_code,
      "frames.2": validInspectionFilter["frames.2"],
      timestamp: {
        $gte: selectedDay.start,
        $lte: selectedDay.end,
      },
    };

    // Danh sach nay dung cho cac the thong ke: ca ngay, ca sang, ca chieu.
    const allItemsInDay = await InspectionResult.find(wholeDayFilter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    // 3. Tao filter cho bang danh sach ben duoi
    // Ban dau bang danh sach cung lay tat ca ket qua trong ngay.
    const listFilter: any = {
      inspection_id: validInspectionFilter.inspection_id,
      conveyor_code: validInspectionFilter.conveyor_code,
      "frames.2": validInspectionFilter["frames.2"],
      timestamp: {
        $gte: selectedDay.start,
        $lte: selectedDay.end,
      },
    };

    // Neu nguoi dung chon ca sang thi chi lay tu 00:00 den truoc 12:00.
    if (selectedShift === "morning") {
      listFilter.timestamp = {
        $gte: selectedDay.start,
        $lt: selectedDay.noon,
      };
    }

    // Neu nguoi dung chon ca chieu thi chi lay tu 12:00 den het ngay.
    if (selectedShift === "afternoon") {
      listFilter.timestamp = {
        $gte: selectedDay.noon,
        $lte: selectedDay.end,
      };
    }

    // Neu nguoi dung chon OK hoac NG thi loc them theo label.
    if (selectedLabel === "OK" || selectedLabel === "NG") {
      listFilter.label = selectedLabel;
    }

    // 4. Dem tong so ket qua phu hop voi filter danh sach
    // Gia tri nay dung de tinh tong so trang.
    const total = await InspectionResult.countDocuments(listFilter);

    // 5. Lay du lieu cua trang hien tai
    // Vi moi trang hien thi PAGE_SIZE dong, nen can skip cac dong cua trang truoc.
    const skip = (page - 1) * PAGE_SIZE;
    const listItems = await InspectionResult.find(listFilter, { _id: 0 })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean();

    // 6. Tinh thong ke sang/chieu
    // allItemsInDay da co toan bo ket qua trong ngay,
    // nen chi can tach bang timestamp truoc/sau 12:00.
    const morningItems = allItemsInDay.filter((item: any) => Number(item.timestamp) < selectedDay.noon);
    const afternoonItems = allItemsInDay.filter((item: any) => Number(item.timestamp) >= selectedDay.noon);

    // 7. Tao du lieu phan trang va link chuyen ca
    // commonQuery giu lai ngay va label hien tai khi bam chuyen ca hoac chuyen trang.
    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const commonQuery = { statsDate: selectedDay.date, label: selectedLabel };

    // 8. Dua du lieu ra giao dien
    // Cac ten bien o day phai khop voi file view/history/index.pug.
    return res.render("history/index", {
title: "Lich su kiem tra",

      // Danh sach cac lan kiem tra hien thi trong bang.
      inspectionList: listItems.map(previewItem),

      // Gia tri filter hien tai de form giu lai lua chon cua nguoi dung.
      filters: {
        label: selectedLabel,
        statsDate: selectedDay.date,
        shift: selectedShift,
      },

      // Link cho 3 tab: tat ca, ca sang, ca chieu.
      shiftLinks: {
        all: url({ ...commonQuery, shift: "all" }),
        morning: url({ ...commonQuery, shift: "morning" }),
        afternoon: url({ ...commonQuery, shift: "afternoon" }),
      },

      // Du lieu thong ke o cac card phia tren.
      dailyStats: {
        date: selectedDay.date,
        total: summarize(allItemsInDay),
        morning: summarize(morningItems),
        afternoon: summarize(afternoonItems),
      },

      // Du lieu cho nut Truoc/Sau.
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevUrl: url({ ...commonQuery, shift: selectedShift, page: page - 1 }),
        nextUrl: url({ ...commonQuery, shift: selectedShift, page: page + 1 }),
      },
    });
  } catch (error) {
    console.error("History page error:", error);
    return res.status(500).send("Khong the tai lich su kiem tra.");
  }
};

export const detail = async (req: Request, res: Response) => {
  try {
    // Lay jobId tu URL /history/:jobId.
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) return res.status(400).send("Ma luot kiem tra khong hop le.");

    // Tim lan kiem tra theo job_id va chi lay ban ghi hop le.
    const filter: any = { ...validInspectionFilter, job_id: jobId };

    // Neu URL co conveyor_code thi loc them de tranh trung job_id giua cac bang tai.
    if (req.query.conveyor_code) {
      filter.conveyor_code = String(req.query.conveyor_code).trim().toUpperCase();
    }

    // Lay ban ghi moi nhat neu co nhieu ban ghi cung job_id.
    const inspection: any = await InspectionResult.findOne(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) return res.status(404).send("Khong tim thay luot kiem tra.");

    // Sap xep frame theo frame_index truoc khi dua ra trang detail.
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