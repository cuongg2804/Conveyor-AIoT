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
      default: null,
    },

    model_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ModelRegistry",
      default: null,
    },

    camera_trigger_delay: {
      type: Number,
      default: 0,
    },

    camera_trigger_delay_ms: {
      type: Number,
      default: 0,
    },

    serial_port: {
      type: String,
      trim: true,
      default: null,
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

    arduino_speed_low_level: {
      type: Number,
      min: 1,
      max: 5,
      default: 2,
    },

    arduino_speed_high_level: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },

    arduino_servo_home_angle: {
      type: Number,
      min: 0,
      max: 180,
      default: 0,
    },

    arduino_servo_gate_angle: {
      type: Number,
      min: 0,
      max: 180,
      default: 130,
    },

    arduino_light_min_lux: {
      type: Number,
      min: 0,
      max: 3000,
      default: 1000,
    },

    arduino_light_max_lux: {
      type: Number,
      min: 0,
      max: 3000,
      default: 2000,
    },

    threshold_override: {
      type: Number,
      default: null,
    },

    mode: {
      type: String,
      enum: ["AUTO", "MANUAL"],
      default: "AUTO",
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "MAINTENANCE"],
      default: "ACTIVE",
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
