import express from "express";
import {
    createUserByAdmin,
    getCurrentUser,
    loginUser,
    logoutUser,
    registerUser,
    updateCurrentUser
} from "../controllers/auth.controller.js";
import { authenticateToken, requireRole } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.get("/me", authenticateToken, getCurrentUser);
router.put("/me", authenticateToken, updateCurrentUser);
router.post("/users", authenticateToken, requireRole("admin"), createUserByAdmin);

export default router;