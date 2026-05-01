import mongoose, { Model } from "mongoose";

export interface ConveyorConfigDocument {
  conveyor_code: string;
  name: string;
  description: string;
  camera_source: string;
  camera_trigger_delay: number;
  serial_port: string;
  baud_rate: number;
  ai_threshold: number;
  status: "READY" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "ERROR";
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

const conveyorConfigSchema = new mongoose.Schema<ConveyorConfigDocument>(
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
      required: true,
      default: 30.436506,
    },
    status: {
      type: String,
      enum: ["READY", "STARTING", "RUNNING", "STOPPING", "STOPPED", "ERROR"],
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

const ConveyorConfig =
  (mongoose.models.ConveyorConfig as Model<ConveyorConfigDocument> | undefined) ||
  mongoose.model<ConveyorConfigDocument>(
    "ConveyorConfig",
    conveyorConfigSchema,
    "conveyor_configs"
  );

export default ConveyorConfig;
