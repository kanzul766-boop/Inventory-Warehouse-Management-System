import jwt from "jsonwebtoken";
import userModel, { USER_ROLES } from "../models/users.model.js";
import { JWT_SECRET } from "../config/env.js";

export async function authenticateToken(req, res, next) {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ message: "Authentication required" });
    }

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
        return next(error);
    }

    if (
        !payload ||
        typeof payload !== "object" ||
        typeof payload.id !== "string" ||
        typeof payload.exp !== "number"
    ) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }

    try {
        const user = await userModel.findById(payload.id).select("_id role").lean();
        if (!user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
        if (!USER_ROLES.includes(user.role)) {
            return res.status(403).json({ message: "Account role is not authorized" });
        }

        req.user = { id: user._id.toString(), role: user.role };
        return next();
    } catch (error) {
        console.error(
            "Authentication lookup failed:",
            error instanceof Error ? error.name : "UnknownError"
        );
        return res.status(503).json({ message: "Authentication service unavailable" });
    }
}

export function requireRole(...roles) {
    if (roles.some(role => !USER_ROLES.includes(role))) {
        throw new Error("requireRole received an unsupported role");
    }

    return function authorizeRole(req, res, next) {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: "Forbidden" });
        }
        return next();
    };
}

export const requireAdmin = requireRole("admin");
