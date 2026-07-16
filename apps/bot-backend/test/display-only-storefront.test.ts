import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../src/http/app.js";
import {silentLogger} from "../src/logger.js";
import {testConfig} from "./helpers/fixtures.js";
import {InMemorySupportStore} from "./helpers/in-memory-store.js";

describe("display-only storefront", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => app?.close());

  it("does not expose order creation or order history APIs", async () => {
    app = buildApp({config: testConfig(), store: new InMemorySupportStore(), logger: silentLogger});
    const create = await app.inject({method: "POST", url: "/api/store/orders", payload: {items: []}});
    const list = await app.inject({method: "GET", url: "/api/store/orders"});
    assert.equal(create.statusCode, 404);
    assert.equal(list.statusCode, 404);
  });
});
