import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DUMMYJSON_URL = "https://dummyjson.com/products?limit=30";
const PRODUCT_COUNT = 30;
const MAX_DESCRIPTION_LENGTH = 2000;

function seedError(code) {
    return Object.assign(new Error(), { code });
}

function normalizeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const url = new URL(value.trim());
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

export function mapDummyJsonProduct(product, adminId) {
    if (
        !product ||
        !Number.isSafeInteger(product.id) ||
        product.id < 1 ||
        typeof adminId !== "string" ||
        !adminId.trim()
    ) {
        throw seedError("INVALID_PRODUCT");
    }

    const name = typeof product.title === "string" ? product.title.trim() : "";
    const description = typeof product.description === "string"
        ? product.description.trim()
        : "";
    const category = typeof product.category === "string"
        ? product.category.trim()
        : "";
    const price = product.price;
    const image = normalizeImageUrl(product.thumbnail) ||
        (Array.isArray(product.images)
            ? product.images.map(normalizeImageUrl).find(Boolean)
            : "");

    if (
        !name ||
        name.length > 150 ||
        !description ||
        description.length > MAX_DESCRIPTION_LENGTH ||
        !category ||
        category.length > 100 ||
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price < 0 ||
        !image
    ) {
        throw seedError("INVALID_PRODUCT");
    }

    return {
        image,
        imageUrl: image,
        name,
        desc: description,
        description,
        sku: `DUMMYJSON-${product.id}`,
        category,
        price,
        lowStockLimit: 10,
        admin: adminId.trim(),
        createdBy: adminId.trim()
    };
}

export async function fetchDummyJsonProducts(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
        throw seedError("FETCH_UNAVAILABLE");
    }

    const response = await fetchImpl(DUMMYJSON_URL, {
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
        throw seedError("SOURCE_UNAVAILABLE");
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.products) || payload.products.length !== PRODUCT_COUNT) {
        throw seedError("INVALID_SOURCE_RESPONSE");
    }
    return payload.products;
}

export async function insertProductsIfMissing(products, productModel) {
    let imported = 0;
    let skipped = 0;

    for (const product of products) {
        try {
            const result = await productModel.updateOne(
                { sku: product.sku },
                { $setOnInsert: product },
                { upsert: true, runValidators: true }
            );
            if (result.upsertedCount === 1) imported += 1;
            else skipped += 1;
        } catch (error) {
            if (error?.code === 11000) {
                skipped += 1;
                continue;
            }
            throw error;
        }
    }

    return { imported, skipped };
}

function isDirectExecution() {
    return process.argv[1] &&
        pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

async function seedProducts() {
    const externalProducts = await fetchDummyJsonProducts();
    const [
        { default: mongoose },
        { default: connectDB },
        { default: productModel },
        { default: userModel }
    ] = await Promise.all([
        import("mongoose"),
        import("../src/db/db.js"),
        import("../src/models/products.model.js"),
        import("../src/models/users.model.js")
    ]);

    await connectDB();
    try {
        const admin = await userModel.findOne({ role: "admin" }).select("_id").lean();
        if (!admin) throw seedError("ADMIN_REQUIRED");

        const products = externalProducts.map((product) =>
            mapDummyJsonProduct(product, String(admin._id))
        );
        const { imported, skipped } = await insertProductsIfMissing(products, productModel);
        console.log(`Fetched ${externalProducts.length}; imported ${imported}; skipped duplicates ${skipped}.`);
    } finally {
        await mongoose.disconnect();
    }
}

if (isDirectExecution()) {
    try {
        await seedProducts();
    } catch (error) {
        const messages = {
            ADMIN_REQUIRED: "Seed refused: an existing admin account is required for product ownership.",
            FETCH_UNAVAILABLE: "Seed failed: this Node.js runtime does not provide fetch.",
            SOURCE_UNAVAILABLE: "Seed failed: DummyJSON did not return a successful response.",
            INVALID_SOURCE_RESPONSE: "Seed failed: DummyJSON did not return exactly 30 products.",
            INVALID_PRODUCT: "Seed failed: a fetched product is missing valid required fields.",
            ABORT_ERR: "Seed failed: the DummyJSON request timed out.",
            ECONNREFUSED: "Seed failed: the database is unavailable.",
            ENOTFOUND: "Seed failed: the database host could not be resolved."
        };
        console.error(messages[error?.code] ?? "Seed failed. Check backend configuration and database availability.");
        process.exitCode = 1;
    }
}
