// Seed the single household and its two members.
// Idempotent: does nothing if a household already exists.
// Rename the placeholder users later (or edit this file and re-run on a fresh DB).
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const existing = await sql`SELECT id FROM households LIMIT 1`;
if (existing.length) {
  console.log("Seed skipped: a household already exists.");
  process.exit(0);
}

const inserted = await sql`INSERT INTO households (name) VALUES ('Home') RETURNING id`;
const householdId = inserted[0].id;

await sql`
  INSERT INTO users (household_id, name, email) VALUES
    (${householdId}, 'You', 'you@example.com'),
    (${householdId}, 'Partner', 'partner@example.com')`;

console.log('Seeded household "Home" + 2 users (you@example.com, partner@example.com).');
