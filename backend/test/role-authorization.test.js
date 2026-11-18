import assert from "node:assert/strict";
import { after, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/role-authorization-test";
process.env.JWT_SECRET = "role-authorization-test-secret-with-at-least-32-bytes";
process.env.IMAGEKIT_PRIVATE_KEY = "test-imagekit-private-key";
process.env.IMAGEKIT_PUBLIC_KEY = "";
process.env.IMAGEKIT_URL_ENDPOINT = "";
process.env.FRONTEND_ORIGIN = "";

const [
  { default: app },
  { default: userModel },
  { default: productModel },
  { default: warehouseModel },
  { default: stockModel },
  { default: supplyRequestModel },
  { default: orderModel },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/models/users.model.js"),
  import("../src/models/products.model.js"),
  import("../src/models/warehouses.model.js"),
  import("../src/models/stocks.model.js"),
  import("../src/models/supply-requests.model.js"),
  import("../src/models/orders.model.js"),
]);

const roles = ["admin", "warehouseManager", "supplier", "salesRepresentative"];
const userIds = Object.fromEntries(
  [...roles, "otherSupplier", "otherSales", "otherManager"]
    .map((role) => [role, new mongoose.Types.ObjectId().toString()]),
);
const roleForId = new Map([
  ...roles.map((role) => [userIds[role], role]),
  [userIds.otherSupplier, "supplier"],
  [userIds.otherSales, "salesRepresentative"],
  [userIds.otherManager, "warehouseManager"],
]);

function query(value) {
  return {
    select() { return this; },
    lean() { return Promise.resolve(value); },
    populate() { return this; },
    sort() { return this; },
    distinct() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

const modelMethods = [
  [userModel, ["find", "findById"]],
  [productModel, ["find", "findById"]],
  [warehouseModel, ["find", "findById", "findOne", "exists"]],
  [stockModel, ["find"]],
  [supplyRequestModel, ["find", "create"]],
  [orderModel, ["find", "findOne"]],
];
const originals = modelMethods.flatMap(([model, methods]) =>
  methods.map((method) => [model, method, model[method]]),
);

userModel.findById = (id) => query(
  roleForId.get(String(id))
    ? { _id: id, role: roleForId.get(String(id)) }
    : null,
);

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(path, role, options = {}) {
  const token = jwt.sign(
    { id: userIds[role], role },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: 60 },
  );
  const headers = new Headers(options.headers || {});
  headers.set("Cookie", `token=${token}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

test("admin can reach user and resource management while other roles are denied", async (t) => {
  userModel.find = () => query([]);
  productModel.find = () => query([]);
  warehouseModel.find = () => query([]);

  await t.test("admin can list users and resource options", async () => {
    for (const path of ["/api/users", "/api/products", "/api/warehouses", "/api/suppliers"]) {
      const response = await request(path, "admin");
      assert.equal(response.status, 200, path);
    }
  });

  await t.test("non-admin management requests return 403", async () => {
    for (const role of ["warehouseManager", "supplier", "salesRepresentative"]) {
      for (const [path, method] of [["/api/users", "GET"], ["/api/warehouses", "POST"]]) {
        const response = await request(path, role, {
          method,
          ...(method === "GET" ? {} : { body: {} }),
        });
        assert.equal(response.status, 403, `${role} ${method} ${path}`);
      }
    }
    for (const role of ["supplier", "salesRepresentative"]) {
      const response = await request("/api/products", role, { method: "POST", body: {} });
      assert.equal(response.status, 403, `${role} cannot create products`);
      assert.equal((await request("/api/suppliers", role)).status, 403);
    }
    userModel.find = () => query([{
      _id: new mongoose.Types.ObjectId(userIds.supplier),
      username: "test-supplier",
      companyName: "Test Company",
      email: "private@example.test",
      password: "hash-must-not-leak",
    }]);
    const suppliersResponse = await request("/api/suppliers", "warehouseManager");
    assert.equal(suppliersResponse.status, 200);
    assert.deepEqual(await suppliersResponse.json(), {
      suppliers: [{
        id: userIds.supplier,
        username: "test-supplier",
        companyName: "Test Company",
      }],
    });
  });

  await t.test("admin and warehouse manager can reach product validation", async () => {
    const warehouseResponse = await request("/api/warehouses", "admin", {
      method: "POST",
      body: {},
    });
    const productResponse = await request("/api/products", "admin", {
      method: "POST",
      body: {},
    });
    const managerCreateResponse = await request("/api/products", "warehouseManager", {
      method: "POST",
      body: {},
    });
    const managerUpdateResponse = await request(
      "/api/products/not-an-object-id",
      "warehouseManager",
      { method: "PUT", body: { name: "Manager product update" } },
    );
    const legacyManagerCreateResponse = await request("/api/product/create", "warehouseManager", {
      method: "POST",
      body: {},
    });
    const legacyManagerUpdateResponse = await request(
      "/api/product/not-an-object-id",
      "warehouseManager",
      { method: "PATCH", body: { name: "Manager product update" } },
    );
    assert.equal(warehouseResponse.status, 400);
    assert.equal(productResponse.status, 400);
    assert.equal(managerCreateResponse.status, 400);
    assert.equal(managerUpdateResponse.status, 400);
    assert.equal(legacyManagerCreateResponse.status, 400);
    assert.equal(legacyManagerUpdateResponse.status, 400);
  });

  await t.test("product deletion remains admin-only", async () => {
    const productId = new mongoose.Types.ObjectId().toString();
    const response = await request(`/api/products/${productId}`, "warehouseManager", {
      method: "DELETE",
    });
    assert.equal(response.status, 403);
    assert.equal(
      (await request(`/api/product/${productId}`, "warehouseManager", { method: "DELETE" })).status,
      403,
    );
  });
});

test("warehouse manager product and warehouse queries are assignment-scoped", async (t) => {
  const warehouseId = new mongoose.Types.ObjectId().toString();
  let assignmentFilter;
  warehouseModel.exists = (filter) => {
    assignmentFilter = filter;
    return Promise.resolve(null);
  };

  await t.test("product availability in an unassigned warehouse returns 403", async () => {
    const response = await request(
      `/api/products?warehouseId=${warehouseId}&available=true`,
      "warehouseManager",
    );
    assert.equal(response.status, 403);
    assert.deepEqual(assignmentFilter._id, warehouseId);
    assert.deepEqual(assignmentFilter.$or, [
      { managers: userIds.warehouseManager },
      { manager: userIds.warehouseManager },
    ]);
  });

  await t.test("warehouse list is filtered and direct unassigned lookup returns 403", async () => {
    let warehouseListFilter;
    warehouseModel.find = (filter) => {
      warehouseListFilter = filter;
      return query([]);
    };
    const listResponse = await request("/api/warehouses", "warehouseManager");
    assert.equal(listResponse.status, 200);
    assert.deepEqual(warehouseListFilter.$or, [
      { managers: userIds.warehouseManager },
      { manager: userIds.warehouseManager },
    ]);

    warehouseModel.findById = () => query({
      _id: warehouseId,
      managers: [userIds.otherManager],
      manager: userIds.otherManager,
    });
    const detailResponse = await request(`/api/warehouses/${warehouseId}`, "warehouseManager");
    assert.equal(detailResponse.status, 403);
  });

  await t.test("stock and transaction reads reject unassigned warehouse filters", async () => {
    let warehouseAccessFilter;
    warehouseModel.findOne = (filter) => {
      warehouseAccessFilter = filter;
      return query(null);
    };

    for (const path of [
      `/api/stock?warehouseId=${warehouseId}`,
      `/api/stock/low?warehouseId=${warehouseId}`,
      `/api/transactions?warehouseId=${warehouseId}`,
    ]) {
      const response = await request(path, "warehouseManager");
      assert.equal(response.status, 403, path);
      assert.deepEqual(warehouseAccessFilter.$or, [
        { managers: userIds.warehouseManager },
        { manager: userIds.warehouseManager },
      ]);
    }
  });

  await t.test("manager order list is restricted to assigned warehouses", async () => {
    warehouseModel.find = () => ({
      distinct: () => Promise.resolve([warehouseId]),
    });
    let orderListFilter;
    orderModel.find = (filter) => {
      orderListFilter = filter;
      return query([]);
    };
    const response = await request("/api/orders", "warehouseManager");
    assert.equal(response.status, 200);
    assert.deepEqual(orderListFilter, { warehouse: { $in: [warehouseId] } });
  });
});

test("supplier product and supply-request APIs are scoped to the current supplier", async (t) => {
  let productFilter;
  productModel.find = (filter) => {
    productFilter = filter;
    return query([]);
  };
  let supplyRequestFilter;
  supplyRequestModel.find = (filter) => {
    supplyRequestFilter = filter;
    return query([]);
  };

  await t.test("catalog and requests use the supplier's own ID", async () => {
    assert.equal((await request("/api/products", "supplier")).status, 200);
    assert.equal(productFilter.supplier, userIds.supplier);

    assert.equal((await request("/api/supply-requests", "supplier")).status, 200);
    assert.deepEqual(supplyRequestFilter, { supplier: userIds.supplier });
  });

  await t.test("foreign product detail is concealed and foreign product supply is forbidden", async () => {
    const productId = new mongoose.Types.ObjectId().toString();
    const warehouseId = new mongoose.Types.ObjectId().toString();
    productModel.findById = () => query({
      _id: productId,
      supplier: { _id: userIds.otherSupplier },
    });
    assert.equal((await request(`/api/products/${productId}`, "supplier")).status, 404);

    productModel.findById = () => query({ _id: productId, supplier: userIds.otherSupplier });
    warehouseModel.findById = () => query({ _id: warehouseId });
    const response = await request("/api/supply-requests", "supplier", {
      method: "POST",
      body: { productId, warehouseId, quantity: 1 },
    });
    assert.equal(response.status, 403);
  });

  await t.test("supplier cannot review requests or access order APIs", async () => {
    const requestId = new mongoose.Types.ObjectId().toString();
    const reviewResponse = await request(`/api/supply-requests/${requestId}/status`, "supplier", {
      method: "PUT",
      body: { status: "Approved" },
    });
    const ordersResponse = await request("/api/orders", "supplier");
    assert.equal(reviewResponse.status, 403);
    assert.equal(ordersResponse.status, 403);
  });
});

test("sales representatives only query their own orders and cannot process them", async (t) => {
  let orderFilter;
  orderModel.find = (filter) => {
    orderFilter = filter;
    return query([]);
  };

  await t.test("order list is filtered by creator ID", async () => {
    assert.equal((await request("/api/orders", "salesRepresentative")).status, 200);
    assert.deepEqual(orderFilter, { createdBy: userIds.salesRepresentative });
  });

  await t.test("foreign order lookup is concealed and processing returns 403", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();
    let detailFilter;
    orderModel.findOne = (filter) => {
      detailFilter = filter;
      return query(null);
    };
    const detailResponse = await request(`/api/orders/${orderId}`, "salesRepresentative");
    assert.equal(detailResponse.status, 404);
    assert.deepEqual(detailFilter, {
      _id: orderId,
      createdBy: userIds.salesRepresentative,
    });

    const statusResponse = await request(`/api/orders/${orderId}/status`, "salesRepresentative", {
      method: "PUT",
      body: { status: "Processing" },
    });
    assert.equal(statusResponse.status, 403);
  });
});

after(async () => {
  for (const [model, method, original] of originals) model[method] = original;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});
