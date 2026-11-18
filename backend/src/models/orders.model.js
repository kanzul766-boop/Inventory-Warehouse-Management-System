import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const orderItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true
    },
    productName: {
        type: String,
        required: true,
        trim: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    }
}, { _id: false });

const orderProductSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger
    },
    price: {
        type: Number,
        required: true,
        min: 0
    }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        unique: true,
        sparse: true,
        trim: true
    },
    customerName: {
        type: String,
        trim: true,
        maxlength: 150
    },
    customerPhone: {
        type: String,
        trim: true,
        maxlength: 30
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    warehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "warehouse",
        required: true
    },
    items: {
        type: [orderItemSchema],
        required: true,
        validate: {
            validator: items => Array.isArray(items) && items.length > 0,
            message: "An order must contain at least one item"
        }
    },
    products: {
        type: [orderProductSchema],
        default: undefined
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ["Pending", "Processing", "Completed", "Shipped", "Delivered", "Cancelled"],
        default: "Pending",
        required: true
    },
    note: {
        type: String,
        trim: true,
        maxlength: 500
    },
    processedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    completedAt: Date,
    cancelledAt: Date
}, { timestamps: true });

orderSchema.pre("validate", function() {
    if (!this.orderNumber) {
        this.orderNumber = `ORD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    }
    if ((!this.items || this.items.length === 0) && this.products?.length) {
        this.items = this.products.map(item => ({
            product: item.product,
            productName: item.productName ?? "Product",
            quantity: item.quantity,
            unitPrice: item.price
        }));
    }
    if ((!this.products || this.products.length === 0) && this.items?.length) {
        this.products = this.items.map(item => ({
            product: item.product,
            quantity: item.quantity,
            price: item.unitPrice
        }));
    }
});

orderSchema.index({ createdBy: 1, createdAt: -1 });
orderSchema.index({ warehouse: 1, status: 1, createdAt: -1 });

const orderModel = mongoose.model("order", orderSchema);
export default orderModel;
