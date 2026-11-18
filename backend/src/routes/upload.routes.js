import express from "express";
import { getUploadAuth } from "../controllers/upload.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.get(
    "/auth",
    authenticateToken,
    requireRole("admin", "warehouseManager", "supplier", "salesRepresentative"),
    getUploadAuth
);

export default router;
