import mongoose from "mongoose";

export const USER_ROLES = ["ADMIN", "USER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const normalizeUserRole = (role: unknown): UserRole | "" => {
    const normalized = String(role || "").trim().toUpperCase();
    return USER_ROLES.includes(normalized as UserRole) ? (normalized as UserRole) : "";
};

const userSchema = new mongoose.Schema({
    user_id: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    username : {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        trim: true
    },
    fullname: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: USER_ROLES,
        default: "USER",
        set: (value: unknown) => normalizeUserRole(value) || "USER",
        required: true,
    },
    token: {
        type: String,
        default: "",
        index: true
    },
    
},
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "updated_at"
        },
    }
);
export const User = mongoose.model("User", userSchema);
export default User;
