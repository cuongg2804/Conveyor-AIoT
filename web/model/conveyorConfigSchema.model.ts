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

    camera_source: {
      type: String,
      required: true,
      trim: true,
    },

    camera_trigger_delay: {
      type: Number,
      default: 0,
    },

    serial_port: {
      type: String,
      required: true,
      trim: true,
    },

    baud_rate: {
      type: Number,
      required: true,
      default: 9600,
    },

    ai_threshold: {
      type: Number,
      required: true
    },

    status: {
      type: String,
      enum: ["READY", "RUNNING", "STOPPED", "ERROR"],
      default: "READY",
    },

    is_active: {
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

const ConveyorConfig = mongoose.model(
  "ConveyorConfig",
  conveyorConfigSchema,
  "conveyor_configs"
);

export default ConveyorConfig;