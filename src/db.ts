import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  application_name: "campania-ninja-tse-collector",
});

pool.on("error", (error) => {
  process.stderr.write(`PostgreSQL pool error: ${error.message}\n`);
});

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", ["campania-ninja-tse-migrations"]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const migrationsDirectory = join(process.cwd(), "migrations");
    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const exists = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (exists.rowCount) continue;
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", ["campania-ninja-tse-migrations"])
      .catch(() => undefined);
    client.release();
  }
}

export async function closeDatabase() {
  await pool.end();
}

export async function databaseReady() {
  const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
