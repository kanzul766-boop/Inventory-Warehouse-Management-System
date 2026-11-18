import express from "express";
import { getStockTransactions } from "../controllers/stock.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.get("/", authenticateToken, requireRole("admin", "warehouseManager"), getStockTransactions);

export default router;
