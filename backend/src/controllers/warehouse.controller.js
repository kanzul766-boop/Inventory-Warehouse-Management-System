import mongoose from "mongoose";
import userModel from "../models/users.model.js";
import warehouseModel from "../models/warehouses.model.js";
import stockModel from "../models/stocks.model.js";
import stockTransactionModel from "../models/stock-transactions.model.js";
import orderModel from "../models/orders.model.js";
import supplyRequestModel from "../models/supply-requests.model.js";
import { randomUUID } from "node:crypto";

const WAREHOUSE_FIELDS = new Set([
    "name", "code", "address", "location", "manager", "managers", "capacity"
]);

function sendError(res, action, error) {
    if (error?.code === 11000) {
        return res.status(409).json({ message: "Warehouse code already exists" });
    }
    if (error?.status) {
        return res.status(error.status).json({ message: error.message });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function validText(value, maxLength) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

async function validateManagers(managerIds, managerId) {
    if (!Array.isArray(managerIds)) {
        return { error: "Managers must be an array of user IDs" };
    }

    const allIds = managerId ? [...managerIds, managerId] : managerIds;
    if (allIds.some(id => typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id))) {
        return { error: "One or more manager IDs are invalid" };
    }

    const uniqueIds = [...new Set(allIds.map(id => id.toLowerCase()))];
    const managers = await userModel.find({
        _id: { $in: uniqueIds },
        role: "warehouseManager"
    }).select("_id").lean();

    if (managers.length !== uniqueIds.length) {
        return { error: "Every assigned user must have the warehouseManager role" };
    }

    return { managers: uniqueIds };
}

function managerIdsFor(warehouse) {
    return [...new Set([
        ...(warehouse.managers ?? []).map(id => id.toString()),
        ...(warehouse.manager ? [warehouse.manager.toString()] : [])
    ])];
}

async function syncAssignments(warehouseId, previousIds, nextIds) {
    const next = new Set(nextIds);
    const previous = new Set(previousIds);
    const removed = [...previous].filter(id => !next.has(id));
    const added = [...next].filter(id => !previous.has(id));
    const updates = [];
    if (removed.length) {
        updates.push(userModel.updateMany(
            { _id: { $in: removed } },
            { $pull: { assignedWarehouses: warehouseId } }
        ));
    }
    if (added.length) {
        updates.push(userModel.updateMany(
            { _id: { $in: added }, role: "warehouseManager" },
            { $addToSet: { assignedWarehouses: warehouseId } }
        ));
    }
    await Promise.all(updates);
}

function populateManagers(query) {
    return query
        .populate("manager", "username name email role")
        .populate("managers", "username name email role");
}

async function createWarehouse(req, res) {
    const body = req.body ?? {};
    const { name, code, managers = [], manager, capacity } = body;
    const location = body.location ?? body.address;
    if (!validText(name, 100) || !validText(location, 500) || (code !== undefined && !validText(code, 30))) {
        return res.status(400).json({ message: "Name and location are required; code must be valid when supplied" });
    }
    if (capacity !== undefined && (!Number.isSafeInteger(Number(capacity)) || Number(capacity) < 0)) {
        return res.status(400).json({ message: "Capacity must be a nonnegative integer" });
    }

    try {
        const managerValidation = await validateManagers(managers, manager);
        if (managerValidation.error) {
            return res.status(400).json({ message: managerValidation.error });
        }

        const codeValue = code?.trim().toUpperCase() || `WH-${randomUUID().slice(0, 8).toUpperCase()}`;
        const primaryManager = manager ?? managerValidation.managers[0];
        const warehouse = await warehouseModel.create({
            name: name.trim(),
            code: codeValue,
            address: location.trim(),
            location: location.trim(),
            manager: primaryManager,
            capacity: capacity === undefined ? undefined : Number(capacity),
            managers: managerValidation.managers
        });
        await syncAssignments(warehouse._id, [], managerValidation.managers);
        const populatedWarehouse = await populateManagers(
            warehouseModel.findById(warehouse._id)
        );

        return res.status(201).json({ message: "Warehouse created", warehouse: populatedWarehouse });
    } catch (error) {
        return sendError(res, "Create warehouse", error);
    }
}

async function getWarehouses(req, res) {
    try {
        const filter = req.user?.role === "warehouseManager"
            ? { $or: [{ managers: req.user.id }, { manager: req.user.id }] }
            : {};
        const warehouses = await populateManagers(warehouseModel.find(filter).sort({ name: 1 }));
        return res.status(200).json({ warehouses });
    } catch (error) {
        return sendError(res, "Fetch warehouses", error);
    }
}

async function getWarehouse(req, res) {
    const { warehouseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    try {
        const warehouse = await populateManagers(warehouseModel.findById(warehouseId));
        if (!warehouse) {
            return res.status(404).json({ message: "Warehouse not found" });
        }
        if (
            req.user?.role === "warehouseManager" &&
            !managerIdsFor(warehouse).includes(req.user.id)
        ) {
            return res.status(403).json({ message: "You are not assigned to this warehouse" });
        }
        return res.status(200).json({ warehouse });
    } catch (error) {
        return sendError(res, "Fetch warehouse", error);
    }
}

async function updateWarehouse(req, res) {
    const { warehouseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const body = req.body ?? {};
    const fields = Object.keys(body);
    if (fields.length === 0 || fields.some(field => !WAREHOUSE_FIELDS.has(field))) {
        return res.status(400).json({ message: "Provide valid warehouse fields to update" });
    }

    if (
        (body.name !== undefined && !validText(body.name, 100)) ||
        (body.code !== undefined && !validText(body.code, 30)) ||
        (body.address !== undefined && !validText(body.address, 500)) ||
        (body.location !== undefined && !validText(body.location, 500)) ||
        (body.capacity !== undefined && (!Number.isSafeInteger(Number(body.capacity)) || Number(body.capacity) < 0)) ||
        (body.manager !== undefined && (typeof body.manager !== "string" || !mongoose.Types.ObjectId.isValid(body.manager)))
    ) {
        return res.status(400).json({ message: "Warehouse fields are invalid" });
    }

    try {
        const warehouse = await warehouseModel.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({ message: "Warehouse not found" });
        }

        const previousManagerIds = managerIdsFor(warehouse);
        if (body.name !== undefined) warehouse.name = body.name.trim();
        if (body.code !== undefined) warehouse.code = body.code.trim().toUpperCase();
        if (body.address !== undefined || body.location !== undefined) {
            const location = (body.location ?? body.address).trim();
            warehouse.address = location;
            warehouse.location = location;
        }
        if (body.capacity !== undefined) warehouse.capacity = Number(body.capacity);
        if (body.managers !== undefined || body.manager !== undefined) {
            const requestedManagers = body.managers ?? (body.manager ? [body.manager] : []);
            const managerValidation = await validateManagers(requestedManagers, body.manager);
            if (managerValidation.error) {
                return res.status(400).json({ message: managerValidation.error });
            }
            warehouse.managers = managerValidation.managers;
            warehouse.manager = body.manager ?? managerValidation.managers[0];
        }

        await warehouse.save();
        await syncAssignments(warehouse._id, previousManagerIds, managerIdsFor(warehouse));
        const populatedWarehouse = await populateManagers(
            warehouseModel.findById(warehouse._id)
        );
        return res.status(200).json({ message: "Warehouse updated", warehouse: populatedWarehouse });
    } catch (error) {
        return sendError(res, "Update warehouse", error);
    }
}

async function deleteWarehouse(req, res) {
    const { warehouseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    try {
        const warehouse = await warehouseModel.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({ message: "Warehouse not found" });
        }

        const [hasStock, hasHistory, hasOrders, hasSupplyRequests] = await Promise.all([
            stockModel.exists({ warehouse: warehouseId }),
            stockTransactionModel.exists({ warehouse: warehouseId }),
            orderModel.exists({ warehouse: warehouseId }),
            supplyRequestModel.exists({ warehouse: warehouseId })
        ]);
        if (hasStock || hasHistory || hasOrders || hasSupplyRequests) {
            return res.status(409).json({ message: "Warehouse with stock or related history cannot be deleted" });
        }

        await warehouse.deleteOne();
        await syncAssignments(warehouse._id, managerIdsFor(warehouse), []);
        return res.status(200).json({ message: "Warehouse deleted" });
    } catch (error) {
        return sendError(res, "Delete warehouse", error);
    }
}

export {
    createWarehouse,
    getWarehouses,
    getWarehouse,
    updateWarehouse,
    deleteWarehouse
};
