import mongoose from "mongoose";

const conveyor = new mongoose.Schema({
    conveyor_id: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        required: true,
        trim: true,
        enum: ["READY", "STARTING", "RUNNING", "STOPPING", "STOP", "STOPPED", "ERROR", "OFFLINE"]
    },
    user_id: {
      type: String,
      default: "",
      trim: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
},
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "updated_at"
        },
    }
);
export const Conveyor = mongoose.model("Conveyor", conveyor);
export default Conveyor;
