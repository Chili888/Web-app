import {timingSafeEqual} from "node:crypto";
import Fastify from "fastify";
import type {FastifyInstance, FastifyRequest} from "fastify";
import type {AppConfig} from "../config.js";
import type {ChannelOperationAction, ChannelPostContent, TelegramUpdate} from "../domain.js";
import type {AppLogger} from "../logger.js";
import type {
  SaveAutoReplyRuleInput,
  SaveChannelPostInput,
  UpdateBotSettingsInput
} from "../store/store.js";
import type {SupportStore} from "../store/store.js";
import {validateTelegramInitData} from "../telegram/init-data.js";

export interface BuildAppOptions {
  config: AppConfig;
  store: SupportStore;
  logger: AppLogger;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({logger: false, bodyLimit: 1024 * 1024});
  const adminRateLimits = new Map<number, {windowStartedAt: number; count: number}>();

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = typeof origin === "string" && origin === options.config.storefrontOrigin;
    if (allowed) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Telegram-Init-Data,X-Idempotency-Key");
      reply.header("Access-Control-Max-Age", "600");
    }
    if (request.method === "OPTIONS") {
      return allowed ? reply.code(204).send() : reply.code(403).send({error: "origin_not_allowed"});
    }
  });

  app.get("/", async (_request, reply) => reply.send({
    service: "TJ Telegram Center",
    status: "running",
    health: "/health",
    storefront: "https://chili888.github.io/Web-app/"
  }));

  app.get("/health", async (_request, reply) => {
    try {
      const health = await options.store.getServiceHealth(new Date());
      const ready = health.worker === "ok";
      return reply.code(ready ? 200 : 503).send({
        status: ready ? "ok" : "degraded",
        service: "telegram-operations-api",
        database: health.database,
        worker: health.worker
      });
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        service: "telegram-operations-api",
        database: "unavailable",
        worker: "unknown"
      });
    }
  });

  app.post("/telegram/webhook", async (request, reply) => {
    const provided = request.headers["x-telegram-bot-api-secret-token"];
    if (typeof provided !== "string" || !secureEqual(provided, options.config.telegramWebhookSecret)) {
      options.logger.warn({remoteAddress: request.ip}, "Rejected Telegram webhook with invalid secret");
      return reply.code(401).send({error: "unauthorized"});
    }

    if (!isTelegramUpdate(request.body)) {
      return reply.code(400).send({error: "invalid_update"});
    }

    const inserted = await options.store.persistUpdate(request.body);
    options.logger.info({updateId: request.body.update_id, duplicate: !inserted}, "Telegram update accepted");
    return reply.code(202).send({accepted: true, duplicate: !inserted});
  });


  app.get("/api/admin/bot/settings", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    return reply.send(await options.store.getBotSettings());
  });

  app.patch("/api/admin/bot/settings", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const parsed = parseBotSettings(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const settings = await options.store.updateBotSettings(parsed.value);
    if (!settings) return reply.code(409).send({error: "version_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: "bot_settings_updated",
      entityType: "bot_settings",
      entityId: "singleton",
      afterState: {
        version: settings.version,
        automaticReplyEnabled: settings.automaticReplyEnabled,
        visibleMenuButtons: settings.menuButtons.filter((button) => button.visible).length
      }
    });
    return reply.send(settings);
  });

  app.get("/api/admin/bot/auto-replies", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    return reply.send({items: await options.store.listAutoReplyRules()});
  });

  app.post("/api/admin/bot/auto-replies", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const parsed = parseAutoReplyRule(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const rule = await options.store.createAutoReplyRule(parsed.value);
    await options.store.writeAudit({
      actorType: "support_agent", actorTelegramId: admin.id, action: "auto_reply_rule_created",
      entityType: "auto_reply_rule", entityId: rule.id, afterState: {enabled: rule.enabled, matchType: rule.matchType}
    });
    return reply.code(201).send(rule);
  });

  app.patch("/api/admin/bot/auto-replies/:id", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const id = parseUuid((request.params as {id?: unknown}).id);
    const expectedVersion = parseExpectedVersion(request.body);
    if (!id) return reply.code(400).send({error: "invalid_id"});
    if (!expectedVersion) return reply.code(400).send({error: "invalid_version"});
    const parsed = parseAutoReplyRule(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const rule = await options.store.updateAutoReplyRule(id, expectedVersion, parsed.value);
    if (!rule) return reply.code(409).send({error: "version_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent", actorTelegramId: admin.id, action: "auto_reply_rule_updated",
      entityType: "auto_reply_rule", entityId: id, afterState: {enabled: rule.enabled, matchType: rule.matchType, version: rule.version}
    });
    return reply.send(rule);
  });

  app.get("/api/admin/channel-posts", async (request, reply) => {
    const adminId = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!adminId.ok) return reply.code(adminId.status).send({error: adminId.error});
    const query = request.query as {status?: unknown; limit?: unknown};
    const status = typeof query.status === "string" && query.status ? query.status : null;
    if (status && !CHANNEL_STATUSES.has(status)) return reply.code(400).send({error: "invalid_status"});
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return reply.code(400).send({error: "invalid_limit"});
    }
    return reply.send({items: await options.store.listChannelPosts(status, limit)});
  });

  app.post("/api/admin/channel-posts", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const parsed = parseChannelPostInput(request.body, options.config, new Date());
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const post = await options.store.createChannelPost({...parsed.input, actorTelegramId: admin.id});
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: "channel_post_created",
      entityType: "channel_post",
      entityId: post.id,
      afterState: {status: post.status, version: post.version, contentType: post.contentType}
    });
    return reply.code(201).send(post);
  });

  app.patch("/api/admin/channel-posts/:id", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const id = parseUuid((request.params as {id?: unknown}).id);
    if (!id) return reply.code(400).send({error: "invalid_id"});
    const parsed = parseChannelPostInput(request.body, options.config, new Date());
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const expectedVersion = parseExpectedVersion(request.body);
    if (!expectedVersion) return reply.code(400).send({error: "invalid_version"});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const post = await options.store.updateChannelPost({
      id,
      expectedVersion,
      ...parsed.input,
      actorTelegramId: admin.id
    });
    if (!post) return reply.code(409).send({error: "version_or_status_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: "channel_post_updated",
      entityType: "channel_post",
      entityId: post.id,
      afterState: {status: post.status, version: post.version, contentType: post.contentType}
    });
    return reply.send(post);
  });

  for (const action of ["cancel", "retry"] as const) {
    app.post(`/api/admin/channel-posts/:id/${action}`, async (request, reply) => {
      const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
      if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
      const id = parseUuid((request.params as {id?: unknown}).id);
      const expectedVersion = parseExpectedVersion(request.body);
      if (!id) return reply.code(400).send({error: "invalid_id"});
      if (!expectedVersion) return reply.code(400).send({error: "invalid_version"});
      const idempotency = await claimAdminMutation(request, options.store, admin.id);
      if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
      const post = await options.store.transitionChannelPost(id, expectedVersion, action, admin.id, new Date());
      if (!post) return reply.code(409).send({error: "version_or_status_conflict"});
      await options.store.writeAudit({
        actorType: "support_agent",
        actorTelegramId: admin.id,
        action: `channel_post_${action}`,
        entityType: "channel_post",
        entityId: post.id,
        afterState: {status: post.status, version: post.version}
      });
      return reply.send(post);
    });
  }

  app.post("/api/admin/channel-posts/:id/actions", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const id = parseUuid((request.params as {id?: unknown}).id);
    if (!id) return reply.code(400).send({error: "invalid_id"});
    const parsed = parseChannelOperation(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotencyKey = request.headers["x-idempotency-key"];
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok || typeof idempotencyKey !== "string") {
      return reply.code(idempotency.ok ? 400 : idempotency.status).send({
        error: idempotency.ok ? "invalid_idempotency_key" : idempotency.error
      });
    }
    const operation = await options.store.createChannelOperation({
      channelPostId: id,
      expectedVersion: parsed.expectedVersion,
      idempotencyKey,
      action: parsed.action,
      payload: parsed.payload,
      actorTelegramId: admin.id
    });
    if (!operation) return reply.code(409).send({error: "version_status_or_operation_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: `channel_post_${parsed.action}_queued`,
      entityType: "channel_post",
      entityId: id,
      metadata: {operationId: operation.id}
    });
    return reply.code(202).send(operation);
  });

  app.get("/api/admin/group/moderation-settings", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    return reply.send(await options.store.getGroupModerationSettings());
  });

  app.get("/api/admin/group/moderation-rules", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    return reply.send({items: await options.store.listModerationRules()});
  });

  app.post("/api/admin/group/moderation-rules", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const parsed = parseModerationRule(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const rule = await options.store.createModerationRule(parsed.input);
    await options.store.writeAudit({
      actorType: "support_agent", actorTelegramId: admin.id, action: "moderation_rule_created",
      entityType: "moderation_rule", entityId: rule.id, afterState: rule
    });
    return reply.code(201).send(rule);
  });

  app.patch("/api/admin/group/moderation-rules/:id", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const id = parseUuid((request.params as {id?: unknown}).id);
    if (!id) return reply.code(400).send({error: "invalid_id"});
    const parsed = parseModerationRule(request.body);
    const expectedVersion = parseExpectedVersion(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    if (!expectedVersion) return reply.code(400).send({error: "invalid_version"});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const rule = await options.store.updateModerationRule(id, expectedVersion, parsed.input);
    if (!rule) return reply.code(409).send({error: "version_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent", actorTelegramId: admin.id, action: "moderation_rule_updated",
      entityType: "moderation_rule", entityId: id, afterState: rule
    });
    return reply.send(rule);
  });

  app.patch("/api/admin/group/moderation-settings", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const parsed = parseGroupModerationSettings(request.body);
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok) return reply.code(idempotency.status).send({error: idempotency.error});
    const settings = await options.store.updateGroupModerationSettings(parsed.settings, parsed.expectedVersion);
    if (!settings) return reply.code(409).send({error: "version_conflict"});
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: "group_moderation_settings_updated",
      entityType: "group_moderation_settings",
      entityId: "singleton",
      afterState: settings
    });
    return reply.send(settings);
  });

  app.post("/api/admin/group/members/:userId/actions", async (request, reply) => {
    const admin = await authorizeAdmin(request, options.config, options.store, adminRateLimits);
    if (!admin.ok) return reply.code(admin.status).send({error: admin.error});
    const userId = Number((request.params as {userId?: unknown}).userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) return reply.code(400).send({error: "invalid_user_id"});
    if (options.config.telegramAdminIds.has(userId)) return reply.code(403).send({error: "cannot_moderate_admin"});
    const parsed = parseGroupMemberAction(request.body, new Date());
    if ("error" in parsed) return reply.code(400).send({error: parsed.error});
    const idempotencyKey = request.headers["x-idempotency-key"];
    const idempotency = await claimAdminMutation(request, options.store, admin.id);
    if (!idempotency.ok || typeof idempotencyKey !== "string") {
      return reply.code(idempotency.ok ? 400 : idempotency.status).send({
        error: idempotency.ok ? "invalid_idempotency_key" : idempotency.error
      });
    }
    const operation = await options.store.createGroupOperation({
      idempotencyKey,
      action: parsed.action,
      telegramChatId: options.config.telegramDiscussionGroup,
      telegramUserId: userId,
      untilAt: parsed.untilAt,
      reason: parsed.reason,
      actorTelegramId: admin.id
    });
    await options.store.writeAudit({
      actorType: "support_agent",
      actorTelegramId: admin.id,
      action: `group_${parsed.action}_queued`,
      entityType: "telegram_group_member",
      entityId: String(userId),
      metadata: {operationId: operation.id, reason: parsed.reason}
    });
    return reply.code(202).send(operation);
  });

  return app;
}

const CHANNEL_STATUSES = new Set(["draft", "scheduled", "publishing", "published", "cancelled", "failed", "dead_letter"]);
const BOT_MENU_KEYS = new Set(["why_us", "stock", "trade_rules", "contact", "mini_app", "channel"]);
const AUTO_REPLY_MATCH_TYPES = new Set(["exact", "contains", "prefix", "regex"]);
const CONTENT_TYPES = new Set(["text", "photo", "video", "document", "animation", "audio", "media_group"]);
const CHANNEL_OPERATION_ACTIONS = new Set<ChannelOperationAction>(["edit_text", "edit_caption", "delete", "pin", "unpin"]);

function parseBotSettings(value: unknown): {value: UpdateBotSettingsInput} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return {error: "invalid_version"};
  const textFields = [
    ["welcomeMessage", 4096], ["helpMessage", 4096], ["whyUsMessage", 4096],
    ["stockMessage", 4096], ["tradeRulesMessage", 4096], ["contactMessage", 4096],
    ["businessHours", 1000], ["offlineMessage", 2000]
  ] as const;
  for (const [field, max] of textFields) {
    const fieldValue = body[field];
    if (typeof fieldValue !== "string" || fieldValue.length > max) return {error: `invalid_${field}`};
  }
  for (const field of ["miniAppUrl", "channelUrl", "groupUrl"] as const) {
    const fieldValue = body[field];
    if (typeof fieldValue !== "string" || !isHttpsUrl(fieldValue)) return {error: `invalid_${field}`};
  }
  if (typeof body.automaticReplyEnabled !== "boolean") return {error: "invalid_automatic_reply_enabled"};
  if (!Array.isArray(body.menuButtons) || body.menuButtons.length !== BOT_MENU_KEYS.size) return {error: "invalid_menu_buttons"};
  const seen = new Set<string>();
  const menuButtons = [] as UpdateBotSettingsInput["menuButtons"];
  for (const entry of body.menuButtons) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {error: "invalid_menu_buttons"};
    const button = entry as Record<string, unknown>;
    const key = button.key;
    const label = button.label;
    const position = Number(button.position);
    if (
      typeof key !== "string" || !BOT_MENU_KEYS.has(key) || seen.has(key)
      || typeof label !== "string" || !label.trim() || label.length > 64
      || typeof button.visible !== "boolean"
      || !Number.isSafeInteger(position) || position < 0 || position > 1000
    ) return {error: "invalid_menu_buttons"};
    seen.add(key);
    menuButtons.push({
      key: key as UpdateBotSettingsInput["menuButtons"][number]["key"],
      label: label.trim(),
      visible: button.visible,
      position
    });
  }
  return {
    value: {
      expectedVersion,
      welcomeMessage: (body.welcomeMessage as string).trim(),
      helpMessage: (body.helpMessage as string).trim(),
      whyUsMessage: (body.whyUsMessage as string).trim(),
      stockMessage: (body.stockMessage as string).trim(),
      tradeRulesMessage: (body.tradeRulesMessage as string).trim(),
      contactMessage: (body.contactMessage as string).trim(),
      businessHours: (body.businessHours as string).trim(),
      offlineMessage: (body.offlineMessage as string).trim(),
      miniAppUrl: (body.miniAppUrl as string).trim(),
      channelUrl: (body.channelUrl as string).trim(),
      groupUrl: (body.groupUrl as string).trim(),
      automaticReplyEnabled: body.automaticReplyEnabled,
      menuButtons
    }
  };
}

function parseAutoReplyRule(value: unknown): {value: SaveAutoReplyRuleInput} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const priority = Number(body.priority);
  if (typeof body.enabled !== "boolean") return {error: "invalid_enabled"};
  if (typeof body.matchType !== "string" || !AUTO_REPLY_MATCH_TYPES.has(body.matchType)) return {error: "invalid_match_type"};
  if (typeof body.keyword !== "string" || !body.keyword.trim() || body.keyword.length > 200) return {error: "invalid_keyword"};
  if (typeof body.responseContent !== "string" || !body.responseContent.trim() || body.responseContent.length > 4096) {
    return {error: "invalid_response_content"};
  }
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 10_000) return {error: "invalid_priority"};
  if (body.matchType === "regex") {
    try {
      new RegExp(body.keyword, "iu");
    } catch {
      return {error: "invalid_regex"};
    }
  }
  return {
    value: {
      enabled: body.enabled,
      matchType: body.matchType as SaveAutoReplyRuleInput["matchType"],
      keyword: body.keyword.trim(),
      responseContent: body.responseContent.trim(),
      priority
    }
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function authorizeAdmin(
  request: FastifyRequest,
  config: AppConfig,
  store: SupportStore,
  limits: Map<number, {windowStartedAt: number; count: number}>
): Promise<{ok: true; id: number} | {ok: false; error: string; status: 401 | 403 | 429}> {
  const initData = request.headers["x-telegram-init-data"];
  let userId: number;
  if (typeof initData === "string") {
    try {
      userId = validateTelegramInitData(initData, config.telegramBotToken, {
        maxAgeSeconds: config.telegramInitDataMaxAgeSeconds
      }).user.id;
    } catch {
      return {ok: false, error: "invalid_admin_auth", status: 401};
    }
    if (!config.telegramAdminIds.has(userId)) return {ok: false, error: "forbidden", status: 403};
  } else {
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!token || token.length > 4096 || !config.supabaseUrl || !config.supabaseAnonKey) {
      return {ok: false, error: "missing_admin_auth", status: 401};
    }
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        headers: {authorization: `Bearer ${token}`, apikey: config.supabaseAnonKey},
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return {ok: false, error: "invalid_admin_auth", status: 401};
      const profile = await response.json() as {id?: unknown};
      const authUserId = parseUuid(profile.id);
      if (!authUserId) return {ok: false, error: "invalid_admin_auth", status: 401};
      if (!await store.isAdminProfile(authUserId)) return {ok: false, error: "forbidden", status: 403};
    } catch {
      return {ok: false, error: "admin_auth_unavailable", status: 401};
    }
    const primaryAdminId = config.telegramAdminIds.values().next().value;
    if (primaryAdminId === undefined) return {ok: false, error: "forbidden", status: 403};
    userId = primaryAdminId;
  }
  const now = Date.now();
  const current = limits.get(userId);
  const window = !current || now - current.windowStartedAt >= 60_000
    ? {windowStartedAt: now, count: 1}
    : {windowStartedAt: current.windowStartedAt, count: current.count + 1};
  limits.set(userId, window);
  if (window.count > 120) return {ok: false, error: "rate_limited", status: 429};
  return {ok: true, id: userId};
}

async function claimAdminMutation(
  request: FastifyRequest,
  store: SupportStore,
  adminId: number
): Promise<{ok: true} | {ok: false; error: string; status: 400 | 409}> {
  const key = request.headers["x-idempotency-key"];
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return {ok: false, error: "invalid_idempotency_key", status: 400};
  }
  const claimed = await store.claimAdminApiRequest(key, adminId, request.method, request.url.split("?", 1)[0] ?? request.url);
  return claimed ? {ok: true} : {ok: false, error: "duplicate_request", status: 409};
}

function parseChannelPostInput(
  value: unknown,
  config: AppConfig,
  now: Date
): {input: Omit<SaveChannelPostInput, "actorTelegramId">} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  if (!CONTENT_TYPES.has(contentType)) return {error: "invalid_content_type"};
  const content = parseChannelContent(contentType, body.content);
  if ("error" in content) return content;
  const parseMode = body.parseMode === null || body.parseMode === undefined
    ? null
    : body.parseMode;
  if (parseMode !== null && parseMode !== "HTML" && parseMode !== "MarkdownV2") {
    return {error: "invalid_parse_mode"};
  }
  let scheduledAt: Date | null = null;
  if (body.publishNow === true) scheduledAt = now;
  else if (body.scheduledAt !== null && body.scheduledAt !== undefined) {
    if (typeof body.scheduledAt !== "string") return {error: "invalid_scheduled_at"};
    scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return {error: "invalid_scheduled_at"};
  }
  const timezone = typeof body.timezone === "string" && body.timezone.trim()
    ? body.timezone.trim()
    : config.appTimezone;
  try {
    new Intl.DateTimeFormat("zh-CN", {timeZone: timezone}).format();
  } catch {
    return {error: "invalid_timezone"};
  }
  return {input: {contentType, content: content.value, parseMode, scheduledAt, timezone}};
}

function parseChannelOperation(value: unknown): {
  action: ChannelOperationAction;
  expectedVersion: number;
  payload: {text?: string; caption?: string; parseMode?: "HTML" | "MarkdownV2" | null};
} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string" || !CHANNEL_OPERATION_ACTIONS.has(body.action as ChannelOperationAction)) {
    return {error: "invalid_action"};
  }
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return {error: "invalid_version"};
  const action = body.action as ChannelOperationAction;
  const parseMode = body.parseMode === undefined || body.parseMode === null ? null : body.parseMode;
  if (parseMode !== null && parseMode !== "HTML" && parseMode !== "MarkdownV2") {
    return {error: "invalid_parse_mode"};
  }
  if (action === "edit_text") {
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 4096) return {error: "invalid_text"};
    return {action, expectedVersion, payload: {text: body.text.trim(), parseMode}};
  }
  if (action === "edit_caption") {
    if (typeof body.caption !== "string" || body.caption.length > 1024) return {error: "invalid_caption"};
    return {action, expectedVersion, payload: {caption: body.caption, parseMode}};
  }
  return {action, expectedVersion, payload: {}};
}

function parseGroupModerationSettings(value: unknown): {
  expectedVersion: number;
  settings: Awaited<ReturnType<SupportStore["getGroupModerationSettings"]>>;
} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const expectedVersion = Number(body.expectedVersion);
  const violationWindowSeconds = Number(body.violationWindowSeconds);
  const muteAfterViolations = Number(body.muteAfterViolations);
  const banAfterViolations = Number(body.banAfterViolations);
  const muteDurationSeconds = Number(body.muteDurationSeconds);
  const warningMessage = body.warningMessage;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return {error: "invalid_version"};
  if (!Number.isSafeInteger(violationWindowSeconds) || violationWindowSeconds < 60 || violationWindowSeconds > 2_592_000) {
    return {error: "invalid_violation_window"};
  }
  if (
    !Number.isSafeInteger(muteAfterViolations) || muteAfterViolations < 1
    || !Number.isSafeInteger(banAfterViolations) || banAfterViolations < muteAfterViolations
  ) return {error: "invalid_escalation_thresholds"};
  if (!Number.isSafeInteger(muteDurationSeconds) || muteDurationSeconds < 30 || muteDurationSeconds > 2_592_000) {
    return {error: "invalid_mute_duration"};
  }
  if (typeof warningMessage !== "string" || warningMessage.length > 500) return {error: "invalid_warning_message"};
  return {
    expectedVersion,
    settings: {
      version: expectedVersion,
      enabled: body.enabled === true,
      violationWindowSeconds,
      muteAfterViolations,
      banAfterViolations,
      muteDurationSeconds,
      warningMessage: warningMessage.trim()
    }
  };
}

function parseGroupMemberAction(value: unknown, now: Date): {
  action: "mute" | "unmute" | "ban" | "unban" | "kick";
  untilAt: Date | null;
  reason: string;
} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const action = body.action;
  if (action !== "mute" && action !== "unmute" && action !== "ban" && action !== "unban" && action !== "kick") {
    return {error: "invalid_action"};
  }
  const reason = body.reason === undefined ? "" : body.reason;
  if (typeof reason !== "string" || reason.length > 300) return {error: "invalid_reason"};
  let untilAt: Date | null = null;
  if (action === "mute") {
    const durationSeconds = Number(body.durationSeconds);
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 2_592_000) {
      return {error: "invalid_duration"};
    }
    untilAt = new Date(now.getTime() + durationSeconds * 1000);
  }
  return {action, untilAt, reason: reason.trim()};
}

function parseModerationRule(value: unknown): {
  input: Parameters<SupportStore["createModerationRule"]>[0];
} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_body"};
  const body = value as Record<string, unknown>;
  const mode = body.mode;
  const ruleType = body.ruleType;
  if (mode !== "log" && mode !== "delete" && mode !== "mute" && mode !== "ban") return {error: "invalid_mode"};
  if (ruleType !== "keyword" && ruleType !== "link") return {error: "invalid_rule_type"};
  const pattern = ruleType === "keyword" ? body.pattern : null;
  if (ruleType === "keyword" && (typeof pattern !== "string" || !pattern.trim() || pattern.length > 200)) {
    return {error: "invalid_pattern"};
  }
  const priority = body.priority === undefined ? 100 : Number(body.priority);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 10000) return {error: "invalid_priority"};
  const duration = body.actionDurationSeconds === undefined || body.actionDurationSeconds === null
    ? null
    : Number(body.actionDurationSeconds);
  if (duration !== null && (!Number.isSafeInteger(duration) || duration < 30 || duration > 2_592_000)) {
    return {error: "invalid_action_duration"};
  }
  return {input: {
    enabled: body.enabled !== false,
    mode,
    ruleType,
    pattern: typeof pattern === "string" ? pattern.trim() : null,
    actionDurationSeconds: duration,
    priority
  }};
}

function parseChannelContent(
  contentType: string,
  value: unknown
): {value: ChannelPostContent} | {error: string} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {error: "invalid_content"};
  const content = value as Record<string, unknown>;
  if (contentType === "text") {
    if (typeof content.text !== "string" || !content.text.trim() || content.text.length > 4096) {
      return {error: "invalid_text"};
    }
  }
  const media = content.media;
  if (contentType !== "text") {
    if (!Array.isArray(media)) return {error: "invalid_media"};
    const expectedCount = contentType === "media_group" ? media.length >= 2 && media.length <= 10 : media.length === 1;
    if (!expectedCount) return {error: "invalid_media_count"};
    for (const item of media) {
      if (!item || typeof item !== "object") return {error: "invalid_media"};
      const candidate = item as Record<string, unknown>;
      if (!CONTENT_TYPES.has(String(candidate.type)) || candidate.type === "text" || candidate.type === "media_group") {
        return {error: "invalid_media_type"};
      }
      if (contentType !== "media_group" && candidate.type !== contentType) return {error: "invalid_media_type"};
      if (typeof candidate.media !== "string" || !candidate.media.trim() || candidate.media.length > 2048) {
        return {error: "invalid_media"};
      }
      if (candidate.caption !== undefined && (typeof candidate.caption !== "string" || candidate.caption.length > 1024)) {
        return {error: "invalid_caption"};
      }
    }
  }
  if (content.buttons !== undefined && !validButtons(content.buttons)) return {error: "invalid_buttons"};
  return {value: structuredClone(value)};
}

function validButtons(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 8) return false;
  return value.every((row) => Array.isArray(row) && row.length >= 1 && row.length <= 8 && row.every((button) => {
    if (!button || typeof button !== "object") return false;
    const item = button as Record<string, unknown>;
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 64) return false;
    const target = typeof item.url === "string"
      ? item.url
      : typeof (item.web_app as {url?: unknown} | undefined)?.url === "string"
        ? (item.web_app as {url: string}).url
        : "";
    try {
      const url = new URL(target);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }));
}

function parseExpectedVersion(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const version = Number((value as {expectedVersion?: unknown}).expectedVersion);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function parseUuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (!value || typeof value !== "object") return false;
  const updateId = (value as {update_id?: unknown}).update_id;
  return typeof updateId === "number" && Number.isSafeInteger(updateId) && updateId >= 0;
}
