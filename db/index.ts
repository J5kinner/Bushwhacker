import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/** Whether a Neon connection string is configured in the environment. */
export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function createDb(url: string) {
  return drizzle(neon(url), { schema });
}

let _db: ReturnType<typeof createDb> | undefined;

/**
 * Lazily-constructed Drizzle client. Reading the connection string at call time
 * (not import time) keeps `next build` from throwing when DATABASE_URL is unset —
 * pages guard on isDbConfigured() and only call this during a real request.
 */
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Add your Neon connection string to .env.local (see .env.local.example).",
      );
    }
    _db = createDb(url);
  }
  return _db;
}
