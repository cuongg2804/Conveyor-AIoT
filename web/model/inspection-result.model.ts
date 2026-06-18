import mongoose from "mongoose";

const inspectionFrameSchema = new mongoose.Schema(
  {
    frame_index: Number, 
    predicted_label: String, 
    predicted_score: Number,
    roi_path: String, 
    mask_path: String, 
    overlay_path: String,
  },
  { _id: false }
);


const inspectionResultSchema = new mongoose.Schema(
  {
    inspection_id: { 
      type: String,
      index: true,
      unique: true,
      sparse: true,
      trim: true,
    },
    stt: {
      type: Number,
      required: true,
      index: true,
    },
    conveyor_id: {
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
    threshold: {
      type: Number,
    },
    average_score: {
      type: Number,
      default: null,
      index: true,
    },
    frames: { 
      type: [inspectionFrameSchema],
      default: [], 
    },
    mode: {
      type: String,
      enum: ["PRODUCTION", "TEST"],
      default: "PRODUCTION",
      index: true,
    },
    model_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    }
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
  },
);

const InspectionResult =
  mongoose.models.InspectionResult ||
  mongoose.model("InspectionResult", inspectionResultSchema, "inspection_results");

export default InspectionResult
