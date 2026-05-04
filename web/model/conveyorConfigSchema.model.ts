import mongoose from "mongoose";

const conveyorConfigSchema = new mongoose.Schema(
  {
    conveyor_code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    camera_source: { // URL hoặc ID nguồn camera
      type: String,
      required: true,
      trim: true,
    },
    camera_trigger_delay: { // thời gian trễ giữa lúc nhận được kết quả kiểm tra và lúc kích hoạt camera, tính bằng mili giây
      type: Number,
      default: 0,
    },
    serial_port: {
      type: String,
      required: true,
      trim: true,
    },
    baud_rate: { // tốc độ truyền dữ liệu qua cổng nối tiếp, đơn vị là bit/giây
      type: Number,
      required: true,
      default: 9600,
    },
    ai_threshold: {
      type: Number,
      required: true,
      default: 30.436506,
    },
    status: {
      type: String,
      enum: ["READY", "STARTING", "RUNNING", "STOPPING", "STOPPED", "ERROR"],
      default: "READY",
    },
    is_active: { // cho phép kích hoạt hoặc tạm ngưng băng tải mà không cần xóa cấu hình
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
  }
);

const ConveyorConfig =
  mongoose.models.ConveyorConfig ||
  mongoose.model("ConveyorConfig", conveyorConfigSchema, "conveyor_configs");

export default ConveyorConfig;
