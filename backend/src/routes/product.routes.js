import express from "express";
import { createProduct, deleteProduct, getProduct, getProducts, updateProduct } from "../controllers/product.controller.js";
const router = express.Router();
import { authenticateToken, requireAdmin, requireRole } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/upload.middleware.js";
router.use(authenticateToken);
const canManageProducts = requireRole("admin", "warehouseManager");
router.post("/create", canManageProducts, upload.single("image"), createProduct);
router.patch("/:productId", canManageProducts, upload.single("image"), updateProduct);
router.delete("/:productId", requireAdmin, deleteProduct);
router.get("/:productId", getProduct);
router.get("/",getProducts);

export default router;