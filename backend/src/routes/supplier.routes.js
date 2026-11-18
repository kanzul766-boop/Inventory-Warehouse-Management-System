import express from "express";
import {
    getSupplierOptions,
    getSupplierProfile,
    updateSupplierProfile
} from "../controllers/supplier.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/upload.middleware.js";

const router = express.Router();

router.get("/", authenticateToken, requireRole("admin", "warehouseManager"), getSupplierOptions);
router.get("/profile", authenticateToken, requireRole("supplier"), getSupplierProfile);
router.put("/profile", authenticateToken, requireRole("supplier"), upload.single("logo"), updateSupplierProfile);

export default router;
