import mongoose from "mongoose";
import productModel from "../models/products.model.js";
import userModel from "../models/users.model.js";
import warehouseModel from "../models/warehouses.model.js";
import stockModel from "../models/stocks.model.js";
import stockTransactionModel from "../models/stock-transactions.model.js";
import orderModel from "../models/orders.model.js";
import supplyRequestModel from "../models/supply-requests.model.js";
import uploadFile, {
    deleteImageKitFile,
    verifyImageKitFile
} from "../../services/storage.service.js";

const EMAIL_SAFE_FIELDS = "username name email role";
const PRODUCT_POPULATE = [
    { path: "createdBy", select: EMAIL_SAFE_FIELDS },
    { path: "admin", select: EMAIL_SAFE_FIELDS },
    { path: "supplier", select: "username name email companyName logoUrl" }
];

function sendError(action, error, res) {
    if (error?.status) {
        return res.status(error.status).json({ message: error.message });
    }
    if (error?.code === 11000) {
        return res.status(409).json({ message: "Product SKU, username, or email is already in use" });
    }
    console.error(`${action} failed:`, error instanceof Error ? error.name : "UnknownError");
    return res.status(500).json({ message: "Internal server error" });
}

function parseProductFields(body, { creating = false, requireCatalogFields = false } = {}) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string"
        ? body.description.trim()
        : typeof body.desc === "string" ? body.desc.trim() : "";
    const price = body.price === undefined || String(body.price).trim() === ""
        ? undefined
        : Number(body.price);
    const lowStockLimit = body.lowStockLimit === undefined
        ? (creating ? 10 : undefined)
        : String(body.lowStockLimit).trim() === "" ? undefined : Number(body.lowStockLimit);
    const sku = typeof body.sku === "string" ? body.sku.trim().toUpperCase() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";

    if (
        (creating || body.name !== undefined) &&
        (!name || name.length > 150)
    ) {
        return { error: "Product name is required and must be 150 characters or fewer" };
    }
    if (
        (creating || body.description !== undefined || body.desc !== undefined) &&
        (!description || description.length > 2000)
    ) {
        return { error: "Product description is required and must be 2000 characters or fewer" };
    }
    if (
        (creating || body.price !== undefined) &&
        (!Number.isFinite(price) || price < 0)
    ) {
        return { error: "Price must be a nonnegative number" };
    }
    if (
        (creating || body.lowStockLimit !== undefined) &&
        (!Number.isSafeInteger(lowStockLimit) || lowStockLimit < 0)
    ) {
        return { error: "Low-stock limit must be a nonnegative integer" };
    }
    if (
        (requireCatalogFields || body.sku !== undefined) &&
        (!sku || sku.length > 64)
    ) {
        return { error: "SKU is required and must be 64 characters or fewer" };
    }
    if (
        (requireCatalogFields || body.category !== undefined) &&
        (!category || category.length > 100)
    ) {
        return { error: "Category is required and must be 100 characters or fewer" };
    }
    if (body.supplier !== undefined && body.supplier !== "" && !mongoose.Types.ObjectId.isValid(body.supplier)) {
        return { error: "Supplier must be a valid user ID" };
    }

    return {
        fields: {
            ...(body.name === undefined && !creating ? {} : { name }),
            ...(body.description === undefined && body.desc === undefined && !creating
                ? {}
                : { desc: description, description }),
            ...(body.price === undefined && !creating ? {} : { price }),
            ...(body.lowStockLimit === undefined && !creating ? {} : { lowStockLimit }),
            ...(body.sku === undefined && !requireCatalogFields ? {} : { sku }),
            ...(body.category === undefined && !requireCatalogFields ? {} : { category }),
            ...(body.supplier === undefined
                ? {}
                : { supplier: body.supplier === "" ? undefined : body.supplier })
        }
    };
}

async function validateSupplier(supplierId) {
    if (!supplierId) return true;
    return Boolean(await userModel.exists({ _id: supplierId, role: "supplier" }));
}

async function getUploadedImage(req) {
    if (req.file) {
        const uploaded = await uploadFile(req.file.buffer, req.file.originalname);
        if (!uploaded?.fileId || !uploaded?.url) {
            throw Object.assign(new Error("ImageKit did not return an image asset"), { status: 502 });
        }
        return { fileId: uploaded.fileId, url: uploaded.url };
    }
    return verifyImageKitFile(req.body?.imageFileId, req.body?.imageUrl);
}

async function populateProduct(query) {
    return query.populate(PRODUCT_POPULATE);
}

async function createProduct(req, res) {
    const parsed = parseProductFields(req.body ?? {}, {
        creating: true,
        requireCatalogFields: req.baseUrl === "/api/products"
    });
    if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
    }
    if (!req.file && (!req.body?.imageFileId || !req.body?.imageUrl)) {
        return res.status(400).json({ message: "Upload a product image through ImageKit" });
    }

    try {
        if (parsed.fields.supplier && !(await validateSupplier(parsed.fields.supplier))) {
            return res.status(400).json({ message: "Supplier must reference a supplier account" });
        }
        const image = await getUploadedImage(req);
        const product = await productModel.create({
            ...parsed.fields,
            image: image.url,
            imageUrl: image.url,
            imageFileId: image.fileId,
            admin: req.user.id,
            createdBy: req.user.id
        });
        const populatedProduct = await populateProduct(productModel.findById(product._id));
        return res.status(201).json({ message: "Product added", product: populatedProduct });
    } catch (error) {
        return sendError("Create product", error, res);
    }
}

async function getProducts(req, res) {
    const filter = {};
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
            { name: { $regex: escaped, $options: "i" } },
            { desc: { $regex: escaped, $options: "i" } },
            { sku: { $regex: escaped, $options: "i" } }
        ];
    }
    if (category) filter.category = category;
    if (req.user?.role === "supplier") {
        filter.supplier = req.user.id;
    } else if (req.query.supplierId !== undefined) {
        if (!mongoose.Types.ObjectId.isValid(req.query.supplierId)) {
            return res.status(400).json({ message: "Invalid supplier ID" });
        }
        filter.supplier = req.query.supplierId;
    }

    try {
        if (req.query.warehouseId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(req.query.warehouseId)) {
                return res.status(400).json({ message: "Invalid warehouse ID" });
            }
            if (req.user?.role === "warehouseManager") {
                const assignedWarehouse = await warehouseModel.exists({
                    _id: req.query.warehouseId,
                    $or: [{ managers: req.user.id }, { manager: req.user.id }]
                });
                if (!assignedWarehouse) {
                    return res.status(403).json({ message: "You are not assigned to this warehouse" });
                }
            }
            const stocks = await stockModel.find({ warehouse: req.query.warehouseId })
                .select("product quantity")
                .lean();
            if (req.query.available === "true") {
                filter._id = { $in: stocks.filter(item => item.quantity > 0).map(item => item.product) };
            } else if (req.query.available === "false") {
                filter._id = { $in: stocks.filter(item => item.quantity <= 0).map(item => item.product) };
            }
        }
        const products = await populateProduct(productModel.find(filter).sort({ name: 1 }));
        return res.status(200).json({ message: "Products fetched successfully", products });
    } catch (error) {
        return sendError("Fetch products", error, res);
    }
}

async function getProduct(req, res) {
    const id = req.params.id ?? req.params.productId;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
    }
    try {
        const product = await populateProduct(productModel.findById(id));
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        if (req.user?.role === "supplier" && product.supplier?._id.toString() !== req.user.id) {
            return res.status(404).json({ message: "Product not found" });
        }
        return res.status(200).json({ product });
    } catch (error) {
        return sendError("Fetch product", error, res);
    }
}

async function updateProduct(req, res) {
    const id = req.params.id ?? req.params.productId;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
    }
    const body = req.body ?? {};
    const allowed = new Set([
        "name", "description", "desc", "sku", "category", "price",
        "lowStockLimit", "supplier", "imageUrl", "imageFileId"
    ]);
    const fields = Object.keys(body);
    if (fields.some(field => !allowed.has(field)) || (!fields.length && !req.file)) {
        return res.status(400).json({ message: "Provide valid product fields to update" });
    }
    const parsed = parseProductFields(body);
    if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
    }
    if ((body.imageUrl === undefined) !== (body.imageFileId === undefined)) {
        return res.status(400).json({ message: "Image URL and file ID must be provided together" });
    }

    try {
        if (parsed.fields.supplier && !(await validateSupplier(parsed.fields.supplier))) {
            return res.status(400).json({ message: "Supplier must reference a supplier account" });
        }
        const product = await productModel.findById(id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }

        const previousFileId = product.imageFileId;
        Object.assign(product, parsed.fields);
        let uploadedImage;
        if (req.file || body.imageFileId !== undefined) {
            uploadedImage = await getUploadedImage(req);
            product.image = uploadedImage.url;
            product.imageUrl = uploadedImage.url;
            product.imageFileId = uploadedImage.fileId;
        }
        await product.save();

        if (uploadedImage && previousFileId && previousFileId !== uploadedImage.fileId) {
            try {
                await deleteImageKitFile(previousFileId);
            } catch (error) {
                console.error("Previous product image cleanup failed:", error instanceof Error ? error.name : "UnknownError");
                return res.status(502).json({ message: "Product updated, but the previous image could not be removed" });
            }
        }
        const updatedProduct = await populateProduct(productModel.findById(product._id));
        return res.status(200).json({ message: "Product updated", product: updatedProduct });
    } catch (error) {
        return sendError("Update product", error, res);
    }
}

async function deleteProduct(req, res) {
    const id = req.params.id ?? req.params.productId;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
    }

    try {
        const product = await productModel.findById(id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        const [hasStock, hasHistory, hasOrders, hasSupplyRequests] = await Promise.all([
            stockModel.exists({ product: id }),
            stockTransactionModel.exists({ product: id }),
            orderModel.exists({ $or: [{ "items.product": id }, { "products.product": id }] }),
            supplyRequestModel.exists({ product: id })
        ]);
        if (hasStock || hasHistory || hasOrders || hasSupplyRequests) {
            return res.status(409).json({ message: "Product with stock or related history cannot be deleted" });
        }

        await userModel.updateMany(
            { "cart.product": id },
            { $pull: { cart: { product: id } } }
        );
        await product.deleteOne();
        if (product.imageFileId) {
            try {
                await deleteImageKitFile(product.imageFileId);
            } catch (error) {
                console.error("Deleted product image cleanup failed:", error instanceof Error ? error.name : "UnknownError");
                return res.status(502).json({ message: "Product deleted, but its ImageKit file could not be removed" });
            }
        }
        return res.status(200).json({ message: "Product deleted" });
    } catch (error) {
        return sendError("Delete product", error, res);
    }
}

export { createProduct, deleteProduct, getProduct, getProducts, updateProduct };
