// Read-only inspection of the configured Neon database.
// Prints object names and row estimates only — never the connection string.
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;
const views = await sql`
  SELECT table_name FROM information_schema.views
  WHERE table_schema = 'public' ORDER BY table_name`;
const seqs = await sql`
  SELECT sequence_name FROM information_schema.sequences
  WHERE sequence_schema = 'public' ORDER BY sequence_name`;
const enums = await sql`
  SELECT t.typname FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY 1`;
const counts = await sql`
  SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname`;

const rows = Object.fromEntries(counts.map((r) => [r.relname, r.n_live_tup]));

console.log("TABLES (" + tables.length + "):");
for (const t of tables) {
  console.log(`  - ${t.table_name}  (~${rows[t.table_name] ?? 0} rows)`);
}
console.log("VIEWS:", views.map((v) => v.table_name).join(", ") || "(none)");
console.log("SEQUENCES:", seqs.map((s) => s.sequence_name).join(", ") || "(none)");
console.log("ENUM TYPES:", enums.map((e) => e.typname).join(", ") || "(none)");
