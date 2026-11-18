import mongoose from "mongoose";
import productModel from "../models/products.model.js";
import supplyRequestModel from "../models/supply-requests.model.js";
import warehouseModel from "../models/warehouses.model.js";

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
        return res.status(409).json({ message: "Conflicting supply request; retry the operation" });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function populateSupplyRequest(query) {
    return query
        .populate("supplier", "username email companyName logoUrl")
        .populate("product", "name desc image price")
        .populate("warehouse", "name code")
        .populate("reviewedBy", "username email");
}

async function createSupplyRequest(req, res) {
    const { supplierId, productId, warehouseId, quantity, note } = req.body ?? {};
    if (supplierId !== undefined && supplierId !== req.user.id) {
        return res.status(403).json({ message: "A supplier may only submit requests for their own account" });
    }
    if (
        typeof productId !== "string" ||
        !mongoose.Types.ObjectId.isValid(productId) ||
        typeof warehouseId !== "string" ||
        !mongoose.Types.ObjectId.isValid(warehouseId)
    ) {
        return res.status(400).json({ message: "Valid productId and warehouseId are required" });
    }
    const requestedQuantity = typeof quantity === "number" ? quantity : Number(quantity);
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
        return res.status(400).json({ message: "Quantity must be a positive integer" });
    }
    if (note !== undefined && (typeof note !== "string" || note.trim().length > 500)) {
        return res.status(400).json({ message: "Note must be 500 characters or fewer" });
    }

    try {
        const [product, warehouse] = await Promise.all([
            productModel.findById(productId).select("_id supplier"),
            warehouseModel.findById(warehouseId).select("_id")
        ]);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        if (product.supplier?.toString() !== req.user.id) {
            return res.status(403).json({ message: "You may only request supply for your own products" });
        }
        if (!warehouse) {
            return res.status(404).json({ message: "Warehouse not found" });
        }

        const [supplyRequest] = await supplyRequestModel.create([{
            supplier: req.user.id,
            product: productId,
            warehouse: warehouseId,
            quantity: requestedQuantity,
            status: "Pending",
            note: typeof note === "string" ? note.trim() : undefined
        }]);
        const populatedRequest = await populateSupplyRequest(
            supplyRequestModel.findById(supplyRequest._id)
        );
        return res.status(201).json({
            message: "Supply request submitted",
            supplyRequest: populatedRequest
        });
    } catch (error) {
        return sendError(res, "Create supply request", error);
    }
}

async function getSupplyRequests(req, res) {
    const filter = req.user.role === "admin" ? {} : { supplier: req.user.id };
    try {
        const supplyRequests = await populateSupplyRequest(
            supplyRequestModel.find(filter).sort({ createdAt: -1 })
        );
        return res.status(200).json({ supplyRequests });
    } catch (error) {
        return sendError(res, "Fetch supply requests", error);
    }
}

async function updateSupplyRequestStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid supply request ID" });
    }
    if (!["Approved", "Rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be Approved or Rejected" });
    }

    try {
        const supplyRequest = await supplyRequestModel.findOneAndUpdate(
            { _id: id, status: "Pending" },
            { $set: { status, reviewedBy: req.user.id, reviewedAt: new Date() } },
            { new: true, runValidators: true }
        );
        if (!supplyRequest) {
            const existing = await supplyRequestModel.exists({ _id: id });
            if (!existing) {
                return res.status(404).json({ message: "Supply request not found" });
            }
            throw apiError(409, "Only pending supply requests can be reviewed");
        }

        const populatedRequest = await populateSupplyRequest(
            supplyRequestModel.findById(supplyRequest._id)
        );
        return res.status(200).json({
            message: `Supply request ${status.toLowerCase()}`,
            supplyRequest: populatedRequest
        });
    } catch (error) {
        return sendError(res, "Update supply request", error);
    }
}

export { createSupplyRequest, getSupplyRequests, updateSupplyRequestStatus };
