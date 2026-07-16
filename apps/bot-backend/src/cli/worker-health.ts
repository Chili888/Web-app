import {Pool} from "pg";
import {databasePoolConfig} from "../database.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool(databasePoolConfig(databaseUrl, {max: 1, connectionTimeoutMillis: 5_000}));
try {
  const result = await pool.query<{healthy: boolean}>(
    `select coalesce(max(last_seen_at) >= (now() - interval '60 seconds'), false) as healthy
     from support.worker_heartbeats
     where worker_type = 'telegram'`
  );
  if (!result.rows[0]?.healthy) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
