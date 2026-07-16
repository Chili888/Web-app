import {loadConfig} from "./config.js";
import {buildApp} from "./http/app.js";
import {createLogger} from "./logger.js";
import {PostgresSupportStore} from "./store/postgres-store.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const store = new PostgresSupportStore(config.databaseUrl);
const app = buildApp({config, store, logger});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({signal}, "Shutting down API");
  await app.close();
  await store.close();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({host: "0.0.0.0", port: config.port});
  logger.info({port: config.port}, "Telegram operations API listening");
} catch (error) {
  logger.error({error: error instanceof Error ? error.message : "unknown"}, "API startup failed");
  await store.close();
  process.exitCode = 1;
}
