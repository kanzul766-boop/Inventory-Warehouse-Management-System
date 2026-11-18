import express from "express";
import {
    createSupplyRequest,
    getSupplyRequests,
    updateSupplyRequestStatus
} from "../controllers/supply-request.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.use(authenticateToken);

router.post("/", requireRole("supplier"), createSupplyRequest);
router.get("/", requireRole("supplier", "admin"), getSupplyRequests);
router.put("/:id/status", requireRole("admin"), updateSupplyRequestStatus);

export default router;
