import ImageKit from '@imagekit/nodejs';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { IMAGEKIT_PRIVATE_KEY } from '../src/config/env.js';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const client = new ImageKit({
  privateKey: IMAGEKIT_PRIVATE_KEY
});

function getImageMimeType(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return "image/png";
    }
    if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
        return "image/gif";
    }
    if (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "image/webp";
    }
    return null;
}

function validateImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_SIZE) {
        throw Object.assign(new Error("Image must be no larger than 5 MB"), { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(getImageMimeType(buffer))) {
        throw Object.assign(new Error("Image must be JPEG, PNG, WebP, or GIF"), { status: 400 });
    }
}

async function requestImageKit(action, request, { notFoundIsInvalidInput = false } = {}) {
    try {
        return await request();
    } catch (error) {
        const status = error?.status === 404 && notFoundIsInvalidInput
            ? 400
            : error?.status === 429 ? 503 : 502;
        const message = status === 400
            ? "ImageKit file was not found"
            : `ImageKit ${action} failed`;
        console.error(`ImageKit ${action} failed:`, error instanceof Error ? error.name : "UnknownError");
        throw Object.assign(new Error(message), { status });
    }
}

async function uploadFile(buffer, originalName, folder = "products"){
    validateImageBuffer(buffer);
    const extension = extname(typeof originalName === "string" ? originalName : "").toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".jpg";
    return requestImageKit("upload", () => client.files.upload({
            file: buffer.toString("base64"),
            fileName: `image-${Date.now()}-${randomUUID()}${safeExtension}`,
            folder
        }));
}

async function verifyImageKitFile(fileId, submittedUrl) {
    if (typeof fileId !== "string" || !fileId.trim() || typeof submittedUrl !== "string") {
        throw Object.assign(new Error("A valid ImageKit file ID and URL are required"), { status: 400 });
    }

    const file = await requestImageKit(
        "file verification",
        () => client.files.get(fileId.trim()),
        { notFoundIsInvalidInput: true }
    );
    if (
        file.fileId !== fileId.trim() ||
        file.fileType !== "image" ||
        !ALLOWED_MIME_TYPES.has(file.mime) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > MAX_IMAGE_SIZE ||
        !file.url ||
        file.url !== submittedUrl
    ) {
        throw Object.assign(new Error("Uploaded file is not a valid supported image"), { status: 400 });
    }

    return { fileId: file.fileId, url: file.url };
}

async function deleteImageKitFile(fileId) {
    if (typeof fileId === "string" && fileId.trim()) {
        await requestImageKit("file deletion", () => client.files.delete(fileId.trim()));
    }
}

export { deleteImageKitFile, validateImageBuffer, verifyImageKitFile };
export default uploadFile;