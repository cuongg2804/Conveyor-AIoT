import mongoose from "mongoose";

export const USER_ROLES = ["ADMIN", "USER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const normalizeUserRole = (value: any): UserRole | "" => {
  const role = String(value || "").trim().toUpperCase();

  if (role === "ADMIN") return "ADMIN";
  if (role === "USER") return "USER";

  return "";
};

const userSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      trim: true,
    },
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: "USER",
      required: true,
      set: normalizeUserRole,
    },
    token: {
      type: String,
      default: "",
      index: true,
    },
    status: {
      type: String,
      enum: ["ONLINE", "OFFLINE"],
      default: "OFFLINE",
      required: true,
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

const User = mongoose.models.User || mongoose.model("User", userSchema, "users");

export { User };
export default User;