import {Pool} from "pg";
import {databasePoolConfig} from "../database.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const outboxId = process.argv[2]?.trim();
if (!outboxId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(outboxId)) {
  throw new Error("A valid outbox UUID argument is required");
}
const actorIdValue = process.env.TELEGRAM_ADMIN_IDS?.split(",")[0]?.trim();
const actorId = actorIdValue ? Number(actorIdValue) : null;
if (actorId !== null && !Number.isSafeInteger(actorId)) throw new Error("TELEGRAM_ADMIN_IDS must contain safe integers");

const pool = new Pool(databasePoolConfig(databaseUrl, {max: 1}));
const client = await pool.connect();
try {
  await client.query("begin");
  const retried = await client.query<{action: string}>(
    `update support.telegram_outbox
     set status = 'retry', attempts = 0, next_attempt_at = now(),
         locked_at = null, locked_by = null
     where id = $1 and status = 'dead_letter'
     returning action`,
    [outboxId]
  );
  if (retried.rowCount !== 1) throw new Error("Outbox record was not found or is not dead-lettered");
  await client.query(
    `insert into support.audit_logs (
       actor_type, actor_telegram_id, action, entity_type, entity_id, metadata
     ) values ('support_agent', $1, 'outbox_manual_retry', 'telegram_outbox', $2, $3::jsonb)`,
    [actorId, outboxId, JSON.stringify({telegramMethod: retried.rows[0]?.action})]
  );
  await client.query("commit");
  process.stdout.write(`queued ${outboxId}\n`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
