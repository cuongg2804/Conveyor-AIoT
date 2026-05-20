// models/ModelRegistry.ts
import mongoose from "mongoose";

const modelRegistrySchema = new mongoose.Schema(
  {
    model_name: {
      type: String,
      required: true,
      trim: true,
    },

    version: {
      type: String,
      required: true,
      trim: true,
    },

    product_code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    storage_type: {
      type: String,
      enum: ["minio", "local", "s3"],
      default: "minio",
    },

    bucket: {
      type: String,
      required: true,
      trim: true,
    },

    object_key: {
      type: String,
      required: true,
      trim: true,
    },

    threshold: {
      type: Number,
      required: true,
    },

    accuracy: {
      type: Number,
      default: null,
    },

    precision: {
      type: Number,
      default: null,
    },

    recall: {
      type: Number,
      default: null,
    },

    f1_score: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: ["testing", "active", "archived", "failed"],
      default: "testing",
      index: true,
    },

    // Nếu có User thì bật lại phần này
    // created_by: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    //   default: null,
    // },
  },
  {
    collection: "model_registry",
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    versionKey: false,
  }
);

modelRegistrySchema.index(
  { product_code: 1, model_name: 1, version: 1 },
  { unique: true }
);

const ModelRegistry =
  mongoose.models.ModelRegistry ||
  mongoose.model("ModelRegistry", modelRegistrySchema);

export default ModelRegistry;