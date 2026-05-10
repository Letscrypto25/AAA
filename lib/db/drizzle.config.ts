import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

let connectionString = process.env.DATABASE_URL;
if (connectionString.includes("sslmode=")) {
  connectionString = connectionString.replace(/([?&])sslmode=[^&]*/, "$1").replace(/[?&]$/, "");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  },
});
