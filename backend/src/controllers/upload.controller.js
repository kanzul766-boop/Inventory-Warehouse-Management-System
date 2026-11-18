import { createHmac, randomUUID } from "node:crypto";
import {
    IMAGEKIT_PRIVATE_KEY,
    IMAGEKIT_PUBLIC_KEY,
    IMAGEKIT_URL_ENDPOINT
} from "../config/env.js";

function getUploadAuth(req, res) {
    res.set("Cache-Control", "no-store");
    if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_URL_ENDPOINT) {
        return res.status(503).json({ message: "ImageKit upload authentication is not configured" });
    }

    try {
        const token = randomUUID();
        const expire = Math.floor(Date.now() / 1000) + 10 * 60;
        const signature = createHmac("sha1", IMAGEKIT_PRIVATE_KEY)
            .update(token + expire)
            .digest("hex");

        return res.status(200).json({
            token,
            expire,
            signature,
            publicKey: IMAGEKIT_PUBLIC_KEY,
            urlEndpoint: IMAGEKIT_URL_ENDPOINT
        });
    } catch (error) {
        console.error("ImageKit upload authentication failed:", error instanceof Error ? error.name : "UnknownError");
        return res.status(500).json({ message: "Unable to generate ImageKit upload authentication" });
    }
}

export { getUploadAuth };
