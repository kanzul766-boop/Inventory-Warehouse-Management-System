import express from "express";
import {
    getLowStock,
    getStock,
    getStockTransactions,
    stockIn,
    stockOut
} from "../controllers/stock.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.use(authenticateToken);

router.get("/transactions", requireRole("admin", "warehouseManager"), getStockTransactions);
router.get("/low", requireRole("admin", "warehouseManager"), getLowStock);
router.get("/", requireRole("admin", "warehouseManager", "salesRepresentative"), getStock);
router.post("/in", requireRole("admin", "warehouseManager"), stockIn);
router.post("/out", requireRole("admin", "warehouseManager"), stockOut);

export default router;
