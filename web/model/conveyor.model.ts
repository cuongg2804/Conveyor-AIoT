import mongoose from "mongoose";

const conveyor = new mongoose.Schema({
    conveyor_id: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    /*line_id: {
        type: String,
        required: true,
        trim: true
    },*/
    status: {
        type: String,
        required: true,
        trim: true,
        enum: ["READY", "STARTING", "RUNNING", "STOPPING", "STOP", "STOPPED", "ERROR", "OFFLINE"]
    },
    operator_id: {
      type: String,
      default: "",
      trim: true,
    },
    /*speed: {
        type: Number,
        default: 150,
        required: true,
        min: 0,
        max: 255
    },
    goc_home: {
        type: Number,
        default: 0,
        required: true,
        min: 0,
        max: 180
    },
    goc_gat: {
        type: Number,
        default: 120,
        min: 0,
        max: 180,
        required: true
    },*/
    is_active: {
      type: Boolean,
      default: true,
    },
    description: {
        type: String
    }
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
