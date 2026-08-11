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

/**
 * The schema shelf owns. Defaults to `public`, which is right for a database
 * of its own.
 *
 * It exists because Render allows exactly ONE free Postgres per account, so
 * the realistic setup is shelf sharing a database with something else — and
 * sharing it naively is destructive in a way that looks like success:
 *
 *   - soundcheck-api's first migration is also called `001_init.sql`, and it
 *     is already recorded in `schema_migrations`. shelf would therefore SKIP
 *     its own migrations, create no tables, and boot green.
 *   - both projects have a `users` table, so `create table if not exists`
 *     would quietly no-op and shelf would start writing rows into the other
 *     application's users.
 *
 * With DB_SCHEMA=shelf, every one of shelf's tables — schema_migrations
 * included — lives in its own namespace and neither can see the other.
 */
export const DB_SCHEMA = (process.env.DB_SCHEMA || "public").trim();

// It goes into DDL, so it is validated rather than escaped. An identifier that
// needs quoting is an identifier nobody should be typing into an env var.
if (!/^[a-z_][a-z0-9_]*$/.test(DB_SCHEMA)) {
  throw new Error(`DB_SCHEMA must be a plain lowercase identifier, got ${JSON.stringify(DB_SCHEMA)}`);
}

/** A unix socket or loopback host — nothing on the wire to protect. */
export function isLocal(url) {
  const u = String(url || "");
  return /host=%2F|host=\//.test(u) || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(u) || /sslmode=disable/.test(u);
}

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
    // is acceptable there — the connection string host pins who we talk to.
    //
    // A local socket or loopback has no TLS and demanding it fails the
    // connection outright ("The server does not support SSL connections"),
    // which is what stopped the end-to-end suite from running at all. TLS is
    // still the DEFAULT: this only stands down for a database that is by
    // definition not crossing a network.
    ssl: isLocal(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: 8,
    idleTimeoutMillis: 30_000,
    // Only when a non-default schema is actually asked for. `options` is a
    // startup parameter, and connection poolers in transaction mode —
    // including the PgBouncer behind Neon's `-pooler` endpoint — reject
    // startup parameters they were not configured to allow. Sending
    // `-c search_path=public` would be a no-op that could refuse to connect.
    //
    // Deliberately NOT "schema,public": including public would let shelf see
    // the other application's `users` again, which is the whole thing this is
    // preventing. shelf uses no extensions, so it needs nothing from public.
    ...(DB_SCHEMA === "public" ? {} : { options: `-c search_path=${DB_SCHEMA}` }),
  });
  return pool;
}

export async function query(text, params) {
  const p = await getPool();
  return p.query(text, params);
}

/**
 * Refuse to boot into somebody else's database.
 *
 * The failure this prevents is silent: a `schema_migrations` row named
 * `001_init.sql` that shelf did not write makes shelf skip every migration and
 * come up with no tables and a green health check. Better to not start.
 */
async function guardSharedDatabase() {
  if (DB_SCHEMA !== "public") return;   // isolated by construction
  const r = await query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'schema_migrations'`
  );
  if (!r.rowCount) return;              // fresh database, nothing to collide with
  const foreign = await query(
    `select 1 from public.schema_migrations m
      where m.name = '001_init.sql'
        and not exists (select 1 from information_schema.tables
                         where table_schema = 'public' and table_name = 'items')`
  );
  if (foreign.rowCount) {
    throw new Error(
      "This database already has a 001_init.sql from a DIFFERENT application. " +
      "shelf would skip its own migrations and come up with no tables. " +
      "Set DB_SCHEMA=shelf to give it its own namespace, or point DATABASE_URL at an empty database."
    );
  }
}

// Apply any migrations not yet recorded, in filename order, each in its own tx.
export async function migrate() {
  if (!dbReady()) {
    console.log("[db] DATABASE_URL not set — skipping migrations");
    return;
  }
  if (DB_SCHEMA !== "public") await query(`create schema if not exists ${DB_SCHEMA}`);
  await guardSharedDatabase();
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
