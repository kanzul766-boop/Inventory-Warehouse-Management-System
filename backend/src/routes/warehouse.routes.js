import express from "express";
import {
    createWarehouse,
    deleteWarehouse,
    getWarehouse,
    getWarehouses,
    updateWarehouse
} from "../controllers/warehouse.controller.js";
import { authenticateToken, requireAdmin, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
const requireWarehouseReadRole = requireRole(
    "admin",
    "warehouseManager",
    "supplier",
    "salesRepresentative"
);

router.get("/", authenticateToken, requireWarehouseReadRole, getWarehouses);
router.get("/:warehouseId", authenticateToken, requireWarehouseReadRole, getWarehouse);
router.post("/", authenticateToken, requireAdmin, createWarehouse);
router.put("/:warehouseId", authenticateToken, requireAdmin, updateWarehouse);
router.patch("/:warehouseId", authenticateToken, requireAdmin, updateWarehouse);
router.delete("/:warehouseId", authenticateToken, requireAdmin, deleteWarehouse);

export default router;
