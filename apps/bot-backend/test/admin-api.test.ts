import assert from "node:assert/strict";
import {createHmac, randomUUID} from "node:crypto";
import {afterEach, describe, it} from "node:test";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../src/http/app.js";
import {silentLogger} from "../src/logger.js";
import {ADMIN_ID, createHarness, testConfig} from "./helpers/fixtures.js";
import {InMemorySupportStore} from "./helpers/in-memory-store.js";

describe("administrator channel API", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => app?.close());

  it("rejects missing authentication and non-administrators", async () => {
    const config = testConfig();
    app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});
    const missing = await app.inject({method: "GET", url: "/api/admin/channel-posts"});
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/channel-posts",
      headers: {"x-telegram-init-data": signedInitData(10001, config.telegramBotToken)}
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(forbidden.statusCode, 403);
  });

  it("authorizes an existing Supabase administrator through RLS", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const config = testConfig({
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "publishable-key"
    });
    globalThis.fetch = async (input) => {
      const url = fetchInputUrl(input);
      requestedUrls.push(url);
      if (url.endsWith("/auth/v1/user")) {
        return Response.json({id: "6b38782a-d9bc-4383-9a66-96fa40e8f08e"});
      }
      if (url.includes("/rest/v1/admin_profiles?")) {
        return Response.json([{user_id: "6b38782a-d9bc-4383-9a66-96fa40e8f08e"}]);
      }
      return Response.json({}, {status: 404});
    };
    try {
      app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/bot/settings",
        headers: {authorization: "Bearer valid-supabase-session"}
      });
      assert.equal(response.statusCode, 200);
      assert.equal(requestedUrls.length, 2);
      assert.match(requestedUrls[1] ?? "", /admin_profiles/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a valid Supabase user without an administrator profile", async () => {
    const originalFetch = globalThis.fetch;
    const config = testConfig({
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "publishable-key"
    });
    globalThis.fetch = async (input) => fetchInputUrl(input).endsWith("/auth/v1/user")
      ? Response.json({id: "6b38782a-d9bc-4383-9a66-96fa40e8f08e"})
      : Response.json([]);
    try {
      app = buildApp({config, store: new InMemorySupportStore(), logger: silentLogger});
      const response = await app.inject({
        method: "GET",
        url: "/api/admin/bot/settings",
        headers: {authorization: "Bearer ordinary-supabase-session"}
      });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), {error: "forbidden"});
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates an authenticated draft and rejects a duplicate mutation", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});
    const request = {
      method: "POST" as const,
      url: "/api/admin/channel-posts",
      headers: adminHeaders(config.telegramBotToken, "create-post-0001"),
      payload: {contentType: "text", content: {text: "测试公告"}}
    };
    const created = await app.inject(request);
    const duplicate = await app.inject(request);
    assert.equal(created.statusCode, 201);
    assert.equal(created.json<{status: string}>().status, "draft");
    assert.equal(duplicate.statusCode, 409);
    assert.equal(store.channelPosts.length, 1);
    assert.equal(store.audits.at(-1)?.action, "channel_post_created");
  });

  it("validates content before consuming the idempotency key", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/channel-posts",
      headers: adminHeaders(config.telegramBotToken, "invalid-post-0001"),
      payload: {contentType: "text", content: {text: ""}}
    });
    assert.equal(response.statusCode, 400);
    assert.equal(store.adminApiRequests.size, 0);
  });

  it("uses a version condition when editing a draft", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    const post = await store.createChannelPost({
      contentType: "text",
      content: {text: "原内容"},
      parseMode: null,
      scheduledAt: null,
      timezone: "Asia/Shanghai",
      actorTelegramId: ADMIN_ID
    });
    app = buildApp({config, store, logger: silentLogger});
    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/admin/channel-posts/${post.id}`,
      headers: adminHeaders(config.telegramBotToken, "update-post-0001"),
      payload: {contentType: "text", content: {text: "新内容"}, expectedVersion: 99}
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(store.channelPosts[0]?.content.text, "原内容");
  });

  it("persists an immediate post for asynchronous Worker publication", async () => {
    const config = testConfig();
    const harness = createHarness(config, new Date(Date.now() + 60_000));
    app = buildApp({config, store: harness.store, logger: silentLogger});
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/channel-posts",
      headers: adminHeaders(config.telegramBotToken, "publish-post-0001"),
      payload: {contentType: "text", content: {text: "立即发布"}, publishNow: true}
    });
    assert.equal(created.statusCode, 201);
    assert.equal(harness.telegram.count("sendMessage"), 0);
    await harness.service.processMaintenance();
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.store.channelPosts[0]?.status, "published");
  });

  it("queues and executes an edit for a published channel message", async () => {
    const config = testConfig();
    const workerNow = new Date(Date.now() + 60_000);
    const harness = createHarness(config, workerNow);
    const post = await harness.store.createChannelPost({
      contentType: "text",
      content: {text: "原频道内容"},
      parseMode: null,
      scheduledAt: new Date(0),
      timezone: "Asia/Shanghai",
      actorTelegramId: ADMIN_ID
    });
    await harness.service.processMaintenance();
    app = buildApp({config, store: harness.store, logger: silentLogger});
    const queued = await app.inject({
      method: "POST",
      url: `/api/admin/channel-posts/${post.id}/actions`,
      headers: adminHeaders(config.telegramBotToken, "edit-post-0001"),
      payload: {action: "edit_text", text: "修改后的频道内容", expectedVersion: 1}
    });
    assert.equal(queued.statusCode, 202);
    assert.equal(harness.telegram.count("editMessageText"), 0);
    await harness.service.processMaintenance();
    assert.equal(harness.telegram.count("editMessageText"), 1);
    assert.equal(harness.store.channelPosts[0]?.content.text, "修改后的频道内容");
    assert.equal(harness.store.audits.at(-1)?.action, "channel_post_edit_text_completed");
  });

  it("loads and updates dynamic bot menu settings with optimistic concurrency", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});
    const fetched = await app.inject({
      method: "GET",
      url: "/api/admin/bot/settings",
      headers: {"x-telegram-init-data": signedInitData(ADMIN_ID, config.telegramBotToken)}
    });
    assert.equal(fetched.statusCode, 200);
    const settings = fetched.json<typeof store.settings>();
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/admin/bot/settings",
      headers: adminHeaders(config.telegramBotToken, "bot-settings-0001"),
      payload: {
        expectedVersion: settings.version,
        welcomeMessage: "欢迎，{客户名称}",
        helpMessage: settings.helpMessage,
        whyUsMessage: settings.whyUsMessage,
        stockMessage: settings.stockMessage,
        tradeRulesMessage: settings.tradeRulesMessage,
        contactMessage: settings.contactMessage,
        businessHours: "09:00-18:00",
        offlineMessage: "当前不在营业时间",
        miniAppUrl: settings.miniAppUrl,
        channelUrl: settings.channelUrl,
        groupUrl: settings.groupUrl,
        automaticReplyEnabled: false,
        menuButtons: settings.menuButtons
      }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json<{version: number}>().version, settings.version + 1);
    assert.equal(store.settings.businessHours, "09:00-18:00");
    assert.equal(store.audits.at(-1)?.action, "bot_settings_updated");
  });

  it("creates and conditionally updates keyword automatic replies", async () => {
    const config = testConfig();
    const store = new InMemorySupportStore();
    app = buildApp({config, store, logger: silentLogger});
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/bot/auto-replies",
      headers: adminHeaders(config.telegramBotToken, "auto-reply-0001"),
      payload: {enabled: true, matchType: "contains", keyword: "营业时间", responseContent: "09:00-18:00", priority: 10}
    });
    assert.equal(created.statusCode, 201);
    const rule = created.json<{id: string; version: number}>();
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/bot/auto-replies/${rule.id}`,
      headers: adminHeaders(config.telegramBotToken, "auto-reply-0002"),
      payload: {
        expectedVersion: rule.version,
        enabled: false,
        matchType: "exact",
        keyword: "营业时间",
        responseContent: "请直接咨询客服",
        priority: 20
      }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json<{enabled: boolean; version: number}>().enabled, false);
    assert.equal(store.autoReplies.length, 1);
    assert.equal(store.audits.at(-1)?.action, "auto_reply_rule_updated");
  });
});

function fetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function adminHeaders(token: string, idempotencyKey: string) {
  return {
    "x-telegram-init-data": signedInitData(ADMIN_ID, token),
    "x-idempotency-key": idempotencyKey
  };
}

function signedInitData(userId: number, token: string): string {
  const parameters = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({id: userId, first_name: "测试管理员"})
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  parameters.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return parameters.toString();
}
