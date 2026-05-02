import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";
// Hàm chuyển đổi đối tượng Date thành chuỗi định dạng "YYYY-MM-DD" để sử dụng làm giá trị mặc định cho input type="date"
const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Tháng trong JavaScript bắt đầu từ 0, nên cần cộng thêm 1
  const day = String(date.getDate()).padStart(2, "0"); // Lấy ngày và đảm bảo luôn có 2 chữ số bằng cách thêm số 0 vào trước nếu cần
  return `${year}-${month}-${day}`;
};
// Hàm phân tích chuỗi ngày và tạo ra các mốc thời gian trong ngày (bắt đầu, giữa trưa, kết thúc)
const parseDayRange = (dateValue: string) => { 
  const selectedDate = dateValue || toDateInputValue(new Date()); // Nếu không có ngày nào được chọn, sử dụng ngày hiện tại làm mặc định
  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const noon = new Date(`${selectedDate}T12:00:00`);
  const dayEnd = new Date(`${selectedDate}T23:59:59.999`);

  return {
    selectedDate,
    dayStartSec: dayStart.getTime() / 1000, // ms -> s để lưu trữ và so sánh trong DB
    noonSec: noon.getTime() / 1000,
    dayEndSec: dayEnd.getTime() / 1000,
  }; 
};

const summarize = (items: any[]) => {
  const total = items.length;
  const ok = items.filter((item) => item.label === "OK").length;
  const ng = items.filter((item) => item.label === "NG").length;
  const scoreItems = items.filter((item) => Number.isFinite(Number(item.average_score))); // Lọc ra các mục có average_score hợp lệ để tính điểm trung bình
  const avgScore = scoreItems.length 
    ? scoreItems.reduce((sum, item) => sum + Number(item.average_score), 0) / scoreItems.length
    : null; 

  return {
    total,
    ok,
    ng,
    okRate: total ? (ok / total) * 100 : 0,
    ngRate: total ? (ng / total) * 100 : 0,
    avgScore,
  };
};
// Hàm xây dựng URL với các tham số truy vấn, chỉ bao gồm những tham số có giá trị hợp lệ (không undefined hoặc rỗng)
const buildUrl = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  // Duyệt qua các cặp key-value trong đối tượng query và thêm vào URLSearchParams nếu giá trị hợp lệ
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return `/history?${params.toString()}`;
};

const normalizeConveyorCode = (value: any) => String(value || "").trim().toUpperCase();

const normalizeInspectionDetail = (item: any) => {
  // Sắp xếp frames theo frame_index để đảm bảo thứ tự hiển thị chính xác trong chi tiết lượt kiểm tra
  const frames = Array.isArray(item.frames)
    ? [...item.frames].sort((a: any, b: any) => Number(a.frame_index || 0) - Number(b.frame_index || 0))
    : [];

  return {
    ...item, 
    display_id: item.job_id || "-",
    frames,
  };
};
//
const validInspectionFilter = () => ({
  inspection_id: { $exists: true, $ne: "" },
  conveyor_code: { $exists: true, $ne: "" },
  frames: { $exists: true, $type: "array" },
  "frames.2": { $exists: true },
});

export const index = async (req: Request, res: Response) => {
  try {
    const label = String(req.query.label || "").trim();
    const statsDateQuery = String(req.query.statsDate || "").trim();
    const shiftQuery = String(req.query.shift || "all").trim();
    const shift = ["morning", "afternoon"].includes(shiftQuery) ? shiftQuery : "all";
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const { selectedDate, dayStartSec, noonSec, dayEndSec } = parseDayRange(statsDateQuery);

    const dayTimestampFilter = {
      $gte: dayStartSec,
      $lte: dayEndSec,
    };

    const baseFilter: any = {
      ...validInspectionFilter(),
      timestamp: dayTimestampFilter,
    };

    const listFilter: any = {
      ...validInspectionFilter(),
      timestamp: { ...dayTimestampFilter },
    };

    if (shift === "morning") {
      listFilter.timestamp = {
        $gte: dayStartSec,
        $lt: noonSec,
      };
    }

    if (shift === "afternoon") {
      listFilter.timestamp = {
        $gte: noonSec,
        $lte: dayEndSec,
      };
    }

    if (label === "OK" || label === "NG") {
      listFilter.label = label;
    }

    const dayItems = await InspectionResult.find(baseFilter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    const total = await InspectionResult.countDocuments(listFilter);

    const inspectionList = await InspectionResult.find(listFilter, { _id: 0 })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    // 
    const normalizedList = inspectionList.map((item: any) => {
      const frames = Array.isArray(item.frames) ? item.frames : [];
      const previewFrame = frames[1] || frames[0] || null;

      return {
        ...item,
        display_id: item.job_id || "-",
        preview_frame: previewFrame,
      };
    });

    const morningItems = dayItems.filter((item: any) => Number(item.timestamp) < noonSec);
    const afternoonItems = dayItems.filter((item: any) => Number(item.timestamp) >= noonSec);

    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const commonQuery = {
      statsDate: selectedDate,
      label,
    };
    const pageQuery = {
      ...commonQuery,
      shift,
    };

    return res.render("history/index", {
      title: "Lịch sử kiểm tra",
      inspectionList: normalizedList,
      filters: {
        label,
        statsDate: selectedDate,
        shift,
      },
      shiftLinks: {
        all: buildUrl({ ...commonQuery, shift: "all" }),
        morning: buildUrl({ ...commonQuery, shift: "morning" }),
        afternoon: buildUrl({ ...commonQuery, shift: "afternoon" }),
      },
      dailyStats: {
        date: selectedDate,
        total: summarize(dayItems),
        morning: summarize(morningItems),
        afternoon: summarize(afternoonItems),
      },
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevUrl: buildUrl({ ...pageQuery, page: page - 1 }),
        nextUrl: buildUrl({ ...pageQuery, page: page + 1 }),
      },
    });
  } catch (error) {
    console.error("History page error:", error);
    return res.status(500).send("Không thể tải lịch sử kiểm tra.");
  }
};

export const detail = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);
    const conveyorCode = normalizeConveyorCode(req.query.conveyor_code);

    if (!Number.isFinite(jobId)) {
      return res.status(400).send("Mã lượt kiểm tra không hợp lệ.");
    }

    const filter: any = { ...validInspectionFilter(), job_id: jobId };
    if (conveyorCode) filter.conveyor_code = conveyorCode;

    const inspection = await InspectionResult.findOne(filter, { _id: 0 })
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) {
      return res.status(404).send("Không tìm thấy lượt kiểm tra.");
    }

    return res.render("history/detail", {
      title: `Chi tiết lượt ${jobId}`,
      inspection: normalizeInspectionDetail(inspection),
      backUrl: "/history",
    });
  } catch (error) {
    console.error("History detail error:", error);
    return res.status(500).send("Không thể tải chi tiết lượt kiểm tra.");
  }
};
