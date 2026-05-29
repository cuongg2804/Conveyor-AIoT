import fs from "fs";
import path from "path";

const PDFDocument = require("pdfkit");
import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";
import Conveyor from "../model/conveyor.model";

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

const currentMonthValue = () => new Date().toISOString().slice(0, 7);

const currentYearValue = () => String(new Date().getFullYear());

const monthRange = (monthValue: string) => {
  const value = monthValue || currentMonthValue();
  const [year, month] = value.split("-").map(Number);

  const start = new Date(year, month - 1, 1, 0, 0, 0).getTime() / 1000;
  const end = new Date(year, month, 0, 23, 59, 59, 999).getTime() / 1000;

  return {
    value,
    start,
    end,
  };
};

const yearRange = (yearValue: string) => {
  const value = yearValue || currentYearValue();
  const year = Number(value);

  const start = new Date(year, 0, 1, 0, 0, 0).getTime() / 1000;
  const end = new Date(year, 11, 31, 23, 59, 59, 999).getTime() / 1000;

  return {
    value,
    start,
    end,
  };
};

const MIN_STATS_YEAR = 2024;

const isValidDateValue = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const selectedDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(selectedDate.getTime())) return false;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (
    selectedDate.getFullYear() >= MIN_STATS_YEAR &&
    selectedDate.getTime() <= today.getTime()
  );
};

const isValidMonthValue = (value: string) => {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;

  const [year, month] = value.split("-").map(Number);
  if (year < MIN_STATS_YEAR) return false;
  if (month < 1 || month > 12) return false;

  const selectedMonth = new Date(year, month - 1, 1);
  const currentMonth = new Date();
  currentMonth.setDate(1);
  currentMonth.setHours(0, 0, 0, 0);

  return selectedMonth.getTime() <= currentMonth.getTime();
};

const isValidYearValue = (value: string) => {
  if (!/^\d{4}$/.test(value)) return false;

  const year = Number(value);
  const currentYear = new Date().getFullYear();

  return year >= MIN_STATS_YEAR && year <= currentYear;
};

const getStatsRange = (
  mode: string,
  statsDate: string,
  statsMonth: string,
  statsYear: string
) => {
  if (mode === "month") {
    return monthRange(statsMonth);
  }

  if (mode === "year") {
    return yearRange(statsYear);
  }

  return dayRange(statsDate);
};

// Dieu kien de chi lay cac lan kiem tra hop le:
// - co inspection_id
// - co conveyor_id
// - co du 3 frame, vi "frames.2" la frame thu 3 trong mang.
const validInspectionFilter = {
  inspection_id: { $exists: true, $ne: "" },
  conveyor_id: { $exists: true, $ne: "" },
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
const previewItem = async (item: any) => {
  const previewFrame = Array.isArray(item.frames)
    ? item.frames[1] || item.frames[0]
    : null;

  return {
    ...item,
    display_id: item.stt || "-",
    preview_frame: previewFrame
  };
};

const FONT_REGULAR = "C:/Windows/Fonts/arial.ttf";
const FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf";

const formatDateTime = (timestamp: any) => {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "-";

  const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
  return date.toLocaleString("vi-VN");
};

const formatScore = (value: any, digits = 3) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "-";
};

const safeText = (value: any) => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

const getStorageRoot = () => {
  if (process.env.STORAGE_PATH) {
    return path.resolve(process.env.STORAGE_PATH);
  }

  return path.join(process.cwd(), "storage");
};

const imageUrlToLocalPath = (imageUrl: string) => {
  if (!imageUrl) return null;

  const cleanUrl = String(imageUrl).split("?")[0];

  if (!cleanUrl.startsWith("/images/")) {
    return null;
  }

  const relativePath = cleanUrl.replace("/images/", "");
  return path.join(getStorageRoot(), relativePath);
};

const setupPdfResponse = (res: Response, filename: string) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename)}"`
  );
};

const setupDocFonts = (doc: any) => {
  if (fs.existsSync(FONT_REGULAR)) {
    doc.registerFont("regular", FONT_REGULAR);
    doc.font("regular");
  }

  if (fs.existsSync(FONT_BOLD)) {
    doc.registerFont("bold", FONT_BOLD);
  }
};

const drawTitle = (doc: any, title: string, subtitle?: string) => {
  doc.font("bold").fontSize(18).text(title, { align: "center" });
  doc.moveDown(0.4);

  if (subtitle) {
    doc.font("regular").fontSize(10).text(subtitle, { align: "center" });
    doc.moveDown(1);
  }
};

const drawKeyValue = (doc: any, label: string, value: any) => {
  doc.font("bold").fontSize(10).text(`${label}: `, { continued: true });
  doc.font("regular").text(safeText(value));
};

const buildHistoryExportFilter = async (query: any) => {
  const clearFilter = query.clear === "1";

  if (clearFilter) {
    return {
      filter: { ...validInspectionFilter },
      filterText: "Tất cả dữ liệu hợp lệ",
    };
  }

  const selectedMode = ["day", "month", "year"].includes(String(query.mode))
    ? String(query.mode)
    : "day";

  const selectedLabel = String(query.label || "");
  const selectedShift = ["morning", "afternoon"].includes(String(query.shift))
    ? String(query.shift)
    : "all";

  const selectedDateValue = String(query.statsDate || todayInputValue());
  const selectedMonthValue = String(query.statsMonth || currentMonthValue());
  const selectedYearValue = String(query.statsYear || currentYearValue());
  const selectedConveyorId = String(query.conveyor_id || "").trim().toUpperCase();

  if (selectedMode === "day" && !isValidDateValue(selectedDateValue)) {
    throw new Error("Ngày thống kê không hợp lệ.");
  }

  if (selectedMode === "month" && !isValidMonthValue(selectedMonthValue)) {
    throw new Error("Tháng thống kê không hợp lệ.");
  }

  if (selectedMode === "year" && !isValidYearValue(selectedYearValue)) {
    throw new Error("Năm thống kê không hợp lệ.");
  }

  const selectedRange = getStatsRange(
    selectedMode,
    selectedDateValue,
    selectedMonthValue,
    selectedYearValue
  );

  const selectedDay = dayRange(selectedDateValue || todayInputValue());

  const filter: any = {
    ...validInspectionFilter,
    timestamp: {
      $gte: selectedRange.start,
      $lte: selectedRange.end,
    },
  };

  if (selectedConveyorId) {
    filter.conveyor_id = selectedConveyorId;
  }

  if (selectedLabel === "OK" || selectedLabel === "NG") {
    filter.label = selectedLabel;
  }

  if (selectedMode === "day" && selectedShift === "morning") {
    filter.timestamp = {
      $gte: selectedDay.start,
      $lt: selectedDay.noon,
    };
  }

  if (selectedMode === "day" && selectedShift === "afternoon") {
    filter.timestamp = {
      $gte: selectedDay.noon,
      $lte: selectedDay.end,
    };
  }

  const modeText =
    selectedMode === "day"
      ? `Ngày ${selectedDateValue}`
      : selectedMode === "month"
        ? `Tháng ${selectedMonthValue}`
        : `Năm ${selectedYearValue}`;

  const shiftText =
    selectedMode !== "day"
      ? "Tất cả"
      : selectedShift === "morning"
        ? "Ca sáng"
        : selectedShift === "afternoon"
          ? "Ca chiều"
          : "Tất cả ca";

  const labelText = selectedLabel || "Tất cả kết quả";
  const conveyorText = selectedConveyorId || "Tất cả băng tải";

  return {
    filter,
    filterText: `${modeText} | ${shiftText} | ${labelText} | ${conveyorText}`,
  };
};

export const exportPdf = async (req: Request, res: Response) => {
  try {
    const { filter, filterText } = await buildHistoryExportFilter(req.query);

    const items = await InspectionResult.find(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    const summary = summarize(items);

    const filename = `lich-su-kiem-tra-${Date.now()}.pdf`;
    setupPdfResponse(res, filename);

    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      bufferPages: true,
    });

    doc.pipe(res);
    setupDocFonts(doc);

    drawTitle(
      doc,
      "BÁO CÁO LỊCH SỬ KIỂM TRA SẢN PHẨM",
      `Điều kiện xuất: ${filterText}`
    );

    doc.font("bold").fontSize(12).text("1. Thống kê tổng quan");
    doc.moveDown(0.4);

    drawKeyValue(doc, "Tổng số sản phẩm", summary.total);
    drawKeyValue(doc, "Số sản phẩm OK", summary.ok);
    drawKeyValue(doc, "Số sản phẩm NG", summary.ng);
    drawKeyValue(doc, "Tỉ lệ OK", `${summary.okRate.toFixed(2)}%`);
    drawKeyValue(doc, "Tỉ lệ NG", `${summary.ngRate.toFixed(2)}%`);
    drawKeyValue(
      doc,
      "Điểm trung bình",
      summary.avgScore !== null ? summary.avgScore.toFixed(3) : "-"
    );

    doc.moveDown(1);
    doc.font("bold").fontSize(12).text("2. Danh sách lượt kiểm tra");
    doc.moveDown(0.5);

    const startX = doc.x;
    let y = doc.y;

    const columns = [
      { title: "STT", width: 36 },
      { title: "Inspection ID", width: 120 },
      { title: "Băng tải", width: 80 },
      { title: "Thời gian", width: 115 },
      { title: "KQ", width: 40 },
      { title: "Score", width: 55 },
      { title: "Threshold", width: 65 },
    ];

    const drawHeader = () => {
      doc.font("bold").fontSize(9);
      let x = startX;

      columns.forEach((col) => {
        doc.text(col.title, x, y, {
          width: col.width,
          align: "left",
        });
        x += col.width;
      });

      y += 20;
      doc.moveTo(startX, y - 6).lineTo(560, y - 6).stroke();
    };

    const drawRow = (item: any, index: number) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
        drawHeader();
      }

      doc.font("regular").fontSize(8);

      const row = [
        String(index + 1),
        safeText(item.inspection_id),
        safeText(item.conveyor_id),
        formatDateTime(item.timestamp),
        safeText(item.label),
        formatScore(item.average_score, 3),
        formatScore(item.threshold, 3),
      ];

      let x = startX;

      row.forEach((value, idx) => {
        doc.text(value, x, y, {
          width: columns[idx].width,
          align: "left",
        });
        x += columns[idx].width;
      });

      y += 22;
    };

    drawHeader();

    if (!items.length) {
      doc.font("regular").fontSize(10).text("Không có dữ liệu phù hợp.", startX, y);
    } else {
      items.forEach((item, index) => drawRow(item, index));
    }

    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("regular").fontSize(8);
      doc.text(
        `Trang ${i + 1} / ${range.count}`,
        36,
        805,
        { align: "center", width: 520 }
      );
    }

    doc.end();
  } catch (error) {
    console.error("Export history PDF error:", error);
    return res.status(500).send("Không thể xuất file PDF lịch sử kiểm tra.");
  }
};

export const exportDetailPdf = async (req: Request, res: Response) => {
  try {
    const stt = Number(req.params.stt);

    if (!Number.isFinite(stt)) {
      return res.status(400).send("Mã lượt kiểm tra không hợp lệ.");
    }

    const filter: any = {
      ...validInspectionFilter,
      stt: stt,
    };

    if (req.query.conveyor_id) {
      filter.conveyor_id = String(req.query.conveyor_id).trim().toUpperCase();
    }

    const inspection: any = await InspectionResult.findOne(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) {
      return res.status(404).send("Không tìm thấy lượt kiểm tra.");
    }

    const frames = Array.isArray(inspection.frames)
      ? inspection.frames.sort(
          (a: any, b: any) => Number(a.frame_index) - Number(b.frame_index)
        )
      : [];

    const filename = `chi-tiet-kiem-tra-${inspection.stt || stt}.pdf`;
    setupPdfResponse(res, filename);

    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      bufferPages: true,
    });

    doc.pipe(res);
    setupDocFonts(doc);

    drawTitle(
      doc,
      `BÁO CÁO CHI TIẾT LƯỢT KIỂM TRA ${inspection.stt || stt}`,
      `Inspection ID: ${inspection.inspection_id || "-"}`
    );

    doc.font("bold").fontSize(12).text("1. Thông tin lượt kiểm tra");
    doc.moveDown(0.5);

    drawKeyValue(doc, "Job ID", inspection.stt);
    drawKeyValue(doc, "Inspection ID", inspection.inspection_id);
    drawKeyValue(doc, "Băng tải", inspection.conveyor_id);
    drawKeyValue(doc, "Thời gian", formatDateTime(inspection.timestamp));
    drawKeyValue(doc, "Kết quả", inspection.label);
    drawKeyValue(doc, "Điểm trung bình", formatScore(inspection.average_score, 6));
    drawKeyValue(doc, "Ngưỡng đánh giá", formatScore(inspection.threshold, 6));
    drawKeyValue(doc, "Số frame", frames.length);

    doc.moveDown(1);
    doc.font("bold").fontSize(12).text("2. Chi tiết từng frame");
    doc.moveDown(0.5);

    for (const frame of frames) {
      if (doc.y > 620) {
        doc.addPage();
      }

      doc.font("bold").fontSize(11).text(`Frame ${frame.frame_index || "-"}`);
      doc.font("regular").fontSize(10);

      drawKeyValue(doc, "Predicted label", frame.predicted_label);
      drawKeyValue(doc, "Predicted score", formatScore(frame.predicted_score, 6));

      doc.moveDown(0.4);

      const roiLocalPath = imageUrlToLocalPath(frame.roi_path);
      const overlayLocalPath = imageUrlToLocalPath(frame.overlay_path);

      const imageY = doc.y;
      const imageWidth = 240;
      const imageHeight = 160;

      doc.font("bold").fontSize(9).text("Ảnh sản phẩm", 36, imageY);

      if (roiLocalPath && fs.existsSync(roiLocalPath)) {
        doc.image(roiLocalPath, 36, imageY + 16, {
          fit: [imageWidth, imageHeight],
        });
      } else {
        doc.font("regular").text("Không có ảnh", 36, imageY + 40, {
          width: imageWidth,
        });
      }

      doc.font("bold").fontSize(9).text("Ảnh khoanh lỗi", 310, imageY);

      if (overlayLocalPath && fs.existsSync(overlayLocalPath)) {
        doc.image(overlayLocalPath, 310, imageY + 16, {
          fit: [imageWidth, imageHeight],
        });
      } else {
        doc.font("regular").text("Không có ảnh", 310, imageY + 40, {
          width: imageWidth,
        });
      }

      doc.y = imageY + imageHeight + 34;
      doc.moveDown(0.5);
    }

    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("regular").fontSize(8);
      doc.text(
        `Trang ${i + 1} / ${range.count}`,
        36,
        805,
        { align: "center", width: 520 }
      );
    }

    doc.end();
  } catch (error) {
    console.error("Export history detail PDF error:", error);
    return res.status(500).send("Không thể xuất file PDF chi tiết lượt kiểm tra.");
  }
};

export const index = async (req: Request, res: Response) => {
  try {
    const clearFilter = req.query.clear === "1";

    const selectedMode = ["day", "month", "year"].includes(String(req.query.mode))
      ? String(req.query.mode)
      : "day";

    const selectedLabel = clearFilter ? "" : String(req.query.label || "");

    const selectedDateValue = clearFilter
      ? ""
      : String(req.query.statsDate || todayInputValue());

    const selectedMonthValue = clearFilter
      ? ""
      : String(req.query.statsMonth || currentMonthValue());

    const selectedYearValue = clearFilter
      ? ""
      : String(req.query.statsYear || currentYearValue());

    const conveyors = await Conveyor.find(
      { is_active: true },
      {
        _id: 0,
        conveyor_id: 1,
        name: 1,
        created_at: 1,
      }
    )
      .sort({ created_at: -1 })
      .lean();
    
    const selectedConveyorId = clearFilter
      ? ""
      : String(req.query.conveyor_id || "").trim().toUpperCase();

    const selectedConveyor = selectedConveyorId
      ? conveyors.find((item: any) => item.conveyor_id === selectedConveyorId)
      : null;

    const getRangeStartDate = (mode: string, statsDate: string, statsMonth: string, statsYear: string) => {
      if (mode === "month") {
        const [year, month] = statsMonth.split("-").map(Number);
        return new Date(year, month - 1, 1, 0, 0, 0);
      }

      if (mode === "year") {
        return new Date(Number(statsYear), 0, 1, 0, 0, 0);
      }

      return new Date(`${statsDate}T00:00:00`);
    };

    let error: string | null = null;

    if (!clearFilter) {
      if (selectedMode === "day" && !isValidDateValue(selectedDateValue)) {
        error = "Ngày thống kê không hợp lệ hoặc lớn hơn ngày hiện tại.";
      }

      if (selectedMode === "month" && !isValidMonthValue(selectedMonthValue)) {
        error = "Tháng thống kê không hợp lệ hoặc lớn hơn tháng hiện tại.";
      }

      if (selectedMode === "year" && !isValidYearValue(selectedYearValue)) {
        error = "Năm thống kê không hợp lệ hoặc lớn hơn năm hiện tại.";
      }
    }

    if (!error && !clearFilter && selectedConveyor) {
      const conveyorCreatedAt = new Date((selectedConveyor as any).created_at);

      const selectedStartDate = getRangeStartDate(
        selectedMode,
        selectedDateValue,
        selectedMonthValue,
        selectedYearValue
      );

      if (selectedStartDate.getTime() < conveyorCreatedAt.getTime()) {
        error = `Không thể thống kê trước ngày băng tải "${(selectedConveyor as any).name}" được khởi tạo.`;
      }
    }
    // nếu có lỗi thì render lại trang và không query DB
    if (error) {
      return res.render("history/index", {
        title: "Lịch sử kiểm tra",
        error,
        inspectionList: [],
        conveyors,
        selectedConveyor,

        filters: {
          mode: selectedMode,
          label: selectedLabel,
          conveyor_id: selectedConveyorId,
          statsDate: selectedDateValue,
          statsMonth: selectedMonthValue,
          statsYear: selectedYearValue,
          shift: "all",
        },

        shiftLinks: {
          all: "/history",
          morning: "/history",
          afternoon: "/history",
        },

        dailyStats: {
          mode: selectedMode,
          date: "",
          month: "",
          year: "",
          total: summarize([]),
          morning: summarize([]),
          afternoon: summarize([]),
        },

        pagination: {
          page: 1,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
          prevUrl: "",
          nextUrl: "",
        },
      });
    }

    // shift: loc ca sang/ca chieu. Neu khong hop le thi mac dinh la "all".
    const selectedShift = ["morning", "afternoon"].includes(String(req.query.shift))
      ? String(req.query.shift)
      : "all";

    // page: trang hien tai cua bang history. Gia tri nho nhat la 1.
    const page = Math.max(Number(req.query.page || 1), 1);

    const selectedRange = getStatsRange(
      selectedMode,
      selectedDateValue,
      selectedMonthValue,
      selectedYearValue
    );

    const selectedDay = dayRange(selectedDateValue || todayInputValue());
// 2. Lay tat ca ket qua trong ngay de tinh thong ke
    // Filter nay khong loc theo ca va khong loc OK/NG,
    // vi phan thong ke phia tren can tinh tong ca ngay.
    const wholeDayFilter: any = {
      inspection_id: validInspectionFilter.inspection_id,
      conveyor_id: validInspectionFilter.conveyor_id,
      "frames.2": validInspectionFilter["frames.2"],
      timestamp: {
        $gte: selectedRange.start,
        $lte: selectedRange.end,
      },
    };
    if (selectedLabel) {
      wholeDayFilter.label = selectedLabel;
    }

    if (selectedConveyorId) {
      wholeDayFilter.conveyor_id = selectedConveyorId;
    }

    // Danh sach nay dung cho cac the thong ke: ca ngay, ca sang, ca chieu.
    const allItemsInDay = await InspectionResult.find(wholeDayFilter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    // 3. Tao filter cho bang danh sach ben duoi
    // Ban dau bang danh sach cung lay tat ca ket qua trong ngay.
    const listFilter: any = {
      inspection_id: validInspectionFilter.inspection_id,
      conveyor_id: validInspectionFilter.conveyor_id,
      "frames.2": validInspectionFilter["frames.2"],
      timestamp: {
        $gte: selectedRange.start,
        $lte: selectedRange.end,
      },
    };

    if (selectedLabel) {
      listFilter.label = selectedLabel;
    }

    if (selectedConveyorId) {
      listFilter.conveyor_id = selectedConveyorId;
    }

    if (selectedConveyorId) {
      wholeDayFilter.conveyor_id = selectedConveyorId;
      listFilter.conveyor_id = selectedConveyorId;
    }

    // Neu nguoi dung chon ca sang thi chi lay tu 00:00 den truoc 12:00.
    if (selectedShift === "morning" && selectedMode === "day") {
      listFilter.timestamp = {
        $gte: selectedDay.start,
        $lt: selectedDay.noon,
      };
    }

    // Neu nguoi dung chon ca chieu thi chi lay tu 12:00 den het ngay.
    if (selectedShift === "afternoon" && selectedMode === "day") {
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
    const morningItems = selectedMode === "day" ? allItemsInDay.filter((item: any) => Number(item.timestamp) < selectedDay.noon) : [];
    const afternoonItems = selectedMode === "day" ? allItemsInDay.filter((item: any) => Number(item.timestamp) >= selectedDay.noon) : [];

    // 7. Tao du lieu phan trang va link chuyen ca
    // commonQuery giu lai ngay va label hien tai khi bam chuyen ca hoac chuyen trang.
    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const commonQuery = { mode: selectedMode, statsDate: selectedDay.date, statsMonth: selectedMonthValue, statsYear: selectedYearValue, label: selectedLabel, conveyor_id: selectedConveyorId };
    
    const inspectionList = await Promise.all(
      listItems.map((item: any) => previewItem(item))
    );
    // 8. Dua du lieu ra giao dien
    // Cac ten bien o day phai khop voi file view/history/index.pug.
    return res.render("history/index", {
      title: "Lich su kiem tra",

      // Danh sach cac lan kiem tra hien thi trong bang.
      inspectionList,

      conveyors,
      selectedConveyor,

      // Gia tri filter hien tai de form giu lai lua chon cua nguoi dung.
      filters: {
        mode: selectedMode,
        label: selectedLabel,
        conveyor_id: selectedConveyorId,
        statsDate: selectedDateValue,
        statsMonth: selectedMonthValue,
        statsYear: selectedYearValue,
        shift: selectedMode === "day" ? selectedShift : "all",
      },

      // Link cho 3 tab: tat ca, ca sang, ca chieu.
      shiftLinks: {
        all: url({ ...commonQuery, shift: "all" }),
        morning: url({ ...commonQuery, shift: "morning" }),
        afternoon: url({ ...commonQuery, shift: "afternoon" }),
      },

      // Du lieu thong ke o cac card phia tren.
      dailyStats: {
        mode: selectedMode,
        date: clearFilter ? "" : selectedDateValue,
        month: clearFilter ? "" : selectedMonthValue,
        year: clearFilter ? "" : selectedYearValue,
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
    // Lay stt tu URL /history/:stt.
    const stt = Number(req.params.stt);
    if (!Number.isFinite(stt)) return res.status(400).send("Ma luot kiem tra khong hop le.");

    // Tim lan kiem tra theo stt va chi lay ban ghi hop le.
    const filter: any = { ...validInspectionFilter, stt: stt };

    // Neu URL co conveyor_id thi loc them de tranh trung stt giua cac bang tai.
    if (req.query.conveyor_id) {
      filter.conveyor_id = String(req.query.conveyor_id).trim().toUpperCase();
    }

    // Lay ban ghi moi nhat neu co nhieu ban ghi cung stt.
    const inspection: any = await InspectionResult.findOne(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) return res.status(404).send("Khong tim thay luot kiem tra.");

    // Sap xep frame theo frame_index truoc khi dua ra trang detail.
    return res.render("history/detail", {
      title: `Chi tiet luot ${stt}`,
      inspection: {
        ...inspection,
        display_id: inspection.stt || "-",
        frames: Array.isArray(inspection.frames)
          ? inspection.frames.sort(
              (a: any, b: any) => Number(a.frame_index) - Number(b.frame_index)
            )
          : [],
      },
      backUrl: "/history",
    });
  } catch (error) {
    console.error("History detail error:", error);
    return res.status(500).send("Khong the tai chi tiet luot kiem tra.");
  }
};