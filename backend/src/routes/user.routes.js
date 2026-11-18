import express from "express";
import { deleteUser, getUsers, updateUser } from "../controllers/user.controller.js";
import { authenticateToken, requireAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get("/", getUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
