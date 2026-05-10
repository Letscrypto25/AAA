import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

let connectionString = process.env.DATABASE_URL;

// If the connection string contains sslmode, it might override the pool's ssl config.
// We strip it to ensure our rejectUnauthorized: false is respected.
if (connectionString.includes("sslmode=")) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    connectionString = url.toString();
  } catch (e) {
    // Fallback if URL parsing fails for some reason
    connectionString = connectionString.replace(/([?&])sslmode=[^&]*/, "$1").replace(/[?&]$/, "");
  }
}

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
