import mongoose from "mongoose";

const stockSchema = new mongoose.Schema({
    warehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "warehouse",
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: Number.isSafeInteger
    }
}, { timestamps: true });

stockSchema.index({ warehouse: 1, product: 1 }, { unique: true });

const stockModel = mongoose.model("stock", stockSchema);
export default stockModel;
