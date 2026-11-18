import { useCallback, useEffect, useMemo, useState } from "react";
import { api, displayValue, entityId, errorMessage, listFrom } from "./api.js";
import {
  canAccessPage,
  isOwnedBy,
  isWarehouseAssigned,
  ROLE_PAGES,
  roleKey,
} from "./role-access.js";

const ROLES = [
  ["admin", "Administrator"],
  ["warehouseManager", "Warehouse manager"],
  ["supplier", "Supplier"],
  ["salesRepresentative", "Sales representative"],
];

const PAGE_TITLES = Object.fromEntries(
  Object.values(ROLE_PAGES).flat().map(([key, title]) => [key, title]),
);

function currentUser(payload) {
  return payload?.user || payload?.data?.user || payload?.data || payload?.account || payload;
}

function objectKey(item) {
  return entityId(item?._id || item?.id);
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount)
    : "—";
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();
  if (["completed", "delivered", "approved", "active", "in"].includes(status)) return "good";
  if (["cancelled", "rejected", "out"].includes(status)) return "muted";
  if (["pending", "processing", "low"].includes(status)) return "warning";
  return "neutral";
}

function useRemote(path, keys = []) {
  const [state, setState] = useState({ data: [], loading: true, error: "" });
  const [reloadId, setReloadId] = useState(0);
  const reload = useCallback(() => setReloadId((id) => id + 1), []);

  useEffect(() => {
    let active = true;
    if (!path) {
      setState({ data: [], loading: false, error: "" });
      return () => { active = false; };
    }
    setState((old) => ({ ...old, loading: true, error: "" }));
    api(path)
      .then((payload) => {
        if (active) setState({ data: payload, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setState({ data: [], loading: false, error: errorMessage(error) });
      });
    return () => { active = false; };
  }, [path, reloadId]);

  return {
    ...state,
    reload,
    items: listFrom(state.data, keys),
  };
}

function useNotice() {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice];
}

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [notice, setNotice] = useNotice();
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    api("/api/auth/me")
      .then((payload) => {
        const foundUser = currentUser(payload);
        if (foundUser?.role) setUser(foundUser);
      })
      .catch((error) => {
        if (![401, 403, 404].includes(error.status)) setAuthError(errorMessage(error));
      })
      .finally(() => setChecking(false));
  }, []);

  const onAuthenticated = (payload) => {
    const foundUser = currentUser(payload);
    if (!foundUser?.role) {
      setAuthError("The server response did not include a valid user role.");
      return;
    }
    setUser(foundUser);
    setPage("dashboard");
    setAuthError("");
    setNotice({ type: "success", text: "Welcome back." });
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally {
      setUser(null);
      setPage("dashboard");
    }
  };

  if (checking) return <LoadingScreen label="Checking your session" />;
  if (!user) return <AuthScreen onAuthenticated={onAuthenticated} initialError={authError} />;

  const role = roleKey(user.role);
  if (!role) return <AccessDenied onLogout={logout} />;
  if (!canAccessPage(role, page)) {
    return <AccessDenied onLogout={logout} onHome={() => setPage("dashboard")} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        role={role}
        page={page}
        user={user}
        onNavigate={setPage}
        onLogout={logout}
      />
      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">S</span> Stockroom</div>
          <div className="breadcrumbs">Workspace <span>/</span> {PAGE_TITLES[page]}</div>
          <div className="topbar-user">
            <span className="avatar">{(user.username || user.email || "U").slice(0, 1).toUpperCase()}</span>
            <span className="topbar-user-copy"><b>{user.username || user.email}</b><small>{roleLabel(role)}</small></span>
          </div>
        </header>
        <div className="page-wrap">
          <PageRenderer
            page={page}
            role={role}
            user={user}
            onNavigate={setPage}
            onNotice={setNotice}
          />
        </div>
      </main>
      {notice && <div className={`toast ${notice.type}`} role="status">{notice.text}</div>}
    </div>
  );
}

function LoadingScreen({ label }) {
  return <div className="full-loading"><span className="spinner" />{label}…</div>;
}

function AuthScreen({ onAuthenticated, initialError }) {
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");

  useEffect(() => setError(initialError || ""), [initialError]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const identity = String(form.get(mode === "login" ? "identity" : "username") || "").trim();
    const username = mode === "register" ? identity : "";
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const loginByEmail = mode === "login" && identity.includes("@");
    if (
      !identity ||
      (mode === "register" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      (loginByEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity))
    ) {
      setError(mode === "register" ? "Enter a username and valid email address." : "Enter a username or valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mode === "register" && password !== form.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const payload = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: mode === "register"
          ? { username, email, password }
          : { [loginByEmail ? "email" : "username"]: identity, password },
      });
      onAuthenticated(payload);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-aside">
        <div className="auth-brand"><span className="brand-mark">S</span> Stockroom</div>
        <div className="auth-message">
          <span className="eyebrow">INVENTORY, IN SYNC</span>
          <h1>Everything in its right place.</h1>
          <p>One workspace for your products, warehouses, suppliers, and orders.</p>
          <div className="auth-art" aria-hidden="true">
            <div className="art-shelf"><i /><i /><i /><i /><i /><i /></div>
            <div className="art-box art-box-one" /><div className="art-box art-box-two" /><div className="art-box art-box-three" />
          </div>
        </div>
        <small className="auth-footer">A clearer view of your supply chain.</small>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <div className="mobile-auth-brand"><span className="brand-mark">S</span> Stockroom</div>
          <span className="eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</span>
          <h2>{mode === "login" ? "Sign in to your account" : "Create your account"}</h2>
          <p className="muted-copy">{mode === "login" ? "Enter your details to continue." : "Register as a sales representative."}</p>
          {error && <div className="inline-alert error" role="alert">{error}</div>}
          <form onSubmit={submit} className="form-stack">
            <label className="field"><span>{mode === "login" ? "Username or email" : "Username"}</span><input name={mode === "login" ? "identity" : "username"} autoComplete={mode === "login" ? "username" : "username"} required maxLength={mode === "login" ? 254 : 50} /></label>
            {mode === "register" && <label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
            <label className="field"><span>Password</span><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} maxLength={72} /></label>
            {mode === "register" && <label className="field"><span>Confirm password</span><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>}
            <button className="button primary full-button" type="submit" disabled={busy}>{busy ? <><span className="button-spinner" /> Please wait…</> : mode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <div className="auth-switch">
            {mode === "login" ? "New to Stockroom?" : "Already have an account?"}
            <button type="button" className="text-button" onClick={() => { setError(""); setMode(mode === "login" ? "register" : "login"); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>
          <p className="auth-cookie-note">Your sign-in is secured with an HttpOnly session cookie.</p>
        </div>
      </div>
    </div>
  );
}

function AccessDenied({ onLogout, onHome }) {
  return (
    <div className="access-page">
      <div className="access-card">
        <div className="access-icon">!</div>
        <span className="eyebrow">ACCESS RESTRICTED</span>
        <h1>This workspace isn’t available</h1>
        <p>Your account doesn’t have a supported role for this area. Contact an administrator if you think this is a mistake.</p>
        <div className="button-row center">
          {onHome && <button className="button primary" onClick={onHome}>Go to dashboard</button>}
          <button className="button secondary" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function roleLabel(role) {
  return ROLES.find(([key]) => key === role)?.[1] || "Team member";
}

function Sidebar({ role, page, user, onNavigate, onLogout }) {
  const [open, setOpen] = useState(false);
  const items = ROLE_PAGES[role] || [];
  const navTo = (key) => { onNavigate(key); setOpen(false); };
  return (
    <>
      <button className="mobile-menu-toggle" aria-label="Toggle navigation" onClick={() => setOpen(!open)}>☰</button>
      {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark">S</span><span>Stockroom<small>INVENTORY WORKSPACE</small></span></div>
        <div className="nav-section-label">MENU</div>
        <nav className="side-nav">
          {items.map(([key, label, icon]) => (
            <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => navTo(key)}>
              <span className="nav-icon">{icon}</span><span>{label}</span>
              {key === "lowStock" && <i className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-chip"><span className="avatar">{(user.username || user.email || "U").slice(0, 1).toUpperCase()}</span><div><b>{user.username || "Account"}</b><small>{roleLabel(role)}</small></div></div>
          <button className="nav-item signout" onClick={onLogout}><span className="nav-icon">↪</span><span>Sign out</span></button>
        </div>
      </aside>
    </>
  );
}

function PageHeading({ eyebrow = "WORKSPACE", title, description, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function PageRenderer({ page, role, user, onNavigate, onNotice }) {
  if (page === "dashboard") return <Dashboard role={role} user={user} onNavigate={onNavigate} />;
  if (page === "users") return <UsersPage onNotice={onNotice} />;
  if (page === "products") return <ProductsAdmin onNotice={onNotice} canDelete={role === "admin"} />;
  if (page === "warehouses") return <WarehousesPage onNotice={onNotice} />;
  if (page === "suppliers") return <SuppliersAdmin onNotice={onNotice} />;
  if (page === "transactions" || page === "stockHistory") return <TransactionsPage role={role} />;
  if (page === "orders" || page === "myOrders") return <OrdersPage role={role} user={user} onNotice={onNotice} />;
  if (page === "lowStock") return <LowStockPage />;
  if (page === "inventory") return <InventoryPage user={user} onNotice={onNotice} />;
  if (page === "supplierProfile") return <SupplierProfile user={user} onNotice={onNotice} />;
  if (page === "supplierProducts") return <SupplierProducts user={user} />;
  if (page === "supplierRequests") return <SupplierRequests user={user} onNotice={onNotice} />;
  if (page === "supplyRequests") return <SupplyRequestsAdmin onNotice={onNotice} />;
  if (page === "catalog") return <CatalogPage user={user} onNotice={onNotice} />;
  if (page === "profile") return <ProfilePage user={user} onNotice={onNotice} />;
  return <AccessDenied onLogout={() => {}} />;
}

function Dashboard({ role, user, onNavigate }) {
  const pathMap = {
    admin: ["/api/users", "/api/products", "/api/warehouses", "/api/orders", "/api/stock/low"],
    warehouseManager: ["/api/stock", "/api/stock/low", "/api/orders"],
    supplier: ["/api/suppliers/profile", "/api/supply-requests", "/api/products"],
    salesRepresentative: ["/api/products", "/api/orders"],
  };
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.allSettled(pathMap[role].map((path) => api(path)))
      .then((results) => {
        if (!active) return;
        const data = results.map((result) => result.status === "fulfilled" ? result.value : null);
        if (results.some((result) => result.status === "rejected")) setError("Some dashboard summaries are unavailable right now.");
        const count = (index, keys) => listFrom(data[index], keys).length;
        let next;
        if (role === "admin") next = [
          ["Team members", count(0, ["users"]), "users", "♙"],
          ["Suppliers", listFrom(data[0], ["users"]).filter((user) => roleKey(user.role) === "supplier").length, "suppliers", "♧"],
          ["Products", count(1, ["products"]), "products", "▦"],
          ["Warehouses", count(2, ["warehouses"]), "warehouses", "▤"],
          ["Open orders", listFrom(data[3], ["orders"]).filter((o) => !["Completed", "Delivered", "Cancelled"].includes(o.status)).length, "orders", "▣"],
          ["Low-stock items", count(4, ["stock", "items"]), "lowStock", "⚑"],
        ];
        else if (role === "warehouseManager") next = [
          ["Inventory records", count(0, ["stock"]), "inventory", "▦"],
          ["Low-stock items", count(1, ["stock"]), "lowStock", "⚑"],
          ["Active orders", listFrom(data[2], ["orders"]).filter((o) => !["Completed", "Delivered", "Cancelled"].includes(o.status)).length, "orders", "▣"],
        ];
        else if (role === "supplier") next = [
          ["Supply requests", count(1, ["supplyRequests"]), "supplierRequests", "⇧"],
          ["Products in catalog", count(2, ["products"]), "supplierProducts", "▦"],
        ];
        else next = [
          ["Products to explore", count(0, ["products"]), "catalog", "▦"],
          ["Your orders", count(1, ["orders"]), "myOrders", "▣"],
        ];
        setMetrics(next);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [role]);

  return (
    <section>
      <PageHeading eyebrow="YOUR WORKSPACE" title={`Good to see you, ${user.username || "there"}`} description="Here’s a quick look at what’s happening today." />
      {error && <InlineAlert type="error">{error}</InlineAlert>}
      {loading ? <LoadingBlock /> : (
        <div className="metric-grid">
          {metrics.map(([label, value, target, icon]) => <button className="metric-card" key={label} onClick={() => onNavigate(target)}>
            <span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-link">View details <b>↗</b></span>
          </button>)}
        </div>
      )}
      <div className="welcome-panel">
        <div className="welcome-copy"><span className="eyebrow">QUICK START</span><h2>Make your next move</h2><p>Jump straight into the tasks you work with most.</p></div>
        <div className="quick-links">
          {(role === "admin" ? [["products", "Manage products", "Add and update your catalog"], ["orders", "Review orders", "Track customer orders"], ["lowStock", "Check low stock", "Keep inventory in balance"]]
            : role === "warehouseManager" ? [["inventory", "Manage inventory", "Record stock movements"], ["stockHistory", "Review stock history", "See recent inventory activity"], ["orders", "Process orders", "Keep orders moving"]]
            : role === "supplier" ? [["supplierProfile", "Update your profile", "Keep company details current"], ["supplierRequests", "Supply requests", "Track your requests"]]
            : [["catalog", "Browse products", "Search products and availability"], ["myOrders", "Your orders", "Review order status"]]).map(([target, title, copy]) => (
              <button className="quick-link" key={target} onClick={() => onNavigate(target)}><span className="quick-link-arrow">↗</span><b>{title}</b><small>{copy}</small></button>
            ))}
        </div>
      </div>
      <p className="dashboard-footnote">Signed in as <b>{roleLabel(role)}</b></p>
    </section>
  );
}

function InlineAlert({ type = "error", children }) {
  return <div className={`inline-alert ${type}`} role={type === "error" ? "alert" : "status"}>{children}</div>;
}

function LoadingBlock() {
  return <div className="loading-block"><span className="spinner" /> Loading data…</div>;
}

function DataTable({ columns, rows, loading, error, empty = "Nothing to show yet.", actions, onRetry }) {
  if (loading) return <LoadingBlock />;
  return (
    <>
      {error && <InlineAlert type="error">{error} {onRetry && <button className="alert-action" onClick={onRetry}>Try again</button>}</InlineAlert>}
      <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}{actions && <th className="action-heading">ACTIONS</th>}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => <tr key={objectKey(row) || index}>
            {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : displayValue(column.value ? column.value(row) : row[column.key])}</td>)}
            {actions && <td><div className="row-actions">{actions(row)}</div></td>}
          </tr>) : <tr><td className="empty-cell" colSpan={columns.length + (actions ? 1 : 0)}><span className="empty-icon">⌕</span><b>{empty}</b><small>Try changing your search or filters.</small></td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function SearchBox({ value, onChange, placeholder = "Search…" }) {
  return <label className="search-box"><span>⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-heading"><div><span className="eyebrow">DETAILS</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>{children}
  </div></div>;
}

function StatusPill({ value }) {
  return <span className={`status-pill ${statusClass(value)}`}>{value || "Unknown"}</span>;
}

function Button({ children, variant = "secondary", className = "", ...props }) {
  return <button className={`button ${variant} ${className}`} {...props}>{children}</button>;
}

function FormField({ field, value, onChange, id, preview, users = [] }) {
  const common = {
    id,
    name: field.name,
    value: field.type === "select" ? entityId(value) : value ?? "",
    onChange: (event) => onChange(field.name, event.target.value),
    required: !!field.required,
    placeholder: field.placeholder || "",
    disabled: field.disabled,
    maxLength: field.maxLength,
  };
  let control;
  if (field.type === "select") {
    control = <select {...common}><option value="">Select {field.label.toLowerCase()}</option>{field.options.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>;
  } else if (field.type === "multi") {
    const values = Array.isArray(value) ? value.map(entityId) : [];
    control = <select id={id} name={field.name} multiple value={values} onChange={(event) => onChange(field.name, [...event.target.selectedOptions].map((option) => option.value))} size={Math.min(Math.max(users.length, 2), 5)}>
      {users.map((item) => <option value={objectKey(item)} key={objectKey(item)}>{item.username || item.name || item.email}</option>)}
    </select>;
  } else if (field.type === "textarea") {
    control = <textarea {...common} rows={field.rows || 3} />;
  } else {
    control = <input {...common} type={field.type || "text"} min={field.min} step={field.step} autoComplete={field.name === "password" ? "new-password" : undefined} />;
  }
  return <label className={`field ${field.wide ? "field-wide" : ""}`} htmlFor={id}><span>{field.label}{field.required && <i> *</i>}</span>{control}{field.hint && <small className="field-hint">{field.hint}</small>}
    {preview && <img className="image-preview" src={preview} alt={`${field.label} preview`} onError={(event) => { event.currentTarget.style.display = "none"; }} />}
  </label>;
}

function RecordForm({ title, fields, initial = {}, onSubmit, onClose, busy, error, users = [] }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, initial[field.name] ?? field.defaultValue ?? (field.type === "multi" ? [] : "")])));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(initial.image || initial.logoUrl || "");
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const change = (name, value) => setValues((old) => ({ ...old, [name]: value }));
  async function submit(event) {
    event.preventDefault();
    setLocalError("");
    const payload = { ...values };
    for (const field of fields) {
      if (field.type === "file") {
        delete payload[field.name];
        continue;
      }
      if (field.type === "select") {
        payload[field.name] = entityId(payload[field.name]);
      }
      if (field.type === "multi") {
        payload[field.name] = Array.isArray(payload[field.name])
          ? payload[field.name].map(entityId)
          : [];
      }
      if (field.type === "number") {
        payload[field.name] = values[field.name] === "" ? "" : Number(values[field.name]);
        if (values[field.name] !== "" && !Number.isFinite(payload[field.name])) {
          setLocalError(`${field.label} must be a valid number.`);
          return;
        }
      }
      if (field.type === "password" && !values[field.name]) delete payload[field.name];
    }
    if (payload.email) payload.email = payload.email.trim().toLowerCase();
    if (payload.username) payload.username = payload.username.trim();
    if (payload.name) payload.name = payload.name.trim();
    await onSubmit(payload, file, setLocalError);
  }
  return <form className="record-form" onSubmit={submit}>
    <div className="form-grid">
      {fields.filter((field) => !(field.type === "password" && !initial.new && Object.keys(initial).length > 0)).map((field) => field.type === "file" ? <label className={`field ${field.wide ? "field-wide" : ""}`} key={field.name}>
        <span>{field.label}{field.required && <i> *</i>}</span>
        <input type="file" accept={field.accept || "image/*"} required={field.required && !preview} onChange={(event) => setFile(event.target.files?.[0] || null)} />
        {preview && <img className="image-preview" src={preview} alt={`${field.label} preview`} onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      </label> : <FormField key={field.name} field={field} id={`${title}-${field.name}`} value={values[field.name]} onChange={change} users={users} preview={field.name === "image" || field.name === "logoUrl" ? preview : ""} />)}
    </div>
    {(localError || error) && <InlineAlert type="error">{localError || error}</InlineAlert>}
    <div className="modal-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></div>
  </form>;
}

function uploadError(payload) {
  return payload?.message || payload?.error?.message || payload?.error || "Image upload failed.";
}

async function uploadImage(file) {
  const authPayload = await api("/api/upload/auth");
  const auth = authPayload?.authentication || authPayload?.authParams ||
    authPayload?.data?.authentication || authPayload?.data?.authParams ||
    authPayload?.data || authPayload;
  const publicKey = auth?.publicKey || import.meta.env.VITE_IMAGEKIT_PUBLIC_KEY;
  if (!publicKey || !auth?.token || !auth?.signature || !auth?.expire) {
    throw new Error("The server did not return valid ImageKit upload authentication.");
  }
  const body = new FormData();
  body.append("file", file);
  body.append("fileName", file.name);
  body.append("publicKey", publicKey);
  body.append("token", auth.token);
  body.append("signature", auth.signature);
  body.append("expire", String(auth.expire));
  const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(uploadError(payload));
  if (!payload.url || !payload.fileId) throw new Error("Image upload response did not include a URL and file ID.");
  return { url: payload.url, fileId: payload.fileId };
}

function ManagementPage({ title, description, endpoint, createEndpoint = endpoint, keys, fields, columns, onNotice, users = [], addLabel, transformPayload, filterItems, canDelete = true, auxiliaryLoading = false, auxiliaryError = "" }) {
  const remote = useRemote(endpoint, keys);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = useMemo(() => remote.items.filter((item) => (!filterItems || filterItems(item)) && (() => {
    const search = query.toLowerCase();
    return !search || columns.some((column) => String(column.value ? column.value(item) : item[column.key] || "").toLowerCase().includes(search));
  })()), [remote.items, query, columns, filterItems]);
  async function save(values, file) {
    setBusy(true);
    setError("");
    try {
      let payload = { ...values };
      if (file) {
        const uploaded = await uploadImage(file);
        payload = { ...payload, imageUrl: uploaded.url, imageFileId: uploaded.fileId };
      }
      if (transformPayload) payload = transformPayload(payload);
      if (!editing?.new && !editing) return;
      const isNew = !!editing.new;
      const id = objectKey(editing);
      await api(isNew ? createEndpoint : `${endpoint}/${id}`, { method: isNew ? "POST" : "PUT", body: payload });
      setEditing(null);
      remote.reload();
      onNotice({ type: "success", text: `${title.replace(/s$/, "")} ${isNew ? "created" : "updated"} successfully.` });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }
  async function remove(item) {
    const label = displayValue(item.name || item.username || item.companyName || objectKey(item));
    if (!window.confirm(`Delete “${label}”? This action cannot be undone.`)) return;
    try {
      await api(`${endpoint}/${objectKey(item)}`, { method: "DELETE" });
      remote.reload();
      onNotice({ type: "success", text: `${label} was deleted.` });
    } catch (deleteError) {
      onNotice({ type: "error", text: errorMessage(deleteError) });
    }
  }
  const rowActions = (item) => <><button className="table-action" onClick={() => { setError(""); setEditing(item); }}>Edit</button>{canDelete && <button className="table-action danger-text" onClick={() => remove(item)}>Delete</button>}</>;
  return <section>
    <PageHeading title={title} description={description} action={<Button variant="primary" onClick={() => { setError(""); setEditing({ new: true }); }}>＋ {addLabel || `Add ${title.replace(/s$/, "").toLowerCase()}`}</Button>} />
    <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder={`Search ${title.toLowerCase()}…`} /><span className="result-count">{rows.length} records</span></div>
    {auxiliaryLoading && <p className="muted-copy">Loading supplier options…</p>}
    {auxiliaryError && <InlineAlert type="error">Supplier options could not be loaded: {auxiliaryError}</InlineAlert>}
    <DataTable columns={columns} rows={rows} loading={remote.loading} error={remote.error} onRetry={remote.reload} actions={rowActions} empty={`No ${title.toLowerCase()} found.`} />
    {editing && <Modal title={`${editing.new ? "Add" : "Edit"} ${title.replace(/s$/, "").toLowerCase()}`} onClose={() => setEditing(null)}>
      <RecordForm title={title} fields={fields} initial={editing} onSubmit={save} onClose={() => setEditing(null)} busy={busy} error={error} users={users} />
    </Modal>}
  </section>;
}

function UsersPage({ onNotice }) {
  const fields = [
    { name: "username", label: "Username", required: true, maxLength: 50 },
    { name: "email", label: "Email", type: "email", required: true, maxLength: 254 },
    { name: "password", label: "Temporary password", type: "password", required: true, hint: "At least 8 characters." },
    { name: "role", label: "Role", type: "select", required: true, options: ROLES },
  ];
  const columns = [
    { key: "username", label: "USER", render: (row) => <div className="user-cell"><span className="mini-avatar">{(row.username || "?").slice(0, 1).toUpperCase()}</span><div><b>{row.username}</b><small>{row.email}</small></div></div> },
    { key: "role", label: "ROLE", render: (row) => <StatusPill value={roleLabel(roleKey(row.role))} /> },
    { key: "companyName", label: "COMPANY" },
  ];
  return <ManagementPage title="Users" description="Manage workspace access and team roles." endpoint="/api/users" createEndpoint="/api/auth/users" keys={["users"]} fields={fields} columns={columns} onNotice={onNotice} transformPayload={(payload) => { if (!payload.password) delete payload.password; return payload; }} />;
}

function ProductsAdmin({ onNotice, canDelete = true }) {
  const supplierOptions = useRemote("/api/suppliers", ["suppliers"]);
  const suppliers = supplierOptions.items;
  const fields = [
    { name: "name", label: "Product name", required: true, maxLength: 120 },
    { name: "sku", label: "SKU", required: true, maxLength: 64 },
    { name: "category", label: "Category", required: true, maxLength: 100 },
    { name: "price", label: "Unit price", type: "number", required: true, min: 0, step: "0.01" },
    { name: "lowStockLimit", label: "Low-stock limit", type: "number", required: true, min: 0, step: "1", defaultValue: 10 },
    { name: "supplier", label: "Supplier", type: "select", options: suppliers.map((supplier) => [objectKey(supplier), supplier.companyName || supplier.username]) },
    { name: "desc", label: "Description", type: "textarea", required: true, wide: true, maxLength: 2000 },
    { name: "image", label: "Product image", type: "file", required: true, wide: true },
  ];
  const columns = [
    { key: "product", label: "PRODUCT", render: (row) => <div className="product-cell">{row.image || row.imageUrl ? <img src={row.image || row.imageUrl} alt="" /> : <span className="product-placeholder">▦</span>}<div><b>{row.name}</b><small>{row.category || "Uncategorized"}</small><small>{row.desc || row.description}</small></div></div> },
    { key: "price", label: "PRICE", render: (row) => money(row.price) },
  ];
  return <ManagementPage title="Products" description="Keep product information and pricing up to date." endpoint="/api/products" keys={["products"]} fields={fields} columns={columns} onNotice={onNotice} users={suppliers} addLabel="Add product" canDelete={canDelete} auxiliaryLoading={supplierOptions.loading} auxiliaryError={supplierOptions.error} />;
}

function WarehousesPage({ onNotice }) {
  const users = useRemote("/api/users", ["users"]).items.filter((user) => roleKey(user.role) === "warehouseManager");
  const fields = [
    { name: "name", label: "Warehouse name", required: true, maxLength: 120 },
    { name: "code", label: "Warehouse code", required: true, maxLength: 40 },
    { name: "location", label: "Location", required: true, maxLength: 250 },
    { name: "capacity", label: "Capacity", type: "number", min: 0, step: "1" },
    { name: "managers", label: "Assigned managers", type: "multi", wide: true, hint: "Select one or more warehouse managers." },
  ];
  const columns = [
    { key: "name", label: "WAREHOUSE", render: (row) => <div><b>{row.name}</b><small>{row.location || "No location set"}</small></div> },
    { key: "code", label: "CODE" },
    { key: "capacity", label: "CAPACITY", render: (row) => row.capacity ?? "—" },
    { key: "managers", label: "ASSIGNED MANAGERS", render: (row) => (row.managers || []).map(displayValue).join(", ") || "—" },
  ];
  return <ManagementPage title="Warehouses" description="Set up locations and assign warehouse managers." endpoint="/api/warehouses" keys={["warehouses"]} fields={fields} columns={columns} onNotice={onNotice} users={users} addLabel="Add warehouse" transformPayload={(payload) => { if (payload.capacity === "") delete payload.capacity; return payload; }} />;
}

function SuppliersAdmin({ onNotice }) {
  const fields = [
    { name: "username", label: "Username", required: true, maxLength: 50 },
    { name: "email", label: "Email", type: "email", required: true, maxLength: 254 },
    { name: "password", label: "Temporary password", type: "password", required: true },
    { name: "role", label: "Role", type: "select", required: true, defaultValue: "supplier", options: [["supplier", "Supplier"]] },
  ];
  const columns = [
    { key: "supplier", label: "SUPPLIER", render: (row) => <div className="user-cell">{row.logoUrl ? <img className="mini-logo" src={row.logoUrl} alt="" /> : <span className="mini-avatar">♧</span>}<div><b>{row.companyName || row.username}</b><small>{row.email}</small></div></div> },
    { key: "username", label: "ACCOUNT" },
    { key: "role", label: "ROLE", render: (row) => <StatusPill value={roleLabel(roleKey(row.role))} /> },
  ];
  return <ManagementPage title="Suppliers" description="Review supplier accounts and invite new suppliers." endpoint="/api/users" createEndpoint="/api/auth/users" keys={["users"]} fields={fields} columns={columns} onNotice={onNotice} addLabel="Add supplier" filterItems={(item) => roleKey(item.role) === "supplier"} transformPayload={(payload) => ({ ...payload, role: "supplier" })} />;
}

function TransactionsPage({ role }) {
  const remote = useRemote("/api/transactions", ["transactions"]);
  const columns = [
    { key: "createdAt", label: "DATE", render: (row) => dateLabel(row.createdAt || row.date) },
    { key: "type", label: "MOVEMENT", render: (row) => <StatusPill value={row.type} /> },
    { key: "product", label: "PRODUCT", render: (row) => displayValue(row.product?.name || row.productName || row.product) },
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "quantity", label: "QUANTITY", render: (row) => <b>{row.type === "out" ? "−" : "+"}{row.quantity ?? "—"}</b> },
    { key: "performedBy", label: "BY", render: (row) => displayValue(row.performedBy?.username || row.performedBy) },
    { key: "note", label: "NOTE" },
  ];
  return <section><PageHeading title={role === "admin" ? "Transactions" : "Stock history"} description="A complete timeline of stock movements." /><DataTable columns={columns} rows={remote.items} loading={remote.loading} error={remote.error} onRetry={remote.reload} empty="No stock transactions yet." /></section>;
}

function LowStockPage() {
  const remote = useRemote("/api/stock/low", ["stock", "items"]);
  const columns = [
    { key: "product", label: "PRODUCT", render: (row) => <div className="product-cell">{row.product?.image && <img src={row.product.image} alt="" />}<b>{displayValue(row.product?.name || row.product)}</b></div> },
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "quantity", label: "ON HAND", render: (row) => <span className="quantity-low">{row.quantity ?? 0}</span> },
    { key: "threshold", label: "THRESHOLD", render: (row) => row.product?.lowStockLimit ?? 10 },
  ];
  return <section><PageHeading title="Low stock" description="Items at or below each product’s replenishment threshold." /><div className="toolbar"><span className="result-count">{remote.items.length} items need attention</span></div><DataTable columns={columns} rows={remote.items} loading={remote.loading} error={remote.error} onRetry={remote.reload} empty="Everything is above its replenishment threshold." /></section>;
}

function OrdersPage({ role, user, onNotice }) {
  const remote = useRemote("/api/orders", ["orders"]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const ownOrders = role === "salesRepresentative"
    ? remote.items.filter((order) => isOwnedBy(order, "createdBy", user))
    : remote.items;
  const rows = ownOrders.filter((order) => String(order._id || order.id || "").toLowerCase().includes(search.toLowerCase()) || String(order.status || "").toLowerCase().includes(search.toLowerCase()));
  const columns = [
    { key: "number", label: "ORDER", render: (row) => <b>#{row.orderNumber || String(objectKey(row)).slice(-8).toUpperCase()}</b> },
    { key: "createdAt", label: "DATE", render: (row) => dateLabel(row.createdAt) },
    ...(role !== "salesRepresentative" ? [{ key: "createdBy", label: "CREATED BY", render: (row) => displayValue(row.createdBy?.username || row.createdBy) }] : []),
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "items", label: "ITEMS", render: (row) => (row.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0) },
    { key: "totalAmount", label: "TOTAL", render: (row) => money(row.totalAmount) },
    { key: "status", label: "STATUS", render: (row) => <StatusPill value={row.status} /> },
  ];
  async function cancel(order) {
    if (!window.confirm(`Cancel order #${String(objectKey(order)).slice(-8).toUpperCase()}?`)) return;
    setBusy(true);
    try {
      await api(`/api/orders/${objectKey(order)}/cancel`, { method: "PUT", body: {} });
      remote.reload();
      setSelected(null);
      onNotice({ type: "success", text: "Order cancelled." });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error) });
    } finally { setBusy(false); }
  }
  async function setStatus(order, status) {
    setBusy(true);
    try {
      await api(`/api/orders/${objectKey(order)}/status`, { method: "PUT", body: { status } });
      remote.reload();
      setSelected({ ...order, status });
      onNotice({ type: "success", text: `Order marked ${status.toLowerCase()}.` });
    } catch (error) { onNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  }
  const actions = (row) => <button className="table-action" onClick={() => setSelected(row)}>Details</button>;
  return <section><PageHeading title={role === "salesRepresentative" ? "My orders" : role === "admin" ? "All orders" : "Orders"} description={role === "salesRepresentative" ? "Track your orders and manage pending requests." : "Review order details and follow fulfillment progress."} /><div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search order ID or status…" /><span className="result-count">{rows.length} orders</span></div><DataTable columns={columns} rows={rows} loading={remote.loading} error={remote.error} onRetry={remote.reload} actions={actions} empty="No orders found." />
    {selected && <Modal title={`Order #${selected.orderNumber || String(objectKey(selected)).slice(-8).toUpperCase()}`} onClose={() => setSelected(null)} wide>
      <OrderDetails order={selected} />
      <div className="modal-actions">
        {(role === "salesRepresentative" || role === "admin") && selected.status === "Pending" && <Button variant="danger" disabled={busy} onClick={() => cancel(selected)}>Cancel order</Button>}
        {(role === "admin" || role === "warehouseManager") && selected.status !== "Cancelled" && selected.status !== "Completed" && <OrderStatusControl order={selected} busy={busy} onChange={(status) => setStatus(selected, status)} />}
        <Button onClick={() => setSelected(null)}>Close</Button>
      </div>
    </Modal>}
  </section>;
}

function OrderStatusControl({ order, busy, onChange }) {
  const next = { Pending: "Processing", Processing: "Completed" }[order.status];
  return next ? <Button variant="primary" disabled={busy} onClick={() => onChange(next)}>Mark {next.toLowerCase()}</Button> : null;
}

function OrderDetails({ order }) {
  return <div className="details-content">
    <div className="detail-grid"><Detail label="Order number">{order.orderNumber}</Detail><Detail label="Status"><StatusPill value={order.status} /></Detail><Detail label="Order date">{dateLabel(order.createdAt)}</Detail><Detail label="Customer">{order.customerName}</Detail><Detail label="Customer phone">{order.customerPhone}</Detail><Detail label="Warehouse">{displayValue(order.warehouse?.name || order.warehouse)}</Detail><Detail label="Created by">{displayValue(order.createdBy?.username || order.createdBy)}</Detail></div>
    <h3 className="section-title">Order items</h3>
    <div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>QTY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead><tbody>{(order.items || []).map((item, index) => <tr key={objectKey(item.product) || index}><td>{displayValue(item.product?.name || item.productName || item.product)}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td></tr>)}</tbody></table></div>
    <div className="order-total"><span>Total</span><b>{money(order.totalAmount)}</b></div>
    {order.note && <p className="note-block"><b>Note:</b> {order.note}</p>}
  </div>;
}

function Detail({ label, children }) {
  return <div className="detail-item"><small>{label}</small><div>{children || "—"}</div></div>;
}

function InventoryPage({ user, onNotice }) {
  const warehousesRemote = useRemote("/api/warehouses", ["warehouses"]);
  const productsRemote = useRemote("/api/products", ["products"]);
  const [warehouseId, setWarehouseId] = useState("");
  const stockRemote = useRemote(warehouseId ? `/api/stock?warehouseId=${encodeURIComponent(warehouseId)}` : "/api/stock", ["stock"]);
  const [dialog, setDialog] = useState("");
  const [busy, setBusy] = useState(false);
  const warehouses = useMemo(
    () => warehousesRemote.items.filter((warehouse) => isWarehouseAssigned(warehouse, user)),
    [warehousesRemote.items, user],
  );
  const selectedWarehouse = warehouseId || objectKey(warehouses[0]);
  useEffect(() => { if (!warehouseId && warehouses.length) setWarehouseId(objectKey(warehouses[0])); }, [warehouseId, warehouses]);
  const columns = [
    { key: "product", label: "PRODUCT", render: (row) => <div className="product-cell">{row.product?.image && <img src={row.product.image} alt="" />}<div><b>{displayValue(row.product?.name || row.product)}</b><small>{row.product?.desc || ""}</small></div></div> },
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "quantity", label: "ON HAND", render: (row) => <b>{row.quantity ?? 0}</b> },
    { key: "updatedAt", label: "LAST UPDATED", render: (row) => dateLabel(row.updatedAt) },
  ];
  async function stockChange(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      warehouseId: selectedWarehouse,
      productId: form.get("productId"),
      quantity: Number(form.get("quantity")),
      note: String(form.get("note") || "").trim(),
    };
    setBusy(true);
    try {
      await api(`/api/stock/${dialog}`, { method: "POST", body });
      setDialog("");
      stockRemote.reload();
      onNotice({ type: "success", text: dialog === "in" ? "Stock received successfully." : "Stock issued successfully." });
    } catch (error) { onNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  }
  return <section><PageHeading title="My inventory" description="View assigned warehouse stock and record stock movements." action={<div className="button-row"><Button onClick={() => setDialog("out")}>− Stock out</Button><Button variant="primary" onClick={() => setDialog("in")}>＋ Stock in</Button></div>} />
    {warehousesRemote.error && <InlineAlert type="error">{warehousesRemote.error}</InlineAlert>}
    {warehouses.length > 1 && <div className="toolbar"><label className="filter-control"><span>Warehouse</span><select value={selectedWarehouse} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option value={objectKey(warehouse)} key={objectKey(warehouse)}>{warehouse.name} {warehouse.code ? `· ${warehouse.code}` : ""}</option>)}</select></label></div>}
    {!warehousesRemote.loading && warehouses.length === 0 && <InlineAlert type="error">No warehouse is assigned to your account yet.</InlineAlert>}
    <DataTable columns={columns} rows={stockRemote.items.filter((row) => !selectedWarehouse || entityId(row.warehouse) === selectedWarehouse)} loading={warehousesRemote.loading || stockRemote.loading} error={stockRemote.error} onRetry={stockRemote.reload} empty="No inventory records in this warehouse." />
    {dialog && <Modal title={dialog === "in" ? "Receive stock" : "Issue stock"} onClose={() => setDialog("")}>
      <form className="record-form" onSubmit={stockChange}><div className="form-grid">
        <label className="field field-wide"><span>Product *</span><select name="productId" required defaultValue=""><option value="" disabled>Select a product</option>{productsRemote.items.map((product) => <option value={objectKey(product)} key={objectKey(product)}>{product.name}</option>)}</select></label>
        <label className="field"><span>Quantity *</span><input type="number" name="quantity" min="1" step="1" required /></label>
        <label className="field"><span>Note</span><input name="note" maxLength="500" placeholder="Optional reference or reason" /></label>
      </div>
      {productsRemote.error && <InlineAlert type="error">{productsRemote.error}</InlineAlert>}
      <div className="modal-actions"><Button type="button" onClick={() => setDialog("")}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !selectedWarehouse}>{busy ? "Saving…" : `Confirm stock ${dialog}`}</Button></div></form>
    </Modal>}
  </section>;
}

function SupplierProfile({ user, onNotice }) {
  const remote = useRemote("/api/suppliers/profile", ["profile", "supplier"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const profile = remote.data?.profile || remote.data?.supplier || remote.data?.data || remote.data || {};
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (remote.data && !remote.error) {
      setCompanyName(profile.companyName || "");
      setLogoUrl(profile.logoUrl || "");
      setPreview(profile.logoUrl || "");
    }
  }, [remote.data, remote.error]);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function submit(event) {
    event.preventDefault();
    if (!companyName.trim()) { setError("Company name is required."); return; }
    setBusy(true); setError("");
    try {
      let uploaded = null;
      if (file) uploaded = await uploadImage(file);
      const nextLogoUrl = uploaded?.url || logoUrl;
      await api("/api/suppliers/profile", { method: "PUT", body: { companyName: companyName.trim(), ...(uploaded ? { logoUrl: uploaded.url, logoFileId: uploaded.fileId } : {}) } });
      setLogoUrl(nextLogoUrl);
      setFile(null);
      remote.reload();
      onNotice({ type: "success", text: "Company profile updated." });
    } catch (saveError) { setError(errorMessage(saveError)); }
    finally { setBusy(false); }
  }
  return <section><PageHeading title="Company profile" description="Manage the details and logo shown to your partners." />
    {remote.loading ? <LoadingBlock /> : <div className="profile-layout"><form className="profile-form" onSubmit={submit}>
      <div className="profile-logo-panel"><div className="logo-preview">{preview ? <img src={preview} alt="Company logo preview" onError={() => setPreview("")} /> : <span>♧</span>}</div><div><b>Company logo</b><small>PNG, JPG, or WebP. Choose an image to preview it.</small></div><label className="button secondary upload-button">Choose image<input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label></div>
      <div className="profile-fields">
        <label className="field"><span>Company name *</span><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required maxLength={120} /></label>
        <label className="field"><span>Account email</span><input value={profile.email || user.email || ""} readOnly /></label>
        <label className="field"><span>Username</span><input value={profile.username || user.username || ""} readOnly /></label>
      </div>
      {(remote.error || error) && <InlineAlert type="error">{error || remote.error}</InlineAlert>}
      <div className="form-bottom"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button></div>
    </form></div>}
  </section>;
}

function ProfilePage({ user, onNotice }) {
  const remote = useRemote("/api/auth/me", ["user"]);
  const profile = remote.data?.user || user;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(profile.name || profile.username || "");
    setPhone(profile.phone || "");
    setPreview(profile.image || "");
  }, [profile.name, profile.username, profile.phone, profile.image]);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const uploaded = file ? await uploadImage(file) : null;
      await api("/api/auth/me", {
        method: "PUT",
        body: {
          name: name.trim(),
          phone: phone.trim(),
          ...(uploaded ? { imageUrl: uploaded.url, imageFileId: uploaded.fileId } : {}),
        },
      });
      setFile(null);
      remote.reload();
      onNotice({ type: "success", text: "Profile updated." });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return <section>
    <PageHeading title="My profile" description="Update your contact details and profile picture." />
    {remote.loading ? <LoadingBlock /> : <form className="profile-form" onSubmit={submit}>
      <div className="profile-logo-panel">
        <div className="logo-preview">{preview ? <img src={preview} alt="Profile preview" onError={() => setPreview("")} /> : <span>{(name || user.username || "U").slice(0, 1).toUpperCase()}</span>}</div>
        <div><b>Profile picture</b><small>PNG, JPG, WebP, or GIF, up to 5 MB.</small></div>
        <label className="button secondary upload-button">Choose image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      </div>
      <div className="profile-fields">
        <label className="field"><span>Full name *</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
        <label className="field"><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} /></label>
        <label className="field"><span>Email</span><input value={profile.email || ""} readOnly /></label>
      </div>
      {(remote.error || error) && <InlineAlert type="error">{error || remote.error}</InlineAlert>}
      <div className="form-bottom"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button></div>
    </form>}
  </section>;
}

function SupplierProducts({ user }) {
  const productsRemote = useRemote("/api/products", ["products"]);
  const profileRemote = useRemote("/api/suppliers/profile", ["profile", "supplier"]);
  const products = productsRemote.items.filter((product) => isOwnedBy(product, "supplier", user));
  const columns = [
    { key: "product", label: "PRODUCT", render: (row) => <div className="product-cell">{row.image || row.imageUrl ? <img src={row.image || row.imageUrl} alt="" /> : <span className="product-placeholder">▦</span>}<div><b>{row.name}</b><small>{row.category || "Uncategorized"}</small><small>{row.desc || row.description}</small></div></div> },
    { key: "price", label: "PRICE", render: (row) => money(row.price) },
    { key: "stock", label: "AVAILABILITY", render: (row) => displayValue(row.quantity ?? row.stock ?? "See inventory") },
  ];
  return <section><PageHeading title="My products" description="Products associated with your supplier account." /><DataTable columns={columns} rows={products} loading={productsRemote.loading || profileRemote.loading} error={productsRemote.error || profileRemote.error} onRetry={productsRemote.reload} empty="No products are linked to your supplier account." /></section>;
}

function SupplierRequests({ user, onNotice }) {
  const remote = useRemote("/api/supply-requests", ["supplyRequests", "requests"]);
  const warehouses = useRemote("/api/warehouses", ["warehouses"]);
  const products = useRemote("/api/products", ["products"]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { productId: form.get("productId"), warehouseId: form.get("warehouseId"), quantity: Number(form.get("quantity")), note: String(form.get("note") || "").trim() };
    if (!payload.productId || !payload.warehouseId || !Number.isSafeInteger(payload.quantity) || payload.quantity < 1) {
      setError("Select a product and warehouse and enter a positive whole-number quantity.");
      return;
    }
    setBusy(true); setError("");
    try {
      await api("/api/supply-requests", { method: "POST", body: payload });
      setCreating(false); remote.reload();
      onNotice({ type: "success", text: "Supply request submitted." });
    } catch (submitError) { setError(errorMessage(submitError)); }
    finally { setBusy(false); }
  }
  const columns = [
    { key: "createdAt", label: "DATE", render: (row) => dateLabel(row.createdAt) },
    { key: "product", label: "PRODUCT", render: (row) => displayValue(row.product?.name || row.product) },
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "quantity", label: "QUANTITY" },
    { key: "status", label: "STATUS", render: (row) => <StatusPill value={row.status} /> },
    { key: "note", label: "NOTE" },
  ];
  const ownRequests = remote.items.filter((request) => isOwnedBy(request, "supplier", user));
  return <section><PageHeading title="Supply requests" description="Request replenishment and follow each request’s status." action={<Button variant="primary" onClick={() => { setError(""); setCreating(true); }}>＋ New request</Button>} /><DataTable columns={columns} rows={ownRequests} loading={remote.loading} error={remote.error} onRetry={remote.reload} empty="No supply requests yet." />
    {creating && <Modal title="New supply request" onClose={() => setCreating(false)}><form className="record-form" onSubmit={submit}><div className="form-grid">
      <label className="field field-wide"><span>Product *</span><select name="productId" required defaultValue=""><option value="" disabled>Select product</option>{products.items.map((product) => <option key={objectKey(product)} value={objectKey(product)}>{product.name}</option>)}</select></label>
      <label className="field field-wide"><span>Deliver to warehouse *</span><select name="warehouseId" required defaultValue=""><option value="" disabled>Select warehouse</option>{warehouses.items.map((warehouse) => <option key={objectKey(warehouse)} value={objectKey(warehouse)}>{warehouse.name}</option>)}</select></label>
      <label className="field"><span>Quantity *</span><input name="quantity" type="number" min="1" step="1" required /></label>
      <label className="field"><span>Note</span><input name="note" maxLength="500" /></label>
    </div>{(error || products.error || warehouses.error) && <InlineAlert type="error">{error || products.error || warehouses.error}</InlineAlert>}
    <div className="modal-actions"><Button type="button" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button></div></form></Modal>}
  </section>;
}

function SupplyRequestsAdmin({ onNotice }) {
  const remote = useRemote("/api/supply-requests", ["supplyRequests", "requests"]);
  const [busyId, setBusyId] = useState("");
  async function review(request, status) {
    if (!window.confirm(`${status} this supply request?`)) return;
    setBusyId(objectKey(request));
    try {
      await api(`/api/supply-requests/${objectKey(request)}/status`, { method: "PUT", body: { status } });
      remote.reload(); onNotice({ type: "success", text: `Request ${status.toLowerCase()}.` });
    } catch (error) { onNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusyId(""); }
  }
  const columns = [
    { key: "createdAt", label: "DATE", render: (row) => dateLabel(row.createdAt) },
    { key: "supplier", label: "SUPPLIER", render: (row) => displayValue(row.supplier?.companyName || row.supplier?.username || row.supplier) },
    { key: "product", label: "PRODUCT", render: (row) => displayValue(row.product?.name || row.product) },
    { key: "warehouse", label: "WAREHOUSE", render: (row) => displayValue(row.warehouse?.name || row.warehouse) },
    { key: "quantity", label: "QUANTITY" },
    { key: "status", label: "STATUS", render: (row) => <StatusPill value={row.status} /> },
  ];
  const actions = (row) => row.status === "Pending" ? <><button className="table-action" disabled={busyId === objectKey(row)} onClick={() => review(row, "Approved")}>Approve</button><button className="table-action danger-text" disabled={busyId === objectKey(row)} onClick={() => review(row, "Rejected")}>Reject</button></> : null;
  return <section><PageHeading title="Supply requests" description="Review and respond to supplier replenishment requests." /><DataTable columns={columns} rows={remote.items} loading={remote.loading} error={remote.error} onRetry={remote.reload} actions={actions} empty="No supply requests yet." /></section>;
}

function CatalogPage({ onNotice }) {
  const productsRemote = useRemote("/api/products", ["products"]);
  const warehousesRemote = useRemote("/api/warehouses", ["warehouses"]);
  const [search, setSearch] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const stockRemote = useRemote(selectedWarehouse ? `/api/stock?warehouseId=${encodeURIComponent(selectedWarehouse)}` : "", ["stock"]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const productStocks = useMemo(() => new Map(stockRemote.items.map((item) => [entityId(item.product), Number(item.quantity || 0)])), [stockRemote.items]);
  const products = productsRemote.items.filter((product) => !search || `${product.name} ${product.desc || ""}`.toLowerCase().includes(search.toLowerCase()));
  const cartItems = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const total = cartItems.reduce((sum, [id, quantity]) => {
    const product = productsRemote.items.find((item) => objectKey(item) === id);
    return sum + Number(product?.price || 0) * quantity;
  }, 0);
  function setQuantity(id, quantity) {
    setCart((old) => {
      const next = { ...old };
      if (!quantity) delete next[id]; else next[id] = quantity;
      return next;
    });
  }
  async function submitOrder(event) {
    event.preventDefault();
    setError("");
    if (!selectedWarehouse) { setError("Choose a warehouse for this order."); return; }
    if (!cartItems.length) { setError("Add at least one product to your order."); return; }
    for (const [id, quantity] of cartItems) {
      const available = productStocks.get(id);
      if (available !== undefined && quantity > available) { setError(`Only ${available} units are available for ${productsRemote.items.find((item) => objectKey(item) === id)?.name || "a selected product"}.`); return; }
    }
    setSubmitting(true);
    try {
      await api("/api/orders", { method: "POST", body: { warehouseId: selectedWarehouse, customerName: customerName.trim(), customerPhone: customerPhone.trim(), items: cartItems.map(([productId, quantity]) => ({ productId, quantity })), note: note.trim() } });
      setCart({}); setNote(""); setCustomerName(""); setCustomerPhone("");
      onNotice({ type: "success", text: "Your order has been placed." });
    } catch (submitError) { setError(errorMessage(submitError)); }
    finally { setSubmitting(false); }
  }
  return <section><PageHeading title="Product catalog" description="Search products, check stock by warehouse, and create an order." />
    <div className="catalog-layout">
      <div className="catalog-main">
        <div className="catalog-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search products…" /><label className="filter-control"><span>Stock at</span><select value={selectedWarehouse} onChange={(event) => setSelectedWarehouse(event.target.value)}><option value="">Choose warehouse</option>{warehousesRemote.items.map((warehouse) => <option value={objectKey(warehouse)} key={objectKey(warehouse)}>{warehouse.name}</option>)}</select></label></div>
        {(productsRemote.error || warehousesRemote.error) && <InlineAlert type="error">{productsRemote.error || warehousesRemote.error}</InlineAlert>}
        {stockRemote.error && <InlineAlert type="error">Stock availability could not be loaded: {stockRemote.error}</InlineAlert>}
        {productsRemote.loading ? <LoadingBlock /> : products.length ? <div className="product-grid">
          {products.map((product) => {
            const id = objectKey(product);
            return <article className="catalog-card" key={id}>
              <button className="catalog-image" onClick={() => setSelectedProduct(product)} aria-label={`View ${product.name} details`}>{product.image || product.imageUrl ? <img src={product.image || product.imageUrl} alt="" /> : <span>▦</span>}</button>
              <div className="catalog-card-body"><div className="catalog-card-head"><h3>{product.name}</h3><b>{money(product.price)}</b></div><small className="catalog-category">{product.category || "Uncategorized"}</small><p>{product.desc || product.description || "No description provided."}</p>
                <div className="availability">{selectedWarehouse ? stockRemote.loading ? "Checking stock…" : stockRemote.error ? "Availability unavailable" : `${productStocks.get(id) ?? 0} in stock` : "Select a warehouse to check stock"}</div>
                <div className="catalog-card-actions"><button className="text-button" onClick={() => setSelectedProduct(product)}>Details</button><div className="quantity-stepper"><button aria-label={`Decrease ${product.name} quantity`} onClick={() => setQuantity(id, Math.max(0, (cart[id] || 0) - 1))}>−</button><span>{cart[id] || 0}</span><button aria-label={`Add ${product.name}`} onClick={() => setQuantity(id, Math.min(10000, (cart[id] || 0) + 1))}>＋</button></div></div>
              </div>
            </article>;
          })}
        </div> : <div className="empty-state"><span>⌕</span><b>No matching products</b><small>Try another search.</small></div>}
      </div>
      <aside className="order-panel"><div className="order-panel-heading"><span className="eyebrow">NEW ORDER</span><h2>Your order <span>{cartItems.length}</span></h2></div>
        {cartItems.length ? <div className="cart-lines">{cartItems.map(([id, quantity]) => {
          const product = productsRemote.items.find((item) => objectKey(item) === id);
          if (!product) return null;
          return <div className="cart-line" key={id}><div><b>{product.name}</b><small>{money(product.price)} each</small></div><div className="quantity-stepper"><button onClick={() => setQuantity(id, quantity - 1)}>−</button><span>{quantity}</span><button onClick={() => setQuantity(id, quantity + 1)}>＋</button></div></div>;
        })}</div> : <div className="cart-empty"><span>▣</span><b>Your order is empty</b><small>Add products to get started.</small></div>}
        <form onSubmit={submitOrder}><label className="field"><span>Fulfillment warehouse *</span><select value={selectedWarehouse} onChange={(event) => setSelectedWarehouse(event.target.value)} required><option value="">Select warehouse</option>{warehousesRemote.items.map((warehouse) => <option value={objectKey(warehouse)} key={objectKey(warehouse)}>{warehouse.name}</option>)}</select></label>
          <label className="field"><span>Customer name *</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required maxLength={150} /></label>
          <label className="field"><span>Customer phone *</span><input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} required maxLength={30} /></label>
          <label className="field"><span>Order note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows="2" maxLength="500" placeholder="Add a note (optional)" /></label>
          <div className="cart-total"><span>Estimated total</span><b>{money(total)}</b></div>
          {error && <InlineAlert type="error">{error}</InlineAlert>}
          <Button type="submit" variant="primary" className="full-button" disabled={submitting || !cartItems.length}>{submitting ? "Placing order…" : "Place order"}</Button>
        </form>
      </aside>
    </div>
    {selectedProduct && <Modal title={selectedProduct.name} onClose={() => setSelectedProduct(null)}>
      <div className="product-detail">{(selectedProduct.image || selectedProduct.imageUrl) && <img src={selectedProduct.image || selectedProduct.imageUrl} alt={selectedProduct.name} />}<p>{selectedProduct.category || "Uncategorized"}</p><p>{selectedProduct.desc || selectedProduct.description || "No description provided."}</p><div className="product-detail-price">{money(selectedProduct.price)}</div>{selectedWarehouse && <p className="muted-copy">Stock at selected warehouse: {stockRemote.error ? "unavailable" : productStocks.get(objectKey(selectedProduct)) ?? (stockRemote.loading ? "Loading…" : 0)}</p>}<Button variant="primary" onClick={() => { setQuantity(objectKey(selectedProduct), Math.min(10000, (cart[objectKey(selectedProduct)] || 0) + 1)); setSelectedProduct(null); }}>＋ Add to order</Button></div>
    </Modal>}
  </section>;
}

export default App;
