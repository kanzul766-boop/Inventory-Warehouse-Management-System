const API_BASE = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isForm = options.body instanceof FormData;
  if (options.body && !isForm && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    options = { ...options, body: JSON.stringify(options.body) };
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new Error("Unable to reach the server. Check your connection and try again.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      (typeof payload === "string" && payload.trim()) ||
      `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function listFrom(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of [...keys, "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

export function entityId(value) {
  if (value && typeof value === "object") {
    return value._id || value.id || value.value || "";
  }
  return value ?? "";
}

export function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    return value.name || value.username || value.email || value.companyName || entityId(value) || "—";
  }
  return String(value);
}

export function errorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}
