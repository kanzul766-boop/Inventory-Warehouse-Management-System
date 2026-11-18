import userModel from "../models/users.model.js";
import uploadFile, {
    deleteImageKitFile,
    verifyImageKitFile
} from "../../services/storage.service.js";

const LOGO_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
};

function sendError(res, action, error) {
    if (error?.status) {
        return res.status(error.status).json({ message: error.message });
    }
    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function safeSupplier(user) {
    return {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        companyName: user.companyName ?? null,
        logoUrl: user.logoUrl ?? null,
        logoFileId: user.logoFileId ?? null
    };
}

async function getSupplierProfile(req, res) {
    try {
        const supplier = await userModel.findById(req.user.id)
            .select("username email role companyName logoUrl logoFileId");
        if (!supplier) {
            return res.status(404).json({ message: "Supplier not found" });
        }
        return res.status(200).json({ supplier: safeSupplier(supplier) });
    } catch (error) {
        return sendError(res, "Fetch supplier profile", error);
    }
}

async function getSupplierOptions(req, res) {
    try {
        const suppliers = await userModel.find({ role: "supplier" })
            .select("_id username companyName")
            .sort({ companyName: 1, username: 1 })
            .lean();
        return res.status(200).json({
            suppliers: suppliers.map(supplier => ({
                id: supplier._id.toString(),
                username: supplier.username,
                companyName: supplier.companyName ?? null
            }))
        });
    } catch (error) {
        return sendError(res, "Fetch supplier options", error);
    }
}

async function updateSupplierProfile(req, res) {
    const companyName = req.body?.companyName;
    if (typeof companyName !== "string" || !companyName.trim() || companyName.trim().length > 200) {
        return res.status(400).json({ message: "Company name is required and must be 200 characters or fewer" });
    }
    if (req.file && !Object.prototype.hasOwnProperty.call(LOGO_EXTENSIONS, req.file.mimetype)) {
        return res.status(400).json({ message: "Logo must be a JPEG, PNG, WebP, or GIF image" });
    }
    if (
        (req.body?.logoUrl === undefined) !== (req.body?.logoFileId === undefined) ||
        (req.body?.logoUrl !== undefined &&
            (typeof req.body.logoUrl !== "string" ||
                typeof req.body.logoFileId !== "string" ||
                !req.body.logoUrl.trim() ||
                !req.body.logoFileId.trim())) ||
        (req.file && req.body?.logoFileId !== undefined)
    ) {
        return res.status(400).json({ message: "Provide a valid uploaded logo URL and file ID" });
    }

    try {
        const supplier = await userModel.findById(req.user.id);
        if (!supplier || supplier.role !== "supplier") {
            return res.status(404).json({ message: "Supplier not found" });
        }

        supplier.companyName = companyName.trim();
        const previousLogoFileId = supplier.logoFileId;
        if (req.file) {
            const upload = await uploadFile(
                req.file.buffer,
                `supplier-logo${LOGO_EXTENSIONS[req.file.mimetype]}`,
                "suppliers"
            );
            if (
                typeof upload?.url !== "string" ||
                !upload.url ||
                typeof upload.fileId !== "string" ||
                !upload.fileId
            ) {
                throw new Error("ImageKit did not return a logo URL");
            }
            supplier.logoUrl = upload.url;
            supplier.logoFileId = upload.fileId;
        } else if (req.body.logoFileId !== undefined) {
            const uploadedLogo = await verifyImageKitFile(
                req.body.logoFileId,
                req.body.logoUrl
            );
            supplier.logoUrl = uploadedLogo.url;
            supplier.logoFileId = uploadedLogo.fileId;
        }

        await supplier.save();
        if (
            supplier.logoFileId &&
            previousLogoFileId &&
            previousLogoFileId !== supplier.logoFileId
        ) {
            try {
                await deleteImageKitFile(previousLogoFileId);
            } catch (error) {
                console.error("Previous supplier logo cleanup failed:", error instanceof Error ? error.name : "UnknownError");
                return res.status(502).json({ message: "Profile saved, but the previous logo could not be removed" });
            }
        }
        return res.status(200).json({
            message: "Supplier profile updated",
            supplier: safeSupplier(supplier)
        });
    } catch (error) {
        return sendError(res, "Update supplier profile", error);
    }
}

export { getSupplierOptions, getSupplierProfile, updateSupplierProfile };
