import express from "express";
import {
    cancelOrder,
    createOrder,
    getOrder,
    getOrders,
    updateOrderStatus
} from "../controllers/order.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.use(authenticateToken);

router.post("/", requireRole("admin", "salesRepresentative"), createOrder);
router.get("/", requireRole("admin", "salesRepresentative", "warehouseManager"), getOrders);
router.get("/:id", requireRole("admin", "salesRepresentative", "warehouseManager"), getOrder);
router.put("/:id/status", requireRole("admin", "warehouseManager"), updateOrderStatus);
router.put("/:id/cancel", requireRole("admin", "salesRepresentative"), cancelOrder);

export default router;
