# Inventory & Warehouse Management System

Stockroom is a role-based inventory and warehouse management application built with React, Express, and MongoDB/Mongoose. It covers product and warehouse administration, stock movements and history, order fulfillment, supplier requests, and ImageKit-backed image uploads.

This repository contains separate `backend/` and `frontend/` applications. There is no root-level package script; install, run, and test each application from its own directory.

## Features

- JWT-backed sessions in an HttpOnly cookie; passwords are hashed with bcrypt.
- Four supported roles with backend authorization and role-specific dashboards.
- Product catalog and warehouse management, including warehouse capacity and manager assignments.
- Stock-in, stock-out, low-stock reporting, and transaction history.
- Multi-product orders with stock checks and transactional fulfillment.
- Supplier profiles, logos, and supply requests.
- Signed ImageKit uploads for products, user profile images, and supplier logos. The ImageKit private key stays on the server.
- Responsive navigation, searchable management tables, forms, image previews, loading indicators, and error states.

## Roles and permissions

| Role | Main capabilities |
| --- | --- |
| `admin` | Manage users and roles, products, warehouses and manager assignments; view all orders, stock and supply requests; perform stock movements; manage order status and cancel orders; approve or reject supply requests. |
| `warehouseManager` | View only assigned warehouses and their scoped stock, low-stock items, transactions, and orders; perform stock movements; update order status; create and update products, including product images. Product deletion, user administration, warehouse administration, and supply-request review remain admin-only. |
| `supplier` | View and update their own supplier profile and logo; view their own products and submit/view their own supply requests. |
| `salesRepresentative` | Browse products and warehouse stock, manage their own cart, create and view their own orders, and cancel their own eligible orders. |

Authorization is enforced by backend routes as well as frontend navigation. Public registration creates a `salesRepresentative`; it cannot create an admin. Create the first admin using the operator-only bootstrap procedure documented in [backend/scripts/README.md](./backend/scripts/README.md).

## Requirements

- Node.js **22.12 or newer** (the Vite version in this project requires Node 20.19+ or 22.12+).
- npm.
- MongoDB. Use a replica-set-enabled deployment for workflows that perform multi-document transactions (including stock/order processing).
- An ImageKit account and server-side upload configuration for image-upload workflows.

## Local installation and development

### 1. Backend

```powershell
Set-Location -LiteralPath .\backend
npm ci
Copy-Item .env.example .env
```

Edit `backend/.env` locally with the values described below. Do not commit that file. Start the API:

```powershell
npm start
```

`npm start` runs the existing nodemon development command. The API listens on `PORT` (default `3000`). For a production process, use `node server.js` from `backend/`.

### 2. Frontend

In another terminal:

```powershell
Set-Location -LiteralPath .\frontend
npm ci
npm run dev
```

Vite serves the frontend and proxies `/api` to `http://localhost:3000` by default. If the backend uses another port, set `API_PROXY_TARGET` in the shell before starting Vite:

```powershell
$env:API_PROXY_TARGET = 'http://localhost:3001'
npm run dev
```

On macOS/Linux, the equivalent is `API_PROXY_TARGET=http://localhost:3001 npm run dev`.

### 3. First admin account

There is deliberately no public admin-registration path. Configure the backend environment for the intended database and follow the safe, one-time procedure in [backend/scripts/README.md](./backend/scripts/README.md). The script refuses to run if an admin already exists and does not update existing users. Do not run it against a database unless that is the intended target.

## Environment configuration

The backend reads `backend/.env`. The checked-in [backend/.env.example](./backend/.env.example) contains placeholders only; replace them in your local, ignored `.env` file. Never put private values in source code, frontend variables, screenshots, Postman exports, or this README.

| Variable | Required | Purpose and constraints |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string for the intended database. Use a replica set for transaction-backed stock/order workflows. |
| `JWT_SECRET` | Yes | Server-only signing secret, at least 32 UTF-8 bytes. |
| `JWT_EXPIRES_IN_SECONDS` | No | JWT and cookie lifetime in seconds; defaults to `86400`, allowed range `60`–`2592000`. |
| `PORT` | No | Backend listen port; defaults to `3000`. |
| `NODE_ENV` | No | Set to `production` on the deployed API so session cookies are marked secure. |
| `IMAGEKIT_PRIVATE_KEY` | Yes to start backend | Server-only ImageKit private key. **Never expose this to the browser.** |
| `IMAGEKIT_PUBLIC_KEY` | Required for uploads | ImageKit public key returned with the signed upload parameters. It is not a private credential. |
| `IMAGEKIT_URL_ENDPOINT` | Required for uploads | ImageKit URL endpoint for the account. |
| `FRONTEND_ORIGIN` | Required for a separate frontend origin | Exact frontend origin allowed by credentialed CORS, e.g. `https://YOUR_FRONTEND_HOST` (placeholder only). Leave unset when using the same-origin Vite proxy locally. |

Frontend/build configuration:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | No | API base URL embedded at frontend build time when the frontend and API are on separate origins. Leave unset for same-origin `/api` requests. |
| `API_PROXY_TARGET` | No | Vite development-server proxy target, read by `vite.config.js` from the process environment. Defaults to `http://localhost:3000`. |
| `VITE_IMAGEKIT_PUBLIC_KEY` | No | Optional browser-side public-key fallback. The backend upload-auth response is the normal source. Never configure an ImageKit private key with a `VITE_` prefix. |

The upload-auth endpoint returns a short-lived signature. Product/profile/logo image flows require the backend ImageKit public key and URL endpoint to be configured as well as the private key.

The bootstrap command also reads `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` from the process environment. These are one-time operator inputs, not persistent application settings; use the secure procedure in [backend/scripts/README.md](./backend/scripts/README.md) rather than putting them in a committed file.

For cross-origin production deployment, use HTTPS, set `FRONTEND_ORIGIN` to the frontend origin, and set `VITE_API_BASE_URL` to the API origin at build time. The app sends requests with credentials; the backend configures credentialed CORS and secure cross-site cookies when a frontend origin is configured.

## Database collections and relationships

Mongoose stores the application data in these collections (using its standard collection-name pluralization):

| Collection | Purpose and relationships |
| --- | --- |
| `users` | Accounts for all four roles. `assignedWarehouses` references warehouses; each user’s `cart` contains product references. Supplier profile/company and logo fields are stored on the supplier’s user document; there is no separate supplier collection. |
| `products` | Product details and ImageKit URL/file ID. `supplier`, `createdBy`, and the required legacy `admin` field reference users. SKU is unique when present. |
| `warehouses` | Warehouse details, capacity, and `manager`/`managers` references to users with the `warehouseManager` role. |
| `stocks` | Quantity for a product at a warehouse. References `products` and `warehouses`; a unique compound index prevents duplicate product/warehouse records, and quantity is nonnegative. |
| `stocktransactions` | Stock movement history; references product, warehouse, performer, and optionally an order. |
| `orders` | Order owner and warehouse references, multiple product line items with name/price snapshots, status and totals. |
| `supplyrequests` | Supplier request for a product and warehouse, with quantity, status, and optional reviewer reference. |

Schema definitions are in [backend/src/models/](./backend/src/models/).

## API reference

All paths below are under the backend origin. Protected endpoints use the HttpOnly `token` cookie. The role list shows which roles may call a route; data is further scoped where noted.

### Authentication and users

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Register a `salesRepresentative`; role input cannot create an admin. |
| `POST /api/auth/login` | Public | Login with username or email and password; sets the session cookie. |
| `POST /api/auth/logout` | Public | Clear the session cookie. |
| `GET /api/auth/me` | Authenticated | Return the current safe user profile. |
| `PUT /api/auth/me` | Authenticated | Update the current user profile and optional profile image. |
| `POST /api/auth/users` | Admin | Create a user with one of the four supported roles. |
| `GET /api/users` | Admin | List users. |
| `PUT /api/users/:id` | Admin | Update a user. |
| `DELETE /api/users/:id` | Admin | Delete a user subject to backend validation. |

### Products, suppliers, and images

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/products` | Authenticated | List/search products; supplier results are restricted to that supplier. Supports `search`, `category`, and optional stock filters. |
| `GET /api/products/:id` | Authenticated | Get a product; supplier access is restricted to their own products. |
| `POST /api/products` | Admin, warehouse manager | Create a product. |
| `PUT /api/products/:id` | Admin, warehouse manager | Update a product. |
| `DELETE /api/products/:id` | Admin | Delete a product only when it has no protected stock/history/order/request references. |
| `GET /api/product` and `GET /api/product/:productId` | Authenticated | Legacy singular-route aliases for product listing/detail. |
| `POST /api/product/create` and `PATCH /api/product/:productId` | Admin, warehouse manager | Legacy singular-route aliases for product create/update. |
| `DELETE /api/product/:productId` | Admin | Legacy singular-route alias for product deletion. |
| `GET /api/suppliers` | Admin, warehouse manager | Return limited supplier options for product forms. |
| `GET /api/suppliers/profile` | Supplier | Get the current supplier’s profile. |
| `PUT /api/suppliers/profile` | Supplier | Update the current supplier’s company profile/logo. |
| `GET /api/upload/auth` | Authenticated, all four roles | Obtain short-lived signed ImageKit upload parameters; never returns the private key. |

Recommended image flow: request signed parameters from `/api/upload/auth`, upload directly to ImageKit, then submit the resulting `imageUrl` and `imageFileId` with the product/profile update. Do not send the ImageKit private key to the frontend.

### Warehouses and stock

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/warehouses` | All four roles | List warehouses; warehouse managers see assigned warehouses only. |
| `GET /api/warehouses/:warehouseId` | All four roles | Get warehouse details; manager access is assignment-scoped. |
| `POST /api/warehouses` | Admin | Create a warehouse and assign managers. |
| `PUT /api/warehouses/:warehouseId` | Admin | Update warehouse details/assignments. |
| `PATCH /api/warehouses/:warehouseId` | Admin | Update warehouse details/assignments (alias). |
| `DELETE /api/warehouses/:warehouseId` | Admin | Delete a warehouse subject to backend reference checks. |
| `GET /api/stock` | Admin, warehouse manager, sales representative | Read stock; managers are restricted to assigned warehouses. Optional `warehouseId` filter. |
| `GET /api/stock/low` | Admin, warehouse manager | Read low-stock items; optional `warehouseId` and `threshold`. |
| `GET /api/stock/transactions` | Admin, warehouse manager | Read paginated stock transaction history. |
| `GET /api/transactions` | Admin, warehouse manager | Alias for stock transaction history. |
| `POST /api/stock/in` | Admin, warehouse manager | Record stock-in. |
| `POST /api/stock/out` | Admin, warehouse manager | Record stock-out; negative stock is rejected. |

Stock movement bodies use `warehouseId`, `productId`, and a positive integer `quantity`; `note` is optional.

### Orders, carts, and supplier requests

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/orders` | Admin, sales representative | Create a `Pending` order with `warehouseId`, customer name/phone, and multiple `items` (`productId`, `quantity`). |
| `GET /api/orders` | Admin, sales representative, warehouse manager | List orders; sales representatives see their own orders and managers see orders for assigned warehouses. |
| `GET /api/orders/:id` | Admin, sales representative, warehouse manager | Read an order subject to the same ownership/warehouse scope. |
| `PUT /api/orders/:id/status` | Admin, warehouse manager | Transition `Pending` → `Processing` (deducts stock transactionally), then `Processing` → `Completed`. |
| `PUT /api/orders/:id/cancel` | Admin, sales representative | Cancel a pending order; sales representatives may cancel only their own orders. |
| `GET /api/cart` | Authenticated | Get the current user’s cart. |
| `POST /api/cart/items` | Authenticated | Add a product to the current user’s cart (`productId`, optional `quantity`). |
| `DELETE /api/cart/items/:productId` | Authenticated | Remove a product from the current user’s cart. |
| `POST /api/supply-requests` | Supplier | Submit a request for one of the supplier’s own products (`productId`, `warehouseId`, `quantity`, optional `note`). |
| `GET /api/supply-requests` | Supplier, admin | Suppliers see their own requests; admins see all. |
| `PUT /api/supply-requests/:id/status` | Admin | Approve or reject a pending supply request. |

## Tests and Postman

Run the automated checks from the corresponding application directories:

```powershell
Set-Location -LiteralPath .\backend
npm test

Set-Location -LiteralPath ..\frontend
node --test
npm run build
```

The Postman collection is [backend/postman/Inventory-Warehouse-Management.postman_collection.json](./backend/postman/Inventory-Warehouse-Management.postman_collection.json). It exercises authentication, role gates, resource workflows, and ImageKit upload scenarios.

**The Postman collection creates and updates test records and may upload test images. Never run it against production.** Before running:

1. Start the backend with `MONGODB_URI` pointed to a dedicated replica-set database whose database name ends in `_test`.
2. Verify the backend’s active database target independently; the Postman guard cannot inspect the server’s MongoDB URI.
3. Configure a Postman environment with placeholders replaced locally for `baseUrl`, `testDatabaseName`, `testDatabaseConfirmed`, `adminUsername`, `adminPassword`, and `testAccountPassword`. Set `testDatabaseConfirmed` to `true` only after confirming the backend target.
4. For ImageKit cases, select a local test image as `imagePath` and set collection variable `ikPublicKey`. The private key belongs only in backend environment configuration.
5. Run the collection with its cookie jar enabled. Do not export/share an environment containing real credentials.

The collection has a guard for local API URLs and an explicitly confirmed `_test` database name. That guard is not a substitute for checking `backend/.env`.

## Deployment

1. Provision a MongoDB replica-set deployment and an ImageKit account. Keep all private values in the deployment platform’s secret/environment settings.
2. Deploy the backend from `backend/`: install with `npm ci`, configure the backend variables above, and start with `node server.js` (or the host’s Node start command). Set `PORT` to the port supplied by the host. Do not expose `.env`.
3. Deploy the frontend as a static Vite site. Build from `frontend/` using `npm ci` and `npm run build`; publish `frontend/dist/`. Configure the static host’s SPA fallback to serve `index.html` for client-side routes if needed.
4. For separate frontend and API origins, set `FRONTEND_ORIGIN` on the backend and `VITE_API_BASE_URL` at frontend build time. Use HTTPS on both sides so credentialed cookies can be sent securely.
5. Verify health/login, each role’s permissions, image upload, stock/order transaction workflows, and deployed CORS/cookie behavior against the deployment before claiming it is working.

No deployment URL or live deployment verification is provided by this repository documentation.

## Final submission checklist

- Keep all `.env` files, keys, passwords, database URIs, and Postman secrets out of Git.
- Confirm the root `.gitignore` is in effect; inspect `git status` before staging.
- Include the source, lockfiles, root README, backend environment template, and Postman collection.
- Create and push a commit to the intended submission remote. Provide any demo/deployment links required by the hackathon submission form only after independently verifying them.
- Do not claim tests, external service configuration, or deployment passed unless those checks were actually run.
