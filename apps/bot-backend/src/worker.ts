import {randomUUID} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {loadConfig} from "./config.js";
import {createLogger} from "./logger.js";
import {OutboxExecutor} from "./services/outbox-executor.js";
import {safeErrorMessage} from "./services/outbox-executor.js";
import {SupportService} from "./services/support-service.js";
import {PostgresSupportStore} from "./store/postgres-store.js";
import {HttpTelegramAdapter} from "./telegram/http-adapter.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const store = new PostgresSupportStore(config.databaseUrl);
const telegram = new HttpTelegramAdapter(config.telegramBotToken);
const workerId = `worker-${randomUUID()}`;
const outbox = new OutboxExecutor(store, logger, {
  maxAttempts: config.workerMaxAttempts,
  retryBaseMs: config.workerRetryBaseMs,
  workerId
});
const service = new SupportService(config, store, telegram, outbox, logger, {workerId});
let running = true;
let lastHeartbeat = 0;
let failureDelayMs = Math.max(config.workerPollIntervalMs, 1_000);
const maximumFailureDelayMs = 15_000;

const shutdown = (signal: string): void => {
  running = false;
  logger.info({signal}, "Worker shutdown requested");
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

logger.info({workerId}, "Telegram operations worker started");
while (running) {
  try {
    const now = Date.now();
    if (now - lastHeartbeat >= 15_000) {
      await store.heartbeat(workerId, "telegram", new Date(now));
      lastHeartbeat = now;
    }
    const processed = await service.processNext();
    let maintained = false;
    if (!processed) {
      maintained = await service.processMaintenance();
    }
    failureDelayMs = Math.max(config.workerPollIntervalMs, 1_000);
    if (!processed && !maintained) await sleep(config.workerPollIntervalMs);
  } catch (error) {
    logger.error({error: safeErrorMessage(error), retryDelayMs: failureDelayMs}, "Telegram worker iteration failed");
    if (running) await sleep(failureDelayMs);
    failureDelayMs = Math.min(failureDelayMs * 2, maximumFailureDelayMs);
  }
}
await store.close();
logger.info({workerId}, "Telegram operations worker stopped");
