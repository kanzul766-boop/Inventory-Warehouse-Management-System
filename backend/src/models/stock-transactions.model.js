import mongoose from "mongoose";

const stockTransactionSchema = new mongoose.Schema({
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
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "order"
    },
    type: {
        type: String,
        enum: ["in", "out"],
        required: true
    },
    transactionType: {
        type: String,
        enum: ["stock-in", "stock-out"]
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger
    },
    balanceAfter: {
        type: Number,
        required: true,
        min: 0,
        validate: Number.isSafeInteger
    },
    note: {
        type: String,
        trim: true,
        maxlength: 500
    },
    date: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

stockTransactionSchema.pre("validate", function() {
    if (!this.type && this.transactionType) {
        this.type = this.transactionType === "stock-in" ? "in" : "out";
    }
    if (!this.transactionType && this.type) {
        this.transactionType = this.type === "in" ? "stock-in" : "stock-out";
    }
    if (!this.date) this.date = this.createdAt ?? new Date();
});

stockTransactionSchema.index({ warehouse: 1, product: 1, createdAt: -1 });

const stockTransactionModel = mongoose.model("stockTransaction", stockTransactionSchema);
export default stockTransactionModel;
