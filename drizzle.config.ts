import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// Load the Neon connection string from .env.local (never committed).
config({ path: ".env.local" });

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  // Only used by `migrate`/`push`/`studio`; `generate` does not need a live DB.
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
