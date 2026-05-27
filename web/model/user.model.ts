import mongoose from "mongoose";

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
        enum: ["ADMIN", "USER"],
    },
    token: {
        type: String,
        default: "",
        index: true
    },
    status: {
        type: String,
        enum: ["ONLINE", "OFFLINE"],
        default: "OFFLINE",
        required: true,
    }
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