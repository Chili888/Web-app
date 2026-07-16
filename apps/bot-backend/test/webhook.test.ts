import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../src/http/app.js";
import {silentLogger} from "../src/logger.js";
import {customerUpdate, testConfig} from "./helpers/fixtures.js";
import {InMemorySupportStore} from "./helpers/in-memory-store.js";

describe("Telegram webhook", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("reports API liveness", async () => {
    const config = testConfig();
    app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});

    const response = await app.inject({method: "GET", url: "/health"});

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "telegram-operations-api",
      database: "ok",
      worker: "ok"
    });
  });

  it("describes the service at the root route", async () => {
    const config = testConfig();
    app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});

    const response = await app.inject({method: "GET", url: "/"});

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      service: "TJ Telegram Center",
      status: "running",
      health: "/health",
      storefront: config.appBaseUrl
    });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
  });

  it("allows CORS preflight from APP_BASE_URL without extra configuration", async () => {
    const config = testConfig({storefrontOrigins: new Set()});
    app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/bot/settings",
      headers: {
        origin: config.appBaseUrl,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization"
      }
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], config.appBaseUrl);
  });

  it("rejects missing or invalid webhook secrets", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});

    const missing = await app.inject({method: "POST", url: "/telegram/webhook", payload: customerUpdate(1, 1)});
    const invalid = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {"x-telegram-bot-api-secret-token": "incorrect"},
      payload: customerUpdate(1, 1)
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(invalid.statusCode, 401);
    assert.equal(store.updates.size, 0);
  });

  it("persists each update_id once and acknowledges duplicates", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});
    const request = {
      method: "POST" as const,
      url: "/telegram/webhook",
      headers: {"x-telegram-bot-api-secret-token": config.telegramWebhookSecret},
      payload: customerUpdate(10, 20)
    };

    const first = await app.inject(request);
    const duplicate = await app.inject(request);

    assert.equal(first.statusCode, 202);
    assert.equal(duplicate.statusCode, 202);
    assert.deepEqual(first.json(), {accepted: true, duplicate: false});
    assert.deepEqual(duplicate.json(), {accepted: true, duplicate: true});
    assert.equal(store.updates.size, 1);
  });
});
