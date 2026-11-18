import userModel, { USER_ROLES } from "../models/users.model.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { FRONTEND_ORIGIN, JWT_EXPIRES_IN_SECONDS, JWT_SECRET } from "../config/env.js";
import { deleteImageKitFile, verifyImageKitFile } from "../../services/storage.service.js";

const SALT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const crossOriginFrontend = Boolean(FRONTEND_ORIGIN);
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || crossOriginFrontend,
    sameSite: crossOriginFrontend ? "none" : "lax",
    path: "/",
    maxAge: JWT_EXPIRES_IN_SECONDS * 1000
};

function validateCredentials(body) {
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body?.name === "string" && body.name.trim()
        ? body.name.trim()
        : username;
    const phone = body?.phone;
    const password = body?.password;

    if (!username || username.length > 50) {
        return { error: "Username is required and must be 50 characters or fewer" };
    }
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        return { error: "A valid email is required" };
    }
    if (name.length > 100) {
        return { error: "Name must be 100 characters or fewer" };
    }
    if (phone !== undefined && (
        typeof phone !== "string" ||
        phone.trim().length === 0 ||
        phone.trim().length > 30
    )) {
        return { error: "Phone must be 30 characters or fewer" };
    }
    if (
        typeof password !== "string" ||
        Buffer.byteLength(password, "utf8") < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return { error: "Password must be between 8 and 72 bytes" };
    }

    return {
        credentials: {
            username,
            name,
            email,
            password,
            ...(phone === undefined ? {} : { phone: phone.trim() })
        }
    };
}

function safeUser(user) {
    return {
        id: user._id.toString(),
        name: user.name ?? user.username,
        username: user.username,
        email: user.email,
        role: user.role,
        phone: user.phone ?? null,
        image: user.image ?? null,
        imageFileId: user.imageFileId ?? null,
        companyName: user.companyName ?? null,
        logoUrl: user.logoUrl ?? null,
        logoFileId: user.logoFileId ?? null,
        assignedWarehouses: (user.assignedWarehouses ?? []).map(id => id.toString())
    };
}

function issueToken(user, res) {
    const token = jwt.sign(
        { id: user._id.toString(), role: user.role },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: JWT_EXPIRES_IN_SECONDS }
    );
    res.cookie("token", token, cookieOptions);
}

async function createUser(credentials, role) {
    const existingUser = await userModel.findOne({
        $or: [
            { username: credentials.username },
            { email: credentials.email }
        ]
    }).select("_id");

    if (existingUser) {
        return null;
    }

    const password = await bcrypt.hash(credentials.password, SALT_ROUNDS);
    return userModel.create({ ...credentials, password, role });
}

function isDuplicateKeyError(error) {
    return error?.code === 11000;
}

function reportAuthFailure(action, error, res) {
    if (isDuplicateKeyError(error)) {
        return res.status(409).json({ message: "Username or email is already in use" });
    }

    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

async function registerUser(req, res) {
    const validation = validateCredentials(req.body);
    if (validation.error) {
        return res.status(400).json({ message: validation.error });
    }

    try {
        const user = await createUser(validation.credentials, "salesRepresentative");
        if (!user) {
            return res.status(409).json({ message: "Username or email is already in use" });
        }

        issueToken(user, res);
        return res.status(201).json({
            message: "User created successfully",
            user: safeUser(user)
        });
    } catch (error) {
        return reportAuthFailure("Registration", error, res);
    }
}

async function createUserByAdmin(req, res) {
    const validation = validateCredentials(req.body);
    if (validation.error) {
        return res.status(400).json({ message: validation.error });
    }

    const { role } = req.body;
    if (!USER_ROLES.includes(role)) {
        return res.status(400).json({ message: "A valid user role is required" });
    }

    try {
        const user = await createUser(validation.credentials, role);
        if (!user) {
            return res.status(409).json({ message: "Username or email is already in use" });
        }

        return res.status(201).json({
            message: "User created successfully",
            user: safeUser(user)
        });
    } catch (error) {
        return reportAuthFailure("Admin user creation", error, res);
    }
}

async function loginUser(req, res) {
    const { username, email, password } = req.body ?? {};
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (
        (!normalizedUsername && !normalizedEmail) ||
        (username !== undefined && (typeof username !== "string" || !normalizedUsername)) ||
        (email !== undefined && (
            typeof email !== "string" ||
            !EMAIL_PATTERN.test(normalizedEmail) ||
            normalizedEmail.length > 254
        )) ||
        typeof password !== "string" ||
        password.length === 0 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return res.status(400).json({
            message: "A username or valid email and password are required"
        });
    }

    const identityFilters = [];
    if (normalizedUsername) {
        identityFilters.push({ username: normalizedUsername });
    }
    if (normalizedEmail) {
        identityFilters.push({ email: normalizedEmail });
    }

    try {
        const user = await userModel.findOne({ $or: identityFilters }).select("+password");
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Invalid username/email or password" });
        }

        issueToken(user, res);
        return res.status(200).json({
            message: "User logged in successfully",
            user: safeUser(user)
        });
    } catch (error) {
        return reportAuthFailure("Login", error, res);
    }
}

async function getCurrentUser(req, res) {
    try {
        const user = await userModel.findById(req.user.id)
            .select("_id name username email role phone image imageFileId companyName logoUrl logoFileId assignedWarehouses");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.status(200).json({ user: safeUser(user) });
    } catch (error) {
        console.error("Fetch current user failed:", error instanceof Error ? error.name : "UnknownError");
        return res.status(500).json({ message: "Internal server error" });
    }
}

async function updateCurrentUser(req, res) {
    const body = req.body ?? {};
    const allowedFields = new Set(["name", "phone", "imageUrl", "imageFileId"]);
    const fields = Object.keys(body);
    if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        fields.length === 0 ||
        fields.some(field => !allowedFields.has(field))
    ) {
        return res.status(400).json({ message: "Provide valid profile fields to update" });
    }
    if (
        (body.name !== undefined &&
            (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)) ||
        (body.phone !== undefined &&
            (typeof body.phone !== "string" || body.phone.trim().length > 30)) ||
        ((body.imageUrl === undefined) !== (body.imageFileId === undefined))
    ) {
        return res.status(400).json({ message: "Profile fields are invalid" });
    }

    try {
        const user = await userModel.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        let uploadedImage;
        if (body.imageUrl !== undefined) {
            uploadedImage = await verifyImageKitFile(body.imageFileId, body.imageUrl);
        }

        const previousImageFileId = user.imageFileId;
        if (body.name !== undefined) user.name = body.name.trim();
        if (body.phone !== undefined) user.phone = body.phone.trim();
        if (uploadedImage) {
            user.image = uploadedImage.url;
            user.imageFileId = uploadedImage.fileId;
        }
        await user.save();

        if (uploadedImage && previousImageFileId && previousImageFileId !== uploadedImage.fileId) {
            try {
                await deleteImageKitFile(previousImageFileId);
            } catch (error) {
                console.error("Previous profile image cleanup failed:", error instanceof Error ? error.name : "UnknownError");
                return res.status(502).json({ message: "Profile saved, but the previous image could not be removed" });
            }
        }

        return res.status(200).json({ message: "Profile updated", user: safeUser(user) });
    } catch (error) {
        if (error?.status === 400) {
            return res.status(400).json({ message: error.message });
        }
        console.error("Update current user failed:", error instanceof Error ? error.name : "UnknownError");
        return res.status(500).json({ message: "Internal server error" });
    }
}

function logoutUser(req, res) {
    const { maxAge, ...clearOptions } = cookieOptions;
    res.clearCookie("token", clearOptions);
    return res.status(200).json({ message: "Logged out successfully" });
}

export { registerUser, loginUser, createUserByAdmin, logoutUser, getCurrentUser, updateCurrentUser };
