import mongoose from "mongoose";
import Conveyor from "./conveyor.model";

const config_logs_schema = new mongoose.Schema({
    config_log_id : {
        type: String,
        required: true,
        unique: true
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
    action: {
        serial_port: {
            type: String,
            trim: true,
        },
        camera_id: {
            type: String,
            trim: true,
        },
        camera_trigger_delay: { 
            type: Number,
            default: 0,
        },
        baud_rate: {
            type: Number,
            required: true,
            default: 9600,
        },
        ai_threshold: {
            type: Number,
            required: true,
            default: 30.436506,
        },
    }
},
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "updated_at"
        },
    }
)
export const Config_log = mongoose.model("Config_log", config_logs_schema)
export default Config_log