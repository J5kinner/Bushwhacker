// Seed / sync the single household and its members from env (no personal data
// in committed source — the repo is public).
//   SEED_MEMBERS="Name:email,Name:email"   (in .env.local)
// Renames existing member rows in order, inserts any extras. Safe to re-run.
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const HOUSEHOLD_NAME = process.env.HOUSEHOLD_NAME || "Home";

const members = (process.env.SEED_MEMBERS || "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const idx = pair.indexOf(":");
    return { name: pair.slice(0, idx).trim(), email: pair.slice(idx + 1).trim() };
  })
  .filter((m) => m.name && m.email);

if (members.length === 0) {
  console.error('SEED_MEMBERS is not set. Format: "Name:email,Name:email"');
  process.exit(1);
}

let [household] = await sql`SELECT id FROM households LIMIT 1`;
if (!household) {
  [household] = await sql`INSERT INTO households (name) VALUES (${HOUSEHOLD_NAME}) RETURNING id`;
  console.log(`created household "${HOUSEHOLD_NAME}"`);
}

const existing = await sql`
  SELECT id FROM users WHERE household_id = ${household.id} ORDER BY created_at`;

for (let i = 0; i < members.length; i++) {
  const { name, email } = members[i];
  if (existing[i]) {
    await sql`UPDATE users SET name = ${name}, email = ${email} WHERE id = ${existing[i].id}`;
    console.log(`updated member: ${name} <${email}>`);
  } else {
    await sql`INSERT INTO users (household_id, name, email) VALUES (${household.id}, ${name}, ${email})`;
    console.log(`inserted member: ${name} <${email}>`);
  }
}

const current = await sql`
  SELECT name, email FROM users WHERE household_id = ${household.id} ORDER BY created_at`;
console.log("current members:", current.map((u) => `${u.name} <${u.email}>`).join(", "));
