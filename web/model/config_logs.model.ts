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
        type: String,
        required: true,
        enum: ["UPDATE_CONFIG"],
        default: "UPDATE_CONFIG"
    },
    changes: {
        type: Object,
        default: {},
    },
    /*message: {
        type: String
    }*/
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