import mongoose from "mongoose";

const frameSchema = new mongoose.Schema(
  {
    frame_index: Number,
    predicted_label: String,
    predicted_score: Number,
    roi_path: String,
    overlay_path: String,
  },
  { _id: false }
);

const inspectionResultSchema = new mongoose.Schema(
  {
    job_id: { type: Number, required: true, unique: true },
    timestamp: { type: Number, required: true },
    label: { type: String, required: true },
    average_score: { type: Number, required: true },
    frames: [frameSchema],
  },
  { versionKey: false }
);

const InspectionResult = mongoose.model(
  "InspectionResult",
  inspectionResultSchema,
  "inspection_results"
);

export default InspectionResult;