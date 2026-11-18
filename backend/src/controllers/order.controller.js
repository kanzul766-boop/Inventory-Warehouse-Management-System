import mongoose from "mongoose";
import orderModel from "../models/orders.model.js";
import productModel from "../models/products.model.js";
import stockModel from "../models/stocks.model.js";
import stockTransactionModel from "../models/stock-transactions.model.js";
import warehouseModel from "../models/warehouses.model.js";

const ORDER_STATUSES = ["Pending", "Processing", "Completed", "Cancelled"];
const STATUS_TRANSITIONS = {
    Processing: ["Completed"]
};

function apiError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sendError(res, action, error) {
    if (error?.status) {
        return res.status(error.status).json({ message: error.message });
    }
    if (error?.code === 11000) {
        return res.status(409).json({ message: "Conflicting order or stock update; retry the operation" });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function validId(id) {
    return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

function populateOrder(query) {
    return query
        .populate("createdBy", "username email role")
        .populate("warehouse", "name code")
        .populate("items.product", "name desc description image imageUrl sku category")
        .populate("products.product", "name desc description image imageUrl sku category");
}

function getOrderFilter(user) {
    if (user.role === "admin") {
        return Promise.resolve({});
    }
    if (user.role === "salesRepresentative") {
        return Promise.resolve({ createdBy: user.id });
    }
    if (user.role === "warehouseManager") {
        return warehouseModel.find({
            $or: [{ managers: user.id }, { manager: user.id }]
        })
            .distinct("_id")
            .then(warehouseIds => ({ warehouse: { $in: warehouseIds } }));
    }
    return Promise.reject(apiError(403, "Forbidden"));
}

function validateItems(items) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
        return { error: "An order must contain between 1 and 100 items" };
    }

    const quantities = new Map();
    for (const item of items) {
        const productId = item?.productId ?? item?.product;
        if (!validId(productId)) {
            return { error: "Every item must have a valid productId" };
        }
        const normalizedProductId = productId.toLowerCase();
        const quantity = typeof item.quantity === "number" ? item.quantity : Number(item.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            return { error: "Every item quantity must be a positive integer" };
        }

        const nextQuantity = (quantities.get(normalizedProductId) ?? 0) + quantity;
        if (!Number.isSafeInteger(nextQuantity)) {
            return { error: "Combined product quantity is too large" };
        }
        quantities.set(normalizedProductId, nextQuantity);
    }

    return { quantities };
}

async function createOrder(req, res) {
    const body = req.body ?? {};
    const { warehouseId, note, customerName, customerPhone } = body;
    const items = body.items ?? body.products;
    if (!validId(warehouseId)) {
        return res.status(400).json({ message: "A valid warehouseId is required" });
    }
    if (note !== undefined && (typeof note !== "string" || note.trim().length > 500)) {
        return res.status(400).json({ message: "Note must be 500 characters or fewer" });
    }
    if (
        typeof customerName !== "string" ||
        !customerName.trim() ||
        customerName.trim().length > 150 ||
        typeof customerPhone !== "string" ||
        !customerPhone.trim() ||
        customerPhone.trim().length > 30
    ) {
        return res.status(400).json({ message: "Valid customer name and phone are required" });
    }

    const itemValidation = validateItems(items);
    if (itemValidation.error) {
        return res.status(400).json({ message: itemValidation.error });
    }

    try {
        const warehouse = await warehouseModel.findById(warehouseId).select("_id");
        if (!warehouse) {
            return res.status(404).json({ message: "Warehouse not found" });
        }

        const productIds = [...itemValidation.quantities.keys()];
        const products = await productModel.find({ _id: { $in: productIds } })
            .select("_id name price")
            .lean();
        if (products.length !== productIds.length) {
            return res.status(404).json({ message: "One or more products were not found" });
        }

        const productById = new Map(products.map(product => [product._id.toString(), product]));
        const existingStock = await stockModel.find({
            warehouse: warehouseId,
            product: { $in: productIds }
        }).select("product quantity").lean();
        const availableByProduct = new Map(
            existingStock.map(row => [row.product.toString(), row.quantity])
        );
        for (const [productId, quantity] of itemValidation.quantities) {
            if ((availableByProduct.get(productId) ?? 0) < quantity) {
                return res.status(409).json({
                    message: `Insufficient stock for ${productById.get(productId).name}`
                });
            }
        }
        const orderItems = productIds.map(productId => {
            const product = productById.get(productId);
            return {
                product: product._id,
                productName: product.name,
                quantity: itemValidation.quantities.get(productId),
                unitPrice: product.price
            };
        });
        const orderProducts = orderItems.map(item => ({
            product: item.product,
            quantity: item.quantity,
            price: item.unitPrice
        }));
        const totalAmount = orderItems.reduce(
            (total, item) => total + item.quantity * item.unitPrice,
            0
        );
        if (!Number.isFinite(totalAmount)) {
            return res.status(400).json({ message: "Order total is invalid" });
        }

        const [order] = await orderModel.create([{
            createdBy: req.user.id,
            warehouse: warehouseId,
            customerName: typeof customerName === "string" ? customerName.trim() : undefined,
            customerPhone: typeof customerPhone === "string" ? customerPhone.trim() : undefined,
            items: orderItems,
            products: orderProducts,
            totalAmount,
            status: "Pending",
            note: typeof note === "string" ? note.trim() : undefined
        }]);
        const populatedOrder = await populateOrder(orderModel.findById(order._id));
        return res.status(201).json({ message: "Order created", order: populatedOrder });
    } catch (error) {
        return sendError(res, "Create order", error);
    }
}

async function getOrders(req, res) {
    try {
        const filter = await getOrderFilter(req.user);
        const orders = await populateOrder(orderModel.find(filter).sort({ createdAt: -1 }));
        return res.status(200).json({ orders });
    } catch (error) {
        return sendError(res, "Fetch orders", error);
    }
}

async function getOrder(req, res) {
    const { id } = req.params;
    if (!validId(id)) {
        return res.status(400).json({ message: "Invalid order ID" });
    }

    try {
        const filter = await getOrderFilter(req.user);
        const order = await populateOrder(orderModel.findOne({ _id: id, ...filter }));
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }
        return res.status(200).json({ order });
    } catch (error) {
        return sendError(res, "Fetch order", error);
    }
}

async function checkOrderManagerAccess(order, user, session) {
    if (user.role === "admin") return;
    const query = warehouseModel.exists({
        _id: order.warehouse,
        $or: [{ managers: user.id }, { manager: user.id }]
    }).session(session);
    if (!(await query)) {
        throw apiError(403, "You are not assigned to this order's warehouse");
    }
}

async function updateOrderStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!validId(id)) {
        return res.status(400).json({ message: "Invalid order ID" });
    }
    if (typeof status !== "string" || !ORDER_STATUSES.includes(status) || status === "Cancelled") {
        return res.status(400).json({ message: "Provide a valid non-cancellation order status" });
    }

    let session;
    let orderId;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const order = await orderModel.findById(id).session(session);
            if (!order) {
                throw apiError(404, "Order not found");
            }
            await checkOrderManagerAccess(order, req.user, session);

            if (order.status === "Pending" && status === "Processing") {
                for (const item of order.items) {
                    const stock = await stockModel.findOneAndUpdate(
                        {
                            warehouse: order.warehouse,
                            product: item.product,
                            quantity: { $gte: item.quantity }
                        },
                        { $inc: { quantity: -item.quantity } },
                        { new: true, runValidators: true, session }
                    );
                    if (!stock) {
                        throw apiError(409, `Insufficient stock for ${item.productName}`);
                    }

                    await stockTransactionModel.create([{
                        warehouse: order.warehouse,
                        product: item.product,
                        performedBy: req.user.id,
                        order: order._id,
                        type: "out",
                        transactionType: "stock-out",
                        quantity: item.quantity,
                        balanceAfter: stock.quantity,
                        note: `Order ${order.orderNumber} processing`,
                        date: new Date()
                    }], { session });
                }
                order.processedAt = new Date();
            } else if (!STATUS_TRANSITIONS[order.status]?.includes(status)) {
                throw apiError(409, `Cannot change order status from ${order.status} to ${status}`);
            }

            if (status === "Completed") order.completedAt = new Date();
            order.status = status;
            await order.save({ session });
            orderId = order._id;
        });

        const updatedOrder = await populateOrder(orderModel.findById(orderId));
        return res.status(200).json({ message: "Order status updated", order: updatedOrder });
    } catch (error) {
        return sendError(res, "Update order status", error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}

async function cancelOrder(req, res) {
    const { id } = req.params;
    if (!validId(id)) {
        return res.status(400).json({ message: "Invalid order ID" });
    }

    try {
        const filter = req.user.role === "admin"
            ? { _id: id }
            : { _id: id, createdBy: req.user.id };
        const order = await orderModel.findOne(filter);
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }
        if (order.status !== "Pending") {
            return res.status(409).json({ message: "Only pending orders can be cancelled" });
        }

        const cancelledOrder = await orderModel.findOneAndUpdate(
            { ...filter, status: "Pending" },
            { $set: { status: "Cancelled", cancelledAt: new Date() } },
            { new: true, runValidators: true }
        );
        if (!cancelledOrder) {
            return res.status(409).json({ message: "Order status changed; it can no longer be cancelled" });
        }

        const populatedOrder = await populateOrder(orderModel.findById(cancelledOrder._id));
        return res.status(200).json({ message: "Order cancelled", order: populatedOrder });
    } catch (error) {
        return sendError(res, "Cancel order", error);
    }
}

export { createOrder, getOrders, getOrder, updateOrderStatus, cancelOrder };
