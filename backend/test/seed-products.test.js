import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchDummyJsonProducts,
  insertProductsIfMissing,
  mapDummyJsonProduct,
} from "../scripts/seed-products.js";

const sampleProduct = {
  id: 8,
  title: "Test item",
  description: "A sample description",
  category: "sample",
  price: 12.5,
  thumbnail: "https://cdn.dummyjson.com/product-images/8/thumbnail.jpg",
  images: [],
};

test("maps DummyJSON fields to the existing product schema without a fabricated ImageKit ID", () => {
  const product = mapDummyJsonProduct(sampleProduct, "existing-admin-id");

  assert.deepEqual(product, {
    image: sampleProduct.thumbnail,
    imageUrl: sampleProduct.thumbnail,
    name: sampleProduct.title,
    desc: sampleProduct.description,
    description: sampleProduct.description,
    sku: "DUMMYJSON-8",
    category: "sample",
    price: 12.5,
    lowStockLimit: 10,
    admin: "existing-admin-id",
    createdBy: "existing-admin-id",
  });
  assert.equal("imageFileId" in product, false);
  assert.equal("supplier" in product, false);
});

test("rejects incomplete or invalid external products before import", () => {
  assert.throws(
    () => mapDummyJsonProduct({ ...sampleProduct, thumbnail: "javascript:alert(1)" }, "admin-id"),
    { code: "INVALID_PRODUCT" },
  );
  assert.throws(
    () => mapDummyJsonProduct({ ...sampleProduct, price: null }, "admin-id"),
    { code: "INVALID_PRODUCT" },
  );
  assert.throws(
    () => mapDummyJsonProduct(sampleProduct, ""),
    { code: "INVALID_PRODUCT" },
  );
});

test("fetches exactly 30 products from DummyJSON", async () => {
  const products = Array.from({ length: 30 }, (_, index) => ({ id: index + 1 }));
  let requestedUrl = "";
  const result = await fetchDummyJsonProducts(async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ products }) };
  });

  assert.equal(requestedUrl, "https://dummyjson.com/products?limit=30");
  assert.equal(result.length, 30);
});

test("inserts only missing SKUs and leaves existing products untouched", async () => {
  const calls = [];
  const products = [
    { sku: "DUMMYJSON-1", name: "existing" },
    { sku: "DUMMYJSON-2", name: "new" },
  ];
  const result = await insertProductsIfMissing(products, {
    async updateOne(filter, update, options) {
      calls.push({ filter, update, options });
      return { upsertedCount: filter.sku === "DUMMYJSON-2" ? 1 : 0 };
    },
  });

  assert.deepEqual(result, { imported: 1, skipped: 1 });
  assert.deepEqual(calls.map(({ filter }) => filter), [
    { sku: "DUMMYJSON-1" },
    { sku: "DUMMYJSON-2" },
  ]);
  assert.ok(calls.every(({ update, options }) =>
    Object.keys(update).length === 1 &&
    "$setOnInsert" in update &&
    options.upsert === true &&
    options.runValidators === true
  ));
});

test("counts duplicate-key races as skipped without overwriting", async () => {
  const result = await insertProductsIfMissing(
    [{ sku: "DUMMYJSON-3", name: "new" }],
    { async updateOne() { throw Object.assign(new Error(), { code: 11000 }); } },
  );

  assert.deepEqual(result, { imported: 0, skipped: 1 });
});
