import mongoose from "mongoose";

// const inspectionFrameSchema = new mongoose.Schema(
//   {
//     frame_index: Number, // chi so frame trong luot kiem tra, bat dau tu 0
//     predicted_label: String, 
//     predicted_score: Number,
//     roi_path: String, // duong dan anh vung quan tam (region of interest) de hien thi tren giao dien
//     mask_path: String, // duong dan anh bieu dien vung mask (neu co) de hien thi tren giao dien
//     overlay_path: String, // duong dan anh tong hop giua roi va mask (neu co) de hien thi tren giao dien
//   },
//   { _id: false }
// );

const inspectionFrameSchema = new mongoose.Schema(
  {
    frame_index: Number,
    predicted_label: String,
    predicted_score: Number,

    roi_path: String,
    mask_path: String,
    overlay_path: String,

    roi_object_key: String,
    mask_object_key: String,
    overlay_object_key: String,
    bucket: String,
    storage_type: {
      type: String,
      enum: ["minio", "local"],
      default: "minio",
    },
  },
  { _id: false }
);

const inspectionResultSchema = new mongoose.Schema(
  {
    // mã phiên kiểm tra dùng để phân biệt sản phẩm khác nhau
    inspection_id: { 
      type: String,
      index: true,
      unique: true,
      sparse: true,
      trim: true,
    },
    stt: { // số thứ tự lần kiểm tra trong ngày của băng tải
      type: Number,
      required: true,
      index: true, // 
    },
    conveyor_id: {
      type: String,
      index: true,
      trim: true,
      uppercase: true,
    },
    timestamp: { // thời điểm xảy ra sự kiện kiểm tra, được lưu dưới dạng số giây
      type: Number,
      required: true,
      index: true,
    },
    label: {
      type: String,
      enum: ["OK", "NG", "UNKNOWN"],
      required: true,
    },
    average_score: {
      type: Number,
      required: true,
    },
    threshold: {
      type: Number,
    },
    frames: { 
      type: [inspectionFrameSchema],
      default: [], 
    },
  },
  {
    versionKey: false, // bo truong __v mac dinh cua mongoose
  }
);

const InspectionResult =
  mongoose.models.InspectionResult ||
  mongoose.model("InspectionResult", inspectionResultSchema, "inspection_results");

export default InspectionResult;
