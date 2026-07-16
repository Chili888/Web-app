import {createHash} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {Pool} from "pg";
import {databasePoolConfig} from "../database.js";
import {withoutOuterTransaction} from "./migration-sql.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsPath = resolve(process.cwd(), "supabase/migrations");
const pool = new Pool(databasePoolConfig(databaseUrl, {max: 1}));

try {
  await pool.query("create schema if not exists support");
  await pool.query(`
    create table if not exists support.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsPath))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    const sql = await readFile(resolve(migrationsPath, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await pool.query<{checksum: string}>(
      "select checksum from support.schema_migrations where name = $1",
      [name]
    );

    if (applied.rowCount) {
      if (applied.rows[0]?.checksum !== checksum) {
        throw new Error(`Applied migration was modified: ${name}`);
      }
      process.stdout.write(`skip ${name}\n`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(withoutOuterTransaction(sql));
      await client.query(
        "insert into support.schema_migrations (name, checksum) values ($1, $2)",
        [name, checksum]
      );
      await client.query("commit");
      process.stdout.write(`applied ${name}\n`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
