import mongoose from "mongoose";

const cameraSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    camera_name: {
      type: String,
      required: true,
      trim: true,
    },
    camera_ip: {
      type: String,
      default: "",
      trim: true,
    },
    // type: {
    //   type: String,
    //   enum: ["GIGE", "USB", "IP_CAMERA"],
    //   default: "GIGE",
    // },
    status: {
      type: String,
      enum: ["AVAILABLE", "IN_USE", "ERROR"],
      default: "AVAILABLE",
    },
    conveyor_id: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
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

const Camera =
  mongoose.models.Camera ||
  mongoose.model("Camera", cameraSchema, "cameras");

export default Camera;