import mongoose from "mongoose";
import productModel from "../models/products.model.js";
import warehouseModel from "../models/warehouses.model.js";
import stockModel from "../models/stocks.model.js";
import stockTransactionModel from "../models/stock-transactions.model.js";

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

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
        return res.status(409).json({ message: "Concurrent stock update; retry the operation" });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function validateStockRequest(body) {
    const { warehouseId, productId, quantity, note } = body ?? {};
    const parsedQuantity = typeof quantity === "number" ? quantity : Number(quantity);

    if (!mongoose.Types.ObjectId.isValid(warehouseId) || !mongoose.Types.ObjectId.isValid(productId)) {
        return { error: "Valid warehouseId and productId are required" };
    }
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) {
        return { error: "Quantity must be a positive integer" };
    }
    if (note !== undefined && (typeof note !== "string" || note.trim().length > 500)) {
        return { error: "Note must be 500 characters or fewer" };
    }

    return {
        warehouseId,
        productId,
        quantity: parsedQuantity,
        note: typeof note === "string" ? note.trim() : undefined
    };
}

async function getWarehouseForUser(warehouseId, user, session) {
    let query = warehouseModel.findById(warehouseId).select("_id managers manager");
    if (session) query = query.session(session);
    const warehouse = await query.lean();

    if (!warehouse) {
        throw apiError(404, "Warehouse not found");
    }
    if (
        user.role === "warehouseManager" &&
        !(warehouse.managers ?? []).some(manager => manager.toString() === user.id) &&
        warehouse.manager?.toString() !== user.id
    ) {
        throw apiError(403, "You are not assigned to this warehouse");
    }
    return warehouse;
}

async function getStockFilter(req, res) {
    const warehouseId = req.query.warehouseId;
    if (warehouseId !== undefined && !mongoose.Types.ObjectId.isValid(warehouseId)) {
        res.status(400).json({ message: "Invalid warehouse ID" });
        return null;
    }

    if (req.user.role === "admin" || req.user.role === "salesRepresentative") {
        return warehouseId ? { warehouse: warehouseId } : {};
    }

    if (warehouseId) {
        const warehouse = await warehouseModel.findOne({
            _id: warehouseId,
            $or: [{ managers: req.user.id }, { manager: req.user.id }]
        }).select("_id").lean();
        if (!warehouse) {
            res.status(403).json({ message: "You are not assigned to this warehouse" });
            return null;
        }
        return { warehouse: warehouse._id };
    }

    const warehouseIds = await warehouseModel.find({
        $or: [{ managers: req.user.id }, { manager: req.user.id }]
    }).distinct("_id");
    return { warehouse: { $in: warehouseIds } };
}

async function getStock(req, res) {
    try {
        const filter = await getStockFilter(req, res);
        if (!filter) return;

        const stock = await stockModel.find(filter)
            .populate("warehouse", "name code")
            .populate("product", "name desc description image imageUrl sku category lowStockLimit")
            .sort({ updatedAt: -1 });
        return res.status(200).json({ stock });
    } catch (error) {
        return sendError(res, "Fetch stock", error);
    }
}

async function getLowStock(req, res) {
    const threshold = req.query.threshold === undefined
        ? null
        : Number(req.query.threshold);
    if (threshold !== null && (!Number.isSafeInteger(threshold) || threshold < 0)) {
        return res.status(400).json({ message: "Threshold must be a nonnegative integer" });
    }

    try {
        const filter = await getStockFilter(req, res);
        if (!filter) return;

        const rows = await stockModel.find(filter)
            .populate("warehouse", "name code")
            .populate("product", "name desc description image imageUrl sku category lowStockLimit")
            .sort({ quantity: 1 });
        const stock = rows.filter(item => {
            const limit = threshold ?? item.product?.lowStockLimit ?? DEFAULT_LOW_STOCK_THRESHOLD;
            return item.quantity <= limit;
        });
        return res.status(200).json({ threshold, stock });
    } catch (error) {
        return sendError(res, "Fetch low stock", error);
    }
}

async function getStockTransactions(req, res) {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ message: "Page must be positive and limit must be between 1 and 100" });
    }

    try {
        const filter = await getStockFilter(req, res);
        if (!filter) return;

        const [transactions, total] = await Promise.all([
            stockTransactionModel.find(filter)
                .populate("warehouse", "name code")
                .populate("product", "name desc image")
                .populate("performedBy", "username email")
                .populate("order", "status")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            stockTransactionModel.countDocuments(filter)
        ]);
        return res.status(200).json({ transactions, page, limit, total });
    } catch (error) {
        return sendError(res, "Fetch stock transactions", error);
    }
}

async function changeStock(req, res, type) {
    const input = validateStockRequest(req.body);
    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    let session;
    let stock;
    let transaction;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await getWarehouseForUser(input.warehouseId, req.user, session);

            const product = await productModel.findById(input.productId)
                .select("_id")
                .session(session)
                .lean();
            if (!product) {
                throw apiError(404, "Product not found");
            }

            if (type === "in") {
                stock = await stockModel.findOneAndUpdate(
                    { warehouse: input.warehouseId, product: input.productId },
                    { $inc: { quantity: input.quantity } },
                    {
                        new: true,
                        upsert: true,
                        setDefaultsOnInsert: true,
                        runValidators: true,
                        session
                    }
                );
            } else {
                stock = await stockModel.findOneAndUpdate(
                    {
                        warehouse: input.warehouseId,
                        product: input.productId,
                        quantity: { $gte: input.quantity }
                    },
                    { $inc: { quantity: -input.quantity } },
                    { new: true, runValidators: true, session }
                );
                if (!stock) {
                    throw apiError(409, "Insufficient stock");
                }
            }

            [transaction] = await stockTransactionModel.create([{
                warehouse: input.warehouseId,
                product: input.productId,
                performedBy: req.user.id,
                type,
                transactionType: type === "in" ? "stock-in" : "stock-out",
                quantity: input.quantity,
                balanceAfter: stock.quantity,
                note: input.note,
                date: new Date()
            }], { session });
        });

        const populatedStock = await stockModel.findById(stock._id)
            .populate("warehouse", "name code")
            .populate("product", "name desc description image imageUrl sku category lowStockLimit");
        return res.status(200).json({
            message: type === "in" ? "Stock added" : "Stock removed",
            stock: populatedStock,
            transaction
        });
    } catch (error) {
        return sendError(res, type === "in" ? "Stock in" : "Stock out", error);
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}

function stockIn(req, res) {
    return changeStock(req, res, "in");
}

function stockOut(req, res) {
    return changeStock(req, res, "out");
}

export { getStock, getLowStock, getStockTransactions, stockIn, stockOut };
