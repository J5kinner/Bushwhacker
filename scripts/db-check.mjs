// Verification helper. Usage: node scripts/db-check.mjs <counts|insert|clean>
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const action = process.argv[2] ?? "counts";

if (action === "counts") {
  for (const t of ["households", "users", "shopping_items", "calendar_events", "chores"]) {
    const r = await sql.query(`SELECT count(*)::int AS n FROM public.${t}`);
    console.log(`${t}: ${r[0].n}`);
  }
} else if (action === "insert") {
  const [h] = await sql`SELECT id FROM households LIMIT 1`;
  await sql`INSERT INTO shopping_items (household_id, name, category) VALUES (${h.id}, '__VERIFY__ oat milk', 'Dairy')`;
  console.log("inserted verify item into household", h.id);
} else if (action === "clean") {
  await sql`DELETE FROM shopping_items WHERE name LIKE '__VERIFY__%'`;
  console.log("removed verify items");
}
