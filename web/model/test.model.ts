import mongoose from "mongoose";

const testSessionSchema = new mongoose.Schema(
  {
    test_session_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    conveyor_id: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    model_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ModelRegistry",
      required: true,
    },

    model_name: {
      type: String,
      required: true,
    },

    model_version: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["RUNNING", "COMPLETED", "CANCELLED", "FAILED"],
      default: "RUNNING",
    },

    started_at: {
      type: Date,
      default: Date.now,
    },

    ended_at: {
      type: Date,
      default: null,
    },

    duration_minutes: {
      type: Number,
      required: true,
      min: 1,
    },

    config_snapshot: {
      type: Object,
      required: true,
    },

    model_snapshot: {
      type: Object,
      required: true,
    },

    total_products: {
      type: Number,
      default: 0,
    },

    ok_count: {
      type: Number,
      default: 0,
    },

    ng_count: {
      type: Number,
      default: 0,
    },

    avg_score: {
      type: Number,
      default: null,
    },

    /*created_by: {
      type: String,
      default: "",
    },*/
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
  }
);

export default mongoose.model("TestSession", testSessionSchema, "test_sessions");