import { Request, Response } from "express";
import InspectionResult from "../model/inspection-result.model";
<<<<<<< Updated upstream
// Hàm chuyển đổi đối tượng Date thành chuỗi định dạng "YYYY-MM-DD" để sử dụng làm giá trị mặc định cho input type="date"
const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Tháng trong JavaScript bắt đầu từ 0, nên cần cộng thêm 1
  const day = String(date.getDate()).padStart(2, "0"); // Lấy ngày và đảm bảo luôn có 2 chữ số bằng cách thêm số 0 vào trước nếu cần
  return `${year}-${month}-${day}`;
=======

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
>>>>>>> Stashed changes
};
// Hàm phân tích chuỗi ngày và tạo ra các mốc thời gian trong ngày (bắt đầu, giữa trưa, kết thúc)
const parseDayRange = (dateValue: string) => { 
  const selectedDate = dateValue || toDateInputValue(new Date()); // Nếu không có ngày nào được chọn, sử dụng ngày hiện tại làm mặc định
  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const noon = new Date(`${selectedDate}T12:00:00`);
  const dayEnd = new Date(`${selectedDate}T23:59:59.999`);

<<<<<<< Updated upstream
  return {
    selectedDate,
    dayStartSec: dayStart.getTime() / 1000, // ms -> s để lưu trữ và so sánh trong DB
    noonSec: noon.getTime() / 1000,
    dayEndSec: dayEnd.getTime() / 1000,
  }; 
=======
// Dieu kien de chi lay cac lan kiem tra hop le:
// - co inspection_id
// - co conveyor_code
// - co du 3 frame, vi "frames.2" la frame thu 3 trong mang.
const validInspectionFilter = {
  inspection_id: { $exists: true, $ne: "" },
  conveyor_code: { $exists: true, $ne: "" },
  "frames.2": { $exists: true },
>>>>>>> Stashed changes
};

// Tinh so luong OK/NG, ti le OK/NG va diem trung binh de hien thi o phan thong ke.
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

<<<<<<< Updated upstream
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
=======
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
>>>>>>> Stashed changes
});

export const index = async (req: Request, res: Response) => {
  try {
<<<<<<< Updated upstream
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
=======
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
    console.log(wholeDayFilter);
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
      .lean(); // trả về plain JavaScript object thay vì Mongoose document cho pug render 

    // 6. Tinh thong ke sang/chieu
    // allItemsInDay da co toan bo ket qua trong ngay,
    // nen chi can tach bang timestamp truoc/sau 12:00.
    const morningItems = allItemsInDay.filter((item: any) => Number(item.timestamp) < selectedDay.noon);
    const afternoonItems = allItemsInDay.filter((item: any) => Number(item.timestamp) >= selectedDay.noon);

    // 7. Tao du lieu phan trang va link chuyen ca
    // commonQuery giu lai ngay va label hien tai khi bam chuyen ca hoac chuyen trang.
    const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const commonQuery = { statsDate: selectedDay.date, label: selectedLabel }; //
>>>>>>> Stashed changes

    // 8. Dua du lieu ra giao dien
    // Cac ten bien o day phai khop voi file view/history/index.pug.
    return res.render("history/index", {
<<<<<<< Updated upstream
      title: "Lịch sử kiểm tra",
      inspectionList: normalizedList,
      filters: {
        label,
        statsDate: selectedDate,
        shift,
      },
=======
    title: "Lịch sử kiểm tra",

      // Danh sach cac lan kiem tra hien thi trong bang.
      inspectionList: listItems.map(previewItem), // 

      // Gia tri filter hien tai de form giu lai lua chon cua nguoi dung.
      filters: {
        label: selectedLabel,
        statsDate: selectedDay.date,
        shift: selectedShift,
      },

      // Link cho 3 tab: tat ca, ca sang, ca chieu.
>>>>>>> Stashed changes
      shiftLinks: {
        all: buildUrl({ ...commonQuery, shift: "all" }),
        morning: buildUrl({ ...commonQuery, shift: "morning" }),
        afternoon: buildUrl({ ...commonQuery, shift: "afternoon" }),
      },

      // Du lieu thong ke o cac card phia tren.
      dailyStats: {
<<<<<<< Updated upstream
        date: selectedDate,
        total: summarize(dayItems),
=======
        date: selectedDay.date,
        total: summarize(allItemsInDay),
>>>>>>> Stashed changes
        morning: summarize(morningItems),
        afternoon: summarize(afternoonItems),
      },

      // Du lieu cho nut Truoc/Sau.
      pagination: {
        page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
<<<<<<< Updated upstream
        prevUrl: buildUrl({ ...pageQuery, page: page - 1 }),
        nextUrl: buildUrl({ ...pageQuery, page: page + 1 }),
      },
    });
  } catch (error) {
    console.error("History page error:", error);
    return res.status(500).send("Không thể tải lịch sử kiểm tra.");
=======
        prevUrl: url({ ...commonQuery, shift: selectedShift, page: page - 1 }),
        nextUrl: url({ ...commonQuery, shift: selectedShift, page: page + 1 }),
      },
    });
  } catch (error) {
    console.error("Lịch sử kiểm tra lỗi:", error);
    return res.status(500).send("Khong the tai lich su kiem tra.");
>>>>>>> Stashed changes
  }
};

export const detail = async (req: Request, res: Response) => {
  try {
    // Lay jobId tu URL /history/:jobId.
    const jobId = Number(req.params.jobId);
    const conveyorCode = normalizeConveyorCode(req.query.conveyor_code);

<<<<<<< Updated upstream
    if (!Number.isFinite(jobId)) {
      return res.status(400).send("Mã lượt kiểm tra không hợp lệ.");
    }

    const filter: any = { ...validInspectionFilter(), job_id: jobId };
    if (conveyorCode) filter.conveyor_code = conveyorCode;

    const inspection = await InspectionResult.findOne(filter, { _id: 0 })
=======
    // Tim lan kiem tra theo job_id va chi lay ban ghi hop le.
    const filter: any = { ...validInspectionFilter, job_id: jobId };

    // Neu URL co conveyor_code thi loc them de tranh trung job_id giua cac bang tai.
    if (req.query.conveyor_code) {
      filter.conveyor_code = String(req.query.conveyor_code).trim().toUpperCase();
    }

    // Lay ban ghi moi nhat neu co nhieu ban ghi cung job_id.
    const inspection: any = await InspectionResult.findOne(filter, { _id: 0 })
>>>>>>> Stashed changes
      .sort({ timestamp: -1 })
      .lean();

    if (!inspection) {
      return res.status(404).send("Không tìm thấy lượt kiểm tra.");
    }

    // Sap xep frame theo frame_index truoc khi dua ra trang detail.
    return res.render("history/detail", {
      title: `Chi tiết lượt ${jobId}`,
      inspection: normalizeInspectionDetail(inspection),
      backUrl: "/history",
    });
  } catch (error) {
<<<<<<< Updated upstream
    console.error("History detail error:", error);
    return res.status(500).send("Không thể tải chi tiết lượt kiểm tra.");
=======
    console.error("Lịch sử kiểm tra lỗi:", error);
    return res.status(500).send("Khong the tai chi tiet luot kiem tra.");
>>>>>>> Stashed changes
  }
};