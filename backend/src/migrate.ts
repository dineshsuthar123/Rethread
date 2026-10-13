import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || config.databaseUrl,
  max: 1,
});
import { hash } from "./security.js";
const db = await pool.connect();
try {
  await db.query("SELECT pg_advisory_lock(717421)");
  await db.query("CREATE SCHEMA IF NOT EXISTS rethread");
  await db.query(
    "CREATE TABLE IF NOT EXISTS rethread.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = fileURLToPath(
    new URL("../../migrations/", import.meta.url),
  );
  for (const version of (await readdir(directory))
    .filter((x) => /^\d+.*\.sql$/.test(x))
    .sort()) {
    const sql = await readFile(`${directory}/${version}`, "utf8");
    const applied = await db.query(
      "SELECT checksum FROM rethread.schema_migrations WHERE version=$1",
      [version],
    );
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== hash(sql))
        throw new Error(`Migration checksum mismatch: ${version}`);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(
        "INSERT INTO rethread.schema_migrations(version,checksum) VALUES($1,$2)",
        [version, hash(sql)],
      );
      await db.query("COMMIT");
      console.log(`Applied ${version}`);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await db.query("SELECT pg_advisory_unlock(717421)");
  db.release();
  await pool.end();
}
