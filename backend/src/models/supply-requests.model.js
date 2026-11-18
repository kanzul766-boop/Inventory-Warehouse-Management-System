import mongoose from "mongoose";

const supplyRequestSchema = new mongoose.Schema({
    supplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true
    },
    warehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "warehouse",
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger
    },
    status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected"],
        default: "Pending",
        required: true
    },
    note: {
        type: String,
        trim: true,
        maxlength: 500
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user"
    },
    reviewedAt: Date
}, { timestamps: true });

supplyRequestSchema.index({ supplier: 1, createdAt: -1 });
supplyRequestSchema.index({ status: 1, createdAt: -1 });

const supplyRequestModel = mongoose.model("supplyRequest", supplyRequestSchema);
export default supplyRequestModel;
