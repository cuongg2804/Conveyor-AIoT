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
    camera_id: {
      type: String,
      trim: true,
    },
    camera_trigger_delay: {
      type: Number,
      default: 0,
    },
    serial_port: {
      type: String,
      trim: true,
    },
    baud_rate: {
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
        required: true,
        min: 0,
        max: 180
    },
    model_id: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    config_mode: {
      type: String,
      enum: ["PRODUCTION", "TEST"],
      default: "PRODUCTION",
      index: true,
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
