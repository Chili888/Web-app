import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {describe, it} from "node:test";
import {Pool} from "pg";
import {PostgresSupportStore} from "../src/store/postgres-store.js";
import {customerUpdate, customerUser} from "./helpers/fixtures.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe("PostgreSQL queue and routing", {skip: !databaseUrl}, () => {
  it("executes timestamptz queue comparisons and claims an update once", async () => {
    const store = new PostgresSupportStore(databaseUrl as string);
    const updateId = uniqueNumber(1);
    await store.persistUpdate(customerUpdate(updateId, uniqueNumber(2)));

    const now = new Date();
    const [first, second] = await Promise.all([
      store.claimNextUpdate("integration-a", now),
      store.claimNextUpdate("integration-b", now)
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
    await store.completeUpdate(updateId, "completed", "text");
    await store.close();
  });

  it("persists an administrator route across store instances", async () => {
    const firstStore = new PostgresSupportStore(databaseUrl as string);
    const updateId = uniqueNumber(3);
    const messageId = uniqueNumber(4);
    const user = customerUser(uniqueNumber(5));
    await firstStore.persistUpdate(customerUpdate(updateId, messageId, {from: user, chat: {id: user.id, type: "private"}}));
    const resolution = await firstStore.recordCustomerMessage({
      updateId,
      user,
      chatId: user.id,
      messageId,
      messageType: "text",
      mediaGroupId: null,
      telegramFileId: null,
      receivedAt: new Date()
    });
    const adminMessageId = uniqueNumber(6);
    await firstStore.createAdminRoute({
      adminTelegramId: 7141080131,
      adminChatId: 7141080131,
      adminMessageId,
      customerId: resolution.customer.id,
      customerChatId: user.id,
      customerMessageId: messageId,
      sourceMessageType: "text",
      routeType: "customer_content"
    });
    await firstStore.close();

    const restartedStore = new PostgresSupportStore(databaseUrl as string);
    const route = await restartedStore.findAdminRoute(7141080131, 7141080131, adminMessageId, new Date());
    assert.equal(route?.customerChatId, user.id);
    await restartedStore.completeUpdate(updateId, "completed", "text");
    await restartedStore.close();
  });

  it("persists dynamic bot settings and versioned automatic replies", async () => {
    const store = new PostgresSupportStore(databaseUrl as string);
    const current = await store.getBotSettings();
    const updated = await store.updateBotSettings({
      expectedVersion: current.version,
      welcomeMessage: `integration welcome ${randomUUID()}`,
      helpMessage: current.helpMessage,
      whyUsMessage: current.whyUsMessage,
      stockMessage: current.stockMessage,
      tradeRulesMessage: current.tradeRulesMessage,
      contactMessage: current.contactMessage,
      businessHours: current.businessHours,
      offlineMessage: current.offlineMessage,
      miniAppUrl: current.miniAppUrl,
      channelUrl: current.channelUrl,
      groupUrl: current.groupUrl,
      automaticReplyEnabled: current.automaticReplyEnabled,
      menuButtons: current.menuButtons
    });
    assert.equal(updated?.version, current.version + 1);
    assert.equal(await store.updateBotSettings({
      expectedVersion: current.version,
      welcomeMessage: current.welcomeMessage,
      helpMessage: current.helpMessage,
      whyUsMessage: current.whyUsMessage,
      stockMessage: current.stockMessage,
      tradeRulesMessage: current.tradeRulesMessage,
      contactMessage: current.contactMessage,
      businessHours: current.businessHours,
      offlineMessage: current.offlineMessage,
      miniAppUrl: current.miniAppUrl,
      channelUrl: current.channelUrl,
      groupUrl: current.groupUrl,
      automaticReplyEnabled: current.automaticReplyEnabled,
      menuButtons: current.menuButtons
    }), null);
    const rule = await store.createAutoReplyRule({
      enabled: true,
      matchType: "contains",
      keyword: `integration-${randomUUID()}`,
      responseContent: "integration response",
      priority: 100
    });
    const changedRule = await store.updateAutoReplyRule(rule.id, rule.version, {
      enabled: false,
      matchType: "exact",
      keyword: rule.keyword,
      responseContent: rule.responseContent,
      priority: 101
    });
    assert.equal(changedRule?.version, 2);
    assert.equal(changedRule?.enabled, false);
    await store.close();
  });

  it("claims expired join verification using typed timestamp parameters", async () => {
    const store = new PostgresSupportStore(databaseUrl as string);
    const updateId = uniqueNumber(7);
    const userId = uniqueNumber(8);
    await store.persistUpdate(customerUpdate(updateId, uniqueNumber(9)));
    const created = await store.createJoinVerification({
      updateId,
      telegramUserId: userId,
      telegramChatId: -100200300400,
      joinedAt: new Date(Date.now() - 20_000),
      expiresAt: new Date(Date.now() - 10_000),
      timeoutAction: "kick"
    });
    const claimed = await store.claimExpiredJoinVerification("integration-worker", new Date());
    assert.equal(claimed?.id, created.record.id);
    await store.completeJoinVerification(created.record.id, "expired", null);
    await store.completeUpdate(updateId, "completed", "system");
    await store.close();
  });

  it("claims one due channel post across concurrent workers", async () => {
    const pool = new Pool({connectionString: databaseUrl as string});
    await pool.query("delete from support.channel_posts where status in ('scheduled', 'publishing', 'failed')");
    const postId = randomUUID();
    await pool.query(
      `insert into support.channel_posts (
         id, status, content_type, content, scheduled_at, created_by_telegram_id
       ) values ($1, 'scheduled', 'text', $2::jsonb, $3::timestamptz, $4)`,
      [postId, JSON.stringify({text: "integration"}), new Date(Date.now() - 1000), 7141080131]
    );
    await pool.end();

    const firstStore = new PostgresSupportStore(databaseUrl as string);
    const secondStore = new PostgresSupportStore(databaseUrl as string);
    const now = new Date();
    const [first, second] = await Promise.all([
      firstStore.claimDueChannelPost("channel-a", now),
      secondStore.claimDueChannelPost("channel-b", now)
    ]);
    const claimed = [first, second].filter(Boolean);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.id, postId);
    assert.equal(await firstStore.completeChannelPost(postId, [uniqueNumber(10)], now), true);
    await firstStore.close();
    await secondStore.close();
  });

  it("acquires one outbox lease and executes typed retry timestamps", async () => {
    const firstStore = new PostgresSupportStore(databaseUrl as string);
    const secondStore = new PostgresSupportStore(databaseUrl as string);
    const now = new Date();
    const input = {
      idempotencyKey: `integration:${randomUUID()}`,
      action: "integration_action",
      payload: {safe: true},
      maxAttempts: 3,
      workerId: "outbox-a",
      now
    };
    const [first, second] = await Promise.all([
      firstStore.acquireOutbox(input),
      secondStore.acquireOutbox({...input, workerId: "outbox-b"})
    ]);
    assert.equal([first, second].filter((lease) => lease.execute).length, 1);
    const acquired = [first, second].find((lease) => lease.execute);
    assert.ok(acquired);
    const retryAt = new Date(now.getTime() + 5000);
    await firstStore.markOutboxRetry(acquired.record.id, "integration retry", retryAt, false);
    const early = await secondStore.acquireOutbox({...input, workerId: "outbox-c", now});
    assert.equal(early.execute, false);
    const due = await secondStore.acquireOutbox({...input, workerId: "outbox-c", now: retryAt});
    assert.equal(due.execute, true);
    await secondStore.markOutboxSent(due.record.id, {message_id: 1}, retryAt);
    await firstStore.close();
    await secondStore.close();
  });

  it("records a moderation mute with an explicit timestamptz parameter", async () => {
    const pool = new Pool({connectionString: databaseUrl as string});
    const rule = await pool.query<{id: string}>(
      `insert into support.moderation_rules (mode, rule_type, pattern)
       values ('mute', 'keyword', 'integration') returning id`
    );
    await pool.end();
    const store = new PostgresSupportStore(databaseUrl as string);
    const recorded = await store.recordModerationAction({
      chatId: -100200300400,
      userId: uniqueNumber(11),
      messageId: uniqueNumber(12),
      ruleId: rule.rows[0]?.id as string,
      action: "mute",
      reasonCode: "keyword",
      mutedUntil: new Date(Date.now() + 60_000)
    });
    assert.equal(recorded, true);
    await store.close();
  });

  it("persists channel drafts with optimistic versions and admin request idempotency", async () => {
    const store = new PostgresSupportStore(databaseUrl as string);
    const created = await store.createChannelPost({
      contentType: "text",
      content: {text: "database draft"},
      parseMode: "HTML",
      scheduledAt: null,
      timezone: "Asia/Shanghai",
      actorTelegramId: 7141080131
    });
    assert.equal(created.status, "draft");
    assert.equal(created.version, 1);
    const scheduledAt = new Date(Date.now() + 60_000);
    const updated = await store.updateChannelPost({
      id: created.id,
      expectedVersion: 1,
      contentType: "text",
      content: {text: "database scheduled"},
      parseMode: null,
      scheduledAt,
      timezone: "Asia/Shanghai",
      actorTelegramId: 7141080131
    });
    assert.equal(updated?.status, "scheduled");
    assert.equal(updated?.version, 2);
    const stale = await store.updateChannelPost({
      id: created.id,
      expectedVersion: 1,
      contentType: "text",
      content: {text: "stale update"},
      parseMode: null,
      scheduledAt: null,
      timezone: "Asia/Shanghai",
      actorTelegramId: 7141080131
    });
    assert.equal(stale, null);
    const key = `admin-api:${randomUUID()}`;
    assert.equal(await store.claimAdminApiRequest(key, 7141080131, "POST", "/api/admin/channel-posts"), true);
    assert.equal(await store.claimAdminApiRequest(key, 7141080131, "POST", "/api/admin/channel-posts"), false);
    await store.close();
  });

  it("executes durable channel and group operation queues", async () => {
    const store = new PostgresSupportStore(databaseUrl as string);
    const post = await store.createChannelPost({
      contentType: "text",
      content: {text: "operation integration"},
      parseMode: null,
      scheduledAt: new Date(Date.now() - 1000),
      timezone: "Asia/Shanghai",
      actorTelegramId: 7141080131
    });
    const claimedPost = await store.claimDueChannelPost("operation-publisher", new Date());
    assert.equal(claimedPost?.id, post.id);
    await store.completeChannelPost(post.id, [uniqueNumber(16), uniqueNumber(17)], new Date());
    const operation = await store.createChannelOperation({
      channelPostId: post.id,
      expectedVersion: 1,
      idempotencyKey: `channel-operation:${randomUUID()}`,
      action: "pin",
      payload: {},
      actorTelegramId: 7141080131
    });
    assert.ok(operation);
    const claimedOperation = await store.claimDueChannelOperation("operation-worker", new Date());
    assert.equal(claimedOperation?.id, operation.id);
    assert.ok(claimedOperation);
    await store.completeChannelOperation(claimedOperation, new Date());
    const published = (await store.listChannelPosts("published", 100)).find((item) => item.id === post.id);
    assert.equal(published?.isPinned, true);
    assert.equal(published?.channelMessageIds.length, 2);

    const settings = await store.getGroupModerationSettings();
    const updated = await store.updateGroupModerationSettings({...settings, muteAfterViolations: 3}, settings.version);
    assert.equal(updated?.muteAfterViolations, 3);
    assert.equal(await store.updateGroupModerationSettings(settings, settings.version), null);

    const groupOperation = await store.createGroupOperation({
      idempotencyKey: `group-operation:${randomUUID()}`,
      action: "unmute",
      telegramChatId: "@TJ_ice_Group",
      telegramUserId: uniqueNumber(18),
      untilAt: null,
      reason: "integration",
      actorTelegramId: 7141080131
    });
    const claimedGroup = await store.claimDueGroupOperation("group-operation-worker", new Date());
    assert.equal(claimedGroup?.id, groupOperation.id);
    await store.completeGroupOperation(groupOperation.id, new Date());
    await store.close();
  });
});

function uniqueNumber(suffix: number): number {
  return Number(`${Date.now().toString().slice(-8)}${suffix}`);
}
