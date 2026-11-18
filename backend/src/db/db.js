import dns from "node:dns/promises";
import mongoose from "mongoose";
import { MONGODB_URI } from "../config/env.js";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

async function connectDB() {
  const uri = new URL(MONGODB_URI);
  const hasAuthSource = [...uri.searchParams.keys()].some(
    (key) => key.toLowerCase() === "authsource"
  );
  const options =
    uri.protocol === "mongodb+srv:" && !hasAuthSource
      ? { authSource: "admin" }
      : {};

  await mongoose.connect(MONGODB_URI, options);
  console.log("Connected to DB");
}

export default connectDB;
