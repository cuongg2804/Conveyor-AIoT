import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";
import { resolveFrameImageUrls } from "../service/imageStorage.service";
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
      ? await resolveFrameImageUrls(previewFrame)
      : null,
  };
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
    // Lay jobId tu URL /history/:jobId.
    const jobId = Number(req.params.jobId);
    if (!Number.isFinite(jobId)) return res.status(400).send("Ma luot kiem tra khong hop le.");

    // Tim lan kiem tra theo stt va chi lay ban ghi hop le.
    const filter: any = { ...validInspectionFilter, stt: jobId };

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
      title: `Chi tiet luot ${jobId}`,
      inspection: {
        ...inspection,
        display_id: inspection.stt || "-",
        frames: Array.isArray(inspection.frames)
        ? await Promise.all(
            inspection.frames
              .sort((a: any, b: any) => Number(a.frame_index) - Number(b.frame_index))
              .map((frame: any) => resolveFrameImageUrls(frame))
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