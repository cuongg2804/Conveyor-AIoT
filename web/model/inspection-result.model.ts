import mongoose, { Model } from "mongoose";

export interface InspectionFrame {
  frame_index?: number;
  predicted_label?: string;
  predicted_score?: number;
  roi_path?: string;
  overlay_path?: string;
}

export interface InspectionResultDocument {
  inspection_id?: string;
  job_id: number;
  conveyor_code?: string;
  timestamp: number;
  label: "OK" | "NG" | "UNKNOWN";
  average_score: number;
  threshold?: number;
  frames: InspectionFrame[];
}

const inspectionFrameSchema = new mongoose.Schema<InspectionFrame>(
  {
    frame_index: Number,
    predicted_label: String,
    predicted_score: Number,
    roi_path: String,
    overlay_path: String,
  },
  { _id: false }
);

const inspectionResultSchema = new mongoose.Schema<InspectionResultDocument>(
  {
    inspection_id: {
      type: String,
      index: true,
      trim: true,
    },
    job_id: {
      type: Number,
      required: true,
      index: true,
    },
    conveyor_code: {
      type: String,
      index: true,
      trim: true,
      uppercase: true,
    },
    timestamp: {
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
    versionKey: false,
  }
);

const InspectionResult =
  (mongoose.models.InspectionResult as Model<InspectionResultDocument> | undefined) ||
  mongoose.model<InspectionResultDocument>(
    "InspectionResult",
    inspectionResultSchema,
    "inspection_results"
  );

export default InspectionResult;
