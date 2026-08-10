// Thin Postgres layer (node-postgres), lifted from soundcheck-api/db.js because
// it has already survived a year of Render restarts and managed-PG TLS quirks.
//
// The DB is OPTIONAL at boot: with no DATABASE_URL, dbReady() is false and the
// process still starts and serves /api/health. That matters for the first
// deploy, when the service exists before the database does — a server that
// refuses to boot without a DB gives you no endpoint to debug with.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "migrations");

let pool = null;

export function dbReady() {
  return !!process.env.DATABASE_URL;
}

async function getPool() {
  if (!dbReady()) throw new Error("DATABASE_URL not set");
  if (pool) return pool;
  const { default: pg } = await import("pg");
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Managed PG (Render/Neon/Supabase) requires TLS. rejectUnauthorized:false
    // is acceptable here — the connection string host pins who we talk to.
    ssl: { rejectUnauthorized: false },
    max: 8,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export async function query(text, params) {
  const p = await getPool();
  return p.query(text, params);
}

// Apply any migrations not yet recorded, in filename order, each in its own tx.
export async function migrate() {
  if (!dbReady()) {
    console.log("[db] DATABASE_URL not set — skipping migrations");
    return;
  }
  await query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set(
    (await query("select name from schema_migrations")).rows.map((r) => r.name)
  );
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    const p = await getPool();
    const client = await p.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(name) values($1)", [f]);
      await client.query("commit");
      console.log(`[db] applied migration ${f}`);
    } catch (e) {
      await client.query("rollback");
      console.error(`[db] migration ${f} failed:`, e.message);
      throw e;
    } finally {
      client.release();
    }
  }
  console.log("[db] migrations up to date");
}
