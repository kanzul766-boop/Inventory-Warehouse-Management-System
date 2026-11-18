# Stockroom frontend

For complete project setup, roles, API routes, environment variables, testing, and deployment instructions, see the [root README](../README.md).

## Run locally

From this directory, run `npm ci` and then `npm run dev`. The Vite development server proxies `/api` requests to `http://localhost:3000` by default. If the backend port differs, set `API_PROXY_TARGET` in the shell environment before starting Vite.

For deployments where the API is not served from the same origin, set `VITE_API_BASE_URL` to its base URL at build time and set the backend `FRONTEND_ORIGIN` to the exact frontend origin. Browser requests include credentials; the backend allowlists that origin and enables secure cross-site cookies in production.

Image uploads request short-lived authentication parameters from `/api/upload/auth`. Only the public key and signed upload parameters are used by the browser; no private key belongs in this project.
