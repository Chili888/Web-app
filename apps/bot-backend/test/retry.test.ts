import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {TelegramApiError} from "../src/telegram/adapter.js";
import {FIXED_NOW, createHarness, customerUpdate, persistAndProcess} from "./helpers/fixtures.js";

describe("Telegram retry policy", () => {
  it("uses retry_after for a rate-limited customer copy", async () => {
    const harness = createHarness();
    harness.telegram.failNext("copyMessage", new TelegramApiError("Too Many Requests", 429, 7));
    await persistAndProcess(harness, customerUpdate(300, 3000));

    const update = harness.store.updates.get(300);
    const outbox = harness.store.outbox.get("update:300:admin:7141080131:copy");
    assert.equal(update?.status, "retry");
    assert.equal(update?.nextAttemptAt.toISOString(), new Date(FIXED_NOW.getTime() + 7000).toISOString());
    assert.equal(outbox?.status, "retry");
    assert.equal(outbox?.nextAttemptAt.toISOString(), new Date(FIXED_NOW.getTime() + 7000).toISOString());
  });

  it("does not duplicate a successful summary when a later side effect retries", async () => {
    const harness = createHarness();
    harness.telegram.failNext("copyMessage", new TelegramApiError("Temporary failure", 500));
    await persistAndProcess(harness, customerUpdate(310, 3100));
    assert.equal(harness.telegram.count("sendMessage"), 1);

    const update = harness.store.updates.get(310);
    if (update) update.nextAttemptAt = FIXED_NOW;
    const outbox = harness.store.outbox.get("update:310:admin:7141080131:copy");
    if (outbox) outbox.nextAttemptAt = FIXED_NOW;
    await harness.service.processNext();

    assert.equal(harness.store.updates.get(310)?.status, "completed");
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.telegram.count("copyMessage"), 2);
    assert.equal(harness.store.routes.length, 2);
  });
});
