import mongoose from "mongoose";
import userModel, { USER_ROLES } from "../models/users.model.js";
import warehouseModel from "../models/warehouses.model.js";
import productModel from "../models/products.model.js";
import stockTransactionModel from "../models/stock-transactions.model.js";
import orderModel from "../models/orders.model.js";
import supplyRequestModel from "../models/supply-requests.model.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATE_FIELDS = new Set(["name", "username", "email", "phone", "role"]);

function safeUser(user) {
    return {
        id: user._id.toString(),
        name: user.name ?? user.username,
        username: user.username,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        image: user.image ?? null,
        assignedWarehouses: (user.assignedWarehouses ?? []).map(id => id.toString()),
        companyName: user.companyName ?? null,
        logoUrl: user.logoUrl ?? null,
        logoFileId: user.logoFileId ?? null
    };
}

function handleUserError(action, error, res) {
    if (error?.code === 11000) {
        return res.status(409).json({ message: "Username or email is already in use" });
    }
    if (error instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({ message: "User fields are invalid" });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

async function getUsers(req, res) {
    try {
        const users = await userModel.find()
            .select("_id name username email role phone image assignedWarehouses companyName logoUrl logoFileId")
            .sort({ username: 1 })
            .lean();
        return res.status(200).json({ users: users.map(safeUser) });
    } catch (error) {
        return handleUserError("List users", error, res);
    }
}

async function updateUser(req, res) {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ message: "Provide valid user fields to update" });
    }

    const fields = Object.keys(body);
    if (fields.length === 0 || fields.some(field => !UPDATE_FIELDS.has(field))) {
        return res.status(400).json({ message: "Only username, email, and role may be updated" });
    }
    if (
        (body.username !== undefined &&
            (typeof body.username !== "string" ||
                !body.username.trim() ||
                body.username.trim().length > 50)) ||
        (body.name !== undefined &&
            (typeof body.name !== "string" ||
                !body.name.trim() ||
                body.name.trim().length > 100)) ||
        (body.email !== undefined &&
            (typeof body.email !== "string" ||
                body.email.trim().length > 254 ||
                !EMAIL_PATTERN.test(body.email.trim()))) ||
        (body.phone !== undefined &&
            (typeof body.phone !== "string" || body.phone.trim().length > 30)) ||
        (body.role !== undefined && !USER_ROLES.includes(body.role))
    ) {
        return res.status(400).json({ message: "User fields are invalid" });
    }

    try {
        const user = await userModel.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role === "warehouseManager" && body.role && body.role !== "warehouseManager") {
            const assignedWarehouse = await warehouseModel.exists({
                $or: [{ managers: user._id }, { manager: user._id }]
            });
            if (assignedWarehouse) {
                return res.status(409).json({
                    message: "Remove this manager from assigned warehouses before changing their role"
                });
            }
        }
        if (user.role === "admin" && body.role && body.role !== "admin") {
            const adminCount = await userModel.countDocuments({ role: "admin" });
            if (adminCount <= 1) {
                return res.status(409).json({ message: "The last admin account cannot be demoted" });
            }
        }

        if (body.name !== undefined) user.name = body.name.trim();
        if (body.username !== undefined) user.username = body.username.trim();
        if (body.email !== undefined) user.email = body.email.trim().toLowerCase();
        if (body.phone !== undefined) user.phone = body.phone.trim();
        if (body.role !== undefined) user.role = body.role;

        await user.save();
        return res.status(200).json({
            message: "User updated",
            user: safeUser(user)
        });
    } catch (error) {
        return handleUserError("Update user", error, res);
    }
}

async function deleteUser(req, res) {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
    }
    const userId = new mongoose.Types.ObjectId(id).toString();
    if (userId === req.user.id) {
        return res.status(400).json({ message: "You cannot delete your own account" });
    }

    try {
        const user = await userModel.findById(userId).select("_id role");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.role === "admin" && await userModel.countDocuments({ role: "admin" }) <= 1) {
            return res.status(409).json({ message: "The last admin account cannot be deleted" });
        }
        const [assignedWarehouse, linkedProduct, transaction, order, supplyRequest] = await Promise.all([
            warehouseModel.exists({ $or: [{ managers: userId }, { manager: userId }] }),
            productModel.exists({ $or: [{ supplier: userId }, { createdBy: userId }, { admin: userId }] }),
            stockTransactionModel.exists({ performedBy: userId }),
            orderModel.exists({ createdBy: userId }),
            supplyRequestModel.exists({ $or: [{ supplier: userId }, { reviewedBy: userId }] })
        ]);
        if (assignedWarehouse || linkedProduct || transaction || order || supplyRequest) {
            return res.status(409).json({
                message: "User has warehouse, catalog, order, stock, or supply history and cannot be deleted"
            });
        }
        await user.deleteOne();
        return res.status(200).json({ message: "User deleted" });
    } catch (error) {
        return handleUserError("Delete user", error, res);
    }
}

export { getUsers, updateUser, deleteUser };
