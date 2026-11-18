import express  from "express";
import authRoutes from "./routes/auth.routes.js";
import productRoutes from "./routes/product.routes.js";
import productsRoutes from "./routes/products.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import warehouseRoutes from "./routes/warehouse.routes.js";
import stockRoutes from "./routes/stock.routes.js";
import orderRoutes from "./routes/order.routes.js";
import supplierRoutes from "./routes/supplier.routes.js";
import supplyRequestRoutes from "./routes/supply-request.routes.js";
import userRoutes from "./routes/user.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import transactionRoutes from "./routes/transaction.routes.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import { FRONTEND_ORIGIN } from "./config/env.js";
const app = express();
if (FRONTEND_ORIGIN) {
    app.use(cors({
        origin: FRONTEND_ORIGIN,
        credentials: true,
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type"]
    }));
}
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/upload", uploadRoutes)
app.use("/api/product",productRoutes )
app.use("/api/products", productsRoutes)
app.use("/api/cart",cartRoutes )
app.use("/api/warehouses", warehouseRoutes)
app.use("/api/stock", stockRoutes)
app.use("/api/transactions", transactionRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/suppliers", supplierRoutes)
app.use("/api/supply-requests", supplyRequestRoutes)

export default app;