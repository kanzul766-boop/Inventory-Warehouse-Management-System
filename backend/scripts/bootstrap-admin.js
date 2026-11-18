import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import userModel from "../src/models/users.model.js";

const SALT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getCredentials(env) {
    const username = typeof env.BOOTSTRAP_ADMIN_USERNAME === "string"
        ? env.BOOTSTRAP_ADMIN_USERNAME.trim()
        : "";
    const email = typeof env.BOOTSTRAP_ADMIN_EMAIL === "string"
        ? env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase()
        : "";
    const password = env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!username || username.length > 50) {
        throw Object.assign(new Error(), { code: "INVALID_USERNAME" });
    }
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        throw Object.assign(new Error(), { code: "INVALID_EMAIL" });
    }
    if (
        typeof password !== "string" ||
        Buffer.byteLength(password, "utf8") < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        throw Object.assign(new Error(), { code: "INVALID_PASSWORD" });
    }

    return { username, email, password };
}

export async function bootstrapAdmin(env = process.env) {
    const credentials = getCredentials(env);
    const { default: connectDB } = await import("../src/db/db.js");

    try {
        await connectDB();

        const existingAdmin = await userModel.exists({ role: "admin" });
        if (existingAdmin) {
            throw Object.assign(new Error(), { code: "ADMIN_EXISTS" });
        }

        const existingAccount = await userModel.exists({
            $or: [
                { username: credentials.username },
                { email: credentials.email }
            ]
        });
        if (existingAccount) {
            throw Object.assign(new Error(), { code: "ACCOUNT_EXISTS" });
        }

        const password = await bcrypt.hash(credentials.password, SALT_ROUNDS);
        await userModel.create({
            username: credentials.username,
            email: credentials.email,
            password,
            role: "admin"
        });
    } finally {
        await mongoose.disconnect();
    }
}

function isDirectExecution() {
    return process.argv[1] &&
        pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
    try {
        await bootstrapAdmin();
        console.log("Bootstrap admin account created.");
    } catch (error) {
        const messages = {
            INVALID_USERNAME: "Bootstrap refused: provide a username of 1–50 characters.",
            INVALID_EMAIL: "Bootstrap refused: provide a valid email address.",
            INVALID_PASSWORD: "Bootstrap refused: password must be 8–72 UTF-8 bytes.",
            ADMIN_EXISTS: "Bootstrap refused: an admin account already exists.",
            ACCOUNT_EXISTS: "Bootstrap refused: the supplied username or email is already in use.",
            11000: "Bootstrap refused: the supplied username or email is already in use."
        };
        console.error(messages[error?.code] ?? "Bootstrap failed. Check the backend configuration and database availability.");
        process.exitCode = 1;
    }
}
