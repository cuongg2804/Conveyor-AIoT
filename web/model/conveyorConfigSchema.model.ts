import mongoose from "mongoose";

const conveyorConfigSchema = new mongoose.Schema(
  {
    conveyor_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    camera_id: { // URL hoặc ID nguồn camera
      type: String,
      trim: true,
    },
    camera_trigger_delay: { // thời gian trễ giữa lúc nhận được kết quả kiểm tra và lúc kích hoạt camera, tính bằng mili giây
      type: Number,
      default: 0,
    },
    serial_port: {
      type: String,
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
    speed: {
        type: Number,
        default: 150,
        required: true,
        min: 0,
        max: 255
    },
    goc_home: {
        type: Number,
        default: 0,
        required: true,
        min: 0,
        max: 180
    },
    goc_gat: {
        type: Number,
        default: 120,
        min: 0,
        max: 180,
        required: true
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
