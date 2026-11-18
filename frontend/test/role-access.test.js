import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessPage,
  isOwnedBy,
  isWarehouseAssigned,
  roleKey,
  ROLE_PAGES,
} from "../src/role-access.js";

test("each role is limited to its own dashboard pages", () => {
  const expectedPages = {
    admin: ["dashboard", "users", "products", "warehouses", "suppliers", "transactions", "orders", "supplyRequests", "lowStock", "profile"],
    warehouseManager: ["dashboard", "products", "inventory", "stockHistory", "lowStock", "orders", "profile"],
    supplier: ["dashboard", "supplierProfile", "supplierProducts", "supplierRequests", "profile"],
    salesRepresentative: ["dashboard", "catalog", "myOrders", "profile"],
  };

  for (const [role, pages] of Object.entries(expectedPages)) {
    assert.deepEqual(ROLE_PAGES[role].map(([page]) => page), pages);
    for (const page of pages) assert.equal(canAccessPage(role, page), true);
    for (const otherRole of Object.keys(expectedPages)) {
      if (otherRole === role) continue;
      for (const [page] of ROLE_PAGES[otherRole]) {
        if (!pages.includes(page)) assert.equal(canAccessPage(role, page), false);
      }
    }
  }
});

test("role normalization recognizes exactly the supported application roles", () => {
  assert.equal(roleKey("admin"), "admin");
  assert.equal(roleKey("warehouseManager"), "warehouseManager");
  assert.equal(roleKey("supplier"), "supplier");
  assert.equal(roleKey("salesRepresentative"), "salesRepresentative");
  assert.equal(roleKey("unknown"), "");
});

test("owner-scoped views fail closed for foreign or missing owners", () => {
  const user = { id: "supplier-a" };
  assert.equal(isOwnedBy({ supplier: { _id: "supplier-a" } }, "supplier", user), true);
  assert.equal(isOwnedBy({ supplier: "supplier-b" }, "supplier", user), false);
  assert.equal(isOwnedBy({ supplier: null }, "supplier", user), false);
  assert.equal(isOwnedBy({ createdBy: "sales-a" }, "createdBy", { id: "sales-a" }), true);
  assert.equal(isOwnedBy({}, "createdBy", { id: "sales-a" }), false);
});

test("warehouse visibility requires an explicit manager assignment", () => {
  const manager = { id: "manager-a" };
  assert.equal(isWarehouseAssigned({ managers: [{ _id: "manager-a" }] }, manager), true);
  assert.equal(isWarehouseAssigned({ manager: "manager-a", managers: [] }, manager), true);
  assert.equal(isWarehouseAssigned({ managers: [] }, manager), false);
  assert.equal(isWarehouseAssigned({}, manager), false);
});
