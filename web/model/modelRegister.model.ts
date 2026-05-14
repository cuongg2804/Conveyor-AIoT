const mongoose = require("mongoose");

const ModelRegistrySchema = new mongoose.Schema(
  {
    model_name: {
      type: String,
      required: true,
    },

    version: {
      type: String,
      required: true,
    },

    product_code: {
      type: String,
      required: true,
    },

    storage_type: {
      type: String,
      enum: ["minio", "local", "s3"],
      default: "minio",
    },

    bucket: {
      type: String,
      required: true,
    },

    object_key: {
      type: String,
      required: true,
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
      enum: ["testing", "active", "inactive", "archived", "failed"],
      default: "testing",
      index: true,
    },

    // created_by: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "User",
    //   default: null,
    // },

    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "model_registry",
  }
);

ModelRegistrySchema.index(
  { product_code: 1, model_name: 1, version: 1 },
  { unique: true }
);

module.exports = mongoose.model("ModelRegistry", ModelRegistrySchema);