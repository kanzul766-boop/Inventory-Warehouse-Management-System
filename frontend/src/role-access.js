import { entityId } from "./api.js";

export const ROLE_PAGES = {
  admin: [
    ["dashboard", "Overview", "⌂"],
    ["users", "Users", "♙"],
    ["products", "Products", "▦"],
    ["warehouses", "Warehouses", "▤"],
    ["suppliers", "Suppliers", "♧"],
    ["transactions", "Transactions", "↔"],
    ["orders", "All orders", "▣"],
    ["supplyRequests", "Supply requests", "⇧"],
    ["lowStock", "Low stock", "⚑"],
    ["profile", "My profile", "♙"],
  ],
  warehouseManager: [
    ["dashboard", "Overview", "⌂"],
    ["products", "Products", "▦"],
    ["inventory", "My inventory", "▦"],
    ["stockHistory", "Stock history", "↔"],
    ["lowStock", "Low stock", "⚑"],
    ["orders", "Orders", "▣"],
    ["profile", "My profile", "♙"],
  ],
  supplier: [
    ["dashboard", "Overview", "⌂"],
    ["supplierProfile", "Company profile", "♙"],
    ["supplierProducts", "My products", "▦"],
    ["supplierRequests", "Supply requests", "⇧"],
    ["profile", "My profile", "♙"],
  ],
  salesRepresentative: [
    ["dashboard", "Overview", "⌂"],
    ["catalog", "Product catalog", "▦"],
    ["myOrders", "My orders", "▣"],
    ["profile", "My profile", "♙"],
  ],
};

export function roleKey(role = "") {
  const value = String(role).replace(/[\s_-]/g, "").toLowerCase();
  if (value === "admin" || value === "administrator") return "admin";
  if (value === "supplier") return "supplier";
  if (value === "warehousmanager" || value === "warehousemanager") return "warehouseManager";
  if (value === "salesrepresentative" || value === "salesrep") return "salesRepresentative";
  return "";
}

export function canAccessPage(role, page) {
  return Boolean(ROLE_PAGES[role]?.some(([key]) => key === page));
}

export function isOwnedBy(record, ownerField, user) {
  const ownerId = entityId(record?.[ownerField]);
  const userId = entityId(user);
  return Boolean(ownerId && userId && String(ownerId) === String(userId));
}

export function isWarehouseAssigned(warehouse, user) {
  const userId = entityId(user);
  if (!userId) return false;

  const managers = [
    ...(Array.isArray(warehouse?.managers)
      ? warehouse.managers
      : warehouse?.managers ? [warehouse.managers] : []),
    ...(warehouse?.manager ? [warehouse.manager] : []),
  ];
  return managers.some((manager) => String(entityId(manager)) === String(userId));
}
