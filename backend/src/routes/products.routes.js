import express from "express";
import {
    createProduct,
    deleteProduct,
    getProduct,
    getProducts,
    updateProduct
} from "../controllers/product.controller.js";
import { authenticateToken, requireAdmin, requireRole } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/upload.middleware.js";

const router = express.Router();
const canManageProducts = requireRole("admin", "warehouseManager");
router.use(authenticateToken);

router.get("/", getProducts);
router.get("/:id", getProduct);
router.post("/", canManageProducts, upload.single("image"), createProduct);
router.put("/:id", canManageProducts, upload.single("image"), updateProduct);
router.delete("/:id", requireAdmin, deleteProduct);

export default router;
