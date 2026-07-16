import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {describe, it} from "node:test";
import {TelegramApiError} from "../src/telegram/adapter.js";
import {ADMIN_ID, FIXED_NOW, createHarness} from "./helpers/fixtures.js";

describe("channel publication", () => {
  it("publishes one scheduled text post and does not publish it twice", async () => {
    const harness = createHarness();
    harness.store.channelPosts.push({
      id: randomUUID(),
      status: "scheduled",
      contentType: "text",
      content: {text: "频道公告", pin: true},
      parseMode: "HTML",
      scheduledAt: new Date(FIXED_NOW.getTime() - 1000),
      attempts: 0,
      maxAttempts: 3
    });

    assert.equal(await harness.service.processMaintenance(), true);
    assert.equal(await harness.service.processMaintenance(), false);
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.telegram.count("pinChatMessage"), 1);
    assert.equal(harness.store.channelPosts[0]?.status, "published");
  });

  it("deletes every message in a published media group", async () => {
    const harness = createHarness();
    const post = await harness.store.createChannelPost({
      contentType: "media_group",
      content: {media: [
        {type: "photo", media: "file-a"},
        {type: "photo", media: "file-b"}
      ]},
      parseMode: null,
      scheduledAt: new Date(0),
      timezone: "Asia/Shanghai",
      actorTelegramId: ADMIN_ID
    });
    await harness.service.processMaintenance();
    const operation = await harness.store.createChannelOperation({
      channelPostId: post.id,
      expectedVersion: 1,
      idempotencyKey: "delete-media-group-1",
      action: "delete",
      payload: {},
      actorTelegramId: ADMIN_ID
    });
    assert.ok(operation);
    await harness.service.processMaintenance();
    assert.equal(harness.telegram.count("deleteMessage"), 2);
    assert.ok(harness.store.channelPosts[0]?.deletedAt);
  });

  it("publishes a media group in its configured order", async () => {
    const harness = createHarness();
    harness.store.channelPosts.push({
      id: randomUUID(),
      status: "scheduled",
      contentType: "media_group",
      content: {media: [
        {type: "photo", media: "photo-file-id", caption: "封面"},
        {type: "video", media: "video-file-id"}
      ]},
      parseMode: null,
      scheduledAt: new Date(FIXED_NOW.getTime() - 1000),
      attempts: 0,
      maxAttempts: 3
    });

    await harness.service.processMaintenance();
    assert.equal(harness.telegram.count("sendMediaGroup"), 1);
    assert.equal(harness.store.channelPosts[0]?.status, "published");
  });

  it("reschedules a Telegram rate-limited post using retry_after", async () => {
    const harness = createHarness();
    harness.telegram.failNext("sendMessage", new TelegramApiError("Too Many Requests", 429, 12));
    harness.store.channelPosts.push({
      id: randomUUID(),
      status: "scheduled",
      contentType: "text",
      content: {text: "稍后发布"},
      parseMode: null,
      scheduledAt: new Date(FIXED_NOW.getTime() - 1000),
      attempts: 0,
      maxAttempts: 3
    });

    await harness.service.processMaintenance();
    assert.equal(harness.store.channelPosts[0]?.status, "failed");
    assert.equal(harness.store.channelPosts[0]?.scheduledAt?.toISOString(), "2026-07-15T12:30:12.000Z");
  });
});
