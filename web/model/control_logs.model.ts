import mongoose from "mongoose";

const control_logs_schema = new mongoose.Schema({
    control_log_id: {
        type: String,
        unique: true,
        required: true
    },
    conveyor_id: {
        type: String,
        required: true,
        trim: true
    },
    user_id: {
        type: String,
        required: true,
        trim: true
    },
    cmd: {
        type: String,
        required: true,
        enum: ["START", "STOP"]
    },
    status: {
        type: String,
        required: true,
        trim: true,
        enum: ["OK", "ERROR", "DENIED"]
    },
    message: {
        type: String
    }
}, 
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "updated_at"
        }
    }
)
export const Control_log = mongoose.model("Control_log", control_logs_schema)
export default Control_log