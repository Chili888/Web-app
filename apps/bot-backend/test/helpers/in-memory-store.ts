import {randomUUID} from "node:crypto";
import type {
  AdminMessageRouteRecord,
  AutoReplyRuleDetails,
  AutoReplyRuleRecord,
  BotSettingsRecord,
  ChannelOperationRecord,
  ChannelPostDetails,
  ChannelPostRecord,
  JoinVerificationRecord,
  GroupModerationSettings,
  GroupOperationRecord,
  ModerationRuleRecord,
  ModerationRuleDetails,
  OutboxLease,
  OutboxRecord,
  StoredUpdate,
  TelegramCustomerRecord,
  TelegramUpdate
} from "../../src/domain.js";
import type {
  AcquireOutboxInput,
  AuditInput,
  CreateAdminRouteInput,
  CreateChannelOperationInput,
  CreateGroupOperationInput,
  CreateJoinVerificationInput,
  RecordAdminReplyInput,
  RecordCustomerMessageInput,
  RecordModerationActionInput,
  SaveChannelPostInput,
  SaveAutoReplyRuleInput,
  SaveModerationRuleInput,
  SupportStore,
  UpdateBotSettingsInput,
  UpdateChannelPostInput
} from "../../src/store/store.js";

type MutableUpdate = StoredUpdate;

export class InMemorySupportStore implements SupportStore {
  readonly updates = new Map<number, MutableUpdate>();
  readonly customers = new Map<number, TelegramCustomerRecord>();
  readonly messages: Array<RecordCustomerMessageInput | RecordAdminReplyInput> = [];
  readonly routes: AdminMessageRouteRecord[] = [];
  readonly audits: AuditInput[] = [];
  readonly outbox = new Map<string, OutboxRecord>();
  readonly joins: JoinVerificationRecord[] = [];
  readonly autoReplies: AutoReplyRuleRecord[] = [];
  readonly mediaSummaries = new Map<string, Date | null>();
  readonly whitelistedUsers = new Set<string>();
  readonly channelPosts: MutableChannelPost[] = [];
  readonly channelOperations: Array<ChannelOperationRecord & {status: "pending" | "processing" | "completed" | "failed" | "dead_letter"; nextAttemptAt: Date}> = [];
  readonly groupOperations: Array<GroupOperationRecord & {status: "pending" | "processing" | "completed" | "failed" | "dead_letter"; nextAttemptAt: Date}> = [];
  readonly adminApiRequests = new Set<string>();
  readonly moderationRules: ModerationRuleRecord[] = [];
  readonly moderationActions: RecordModerationActionInput[] = [];
  readonly adminProfileIds = new Set<string>();
  settings: BotSettingsRecord = {
    version: 1,
    welcomeMessage: [
      "⚡ 欢迎，{客户名称}！",
      "",
      "👑【天津品质天花板】",
      "",
      "📍 本地真实卖家｜长期供货｜极速配送",
      "",
      "主营靠谱和长期供货，只做品质，只出精品。",
      "",
      "👇 请通过下方菜单了解我们："
    ].join("\n"),
    helpMessage: "请直接发送您的问题",
    whyUsMessage: "为什么选择我们",
    stockMessage: "现货咨询说明",
    tradeRulesMessage: "交易必看说明",
    contactMessage: "请直接把您的需求、数量、大概位置或疑问顾虑发在下面，我们会尽快回复您：",
    businessHours: "",
    offlineMessage: "",
    miniAppUrl: "https://example.test/app",
    channelUrl: "https://t.me/TJ_NO1_ice",
    groupUrl: "https://t.me/TJ_ice_Group",
    automaticReplyEnabled: true,
    joinVerifyEnabled: true,
    joinVerifyPrompt: "请先关注主频道，然后点击验证按钮。",
    joinVerifyTimeoutSeconds: 600,
    joinVerifyTimeoutAction: "kick",
    joinVerifyWelcomeMessage: "验证成功，欢迎加入！",
    menuButtons: [
      {key: "why_us", label: "💎 为什么选择我们？", visible: true, position: 10},
      {key: "stock", label: "📋 现货咨询", visible: true, position: 20},
      {key: "trade_rules", label: "🤝 交易必看", visible: true, position: 30},
      {key: "contact", label: "🙋 联系客服", visible: true, position: 40},
      {key: "mini_app", label: "🛍 进入商城", visible: true, position: 50},
      {key: "channel", label: "📢 关注频道", visible: true, position: 60}
    ]
  };
  moderationSettings: GroupModerationSettings = {
    version: 1,
    enabled: true,
    violationWindowSeconds: 86400,
    muteAfterViolations: 2,
    banAfterViolations: 4,
    muteDurationSeconds: 900,
    warningMessage: "请遵守群规，继续违规将被禁言或封禁。"
  };

  async persistUpdate(update: TelegramUpdate): Promise<boolean> {
    if (this.updates.has(update.update_id)) return false;
    this.updates.set(update.update_id, {
      updateId: update.update_id,
      payload: structuredClone(update),
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(0)
    });
    return true;
  }

  async claimNextUpdate(_workerId: string, now: Date): Promise<StoredUpdate | null> {
    const update = [...this.updates.values()].find((item) =>
      (item.status === "pending" || item.status === "retry") && item.nextAttemptAt <= now
    );
    if (!update) return null;
    update.status = "processing";
    update.attempts += 1;
    return structuredClone(update);
  }

  async completeUpdate(updateId: number, status: "completed" | "ignored"): Promise<void> {
    this.requireUpdate(updateId).status = status;
  }

  async retryUpdate(updateId: number, _error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    const update = this.requireUpdate(updateId);
    update.status = deadLetter ? "dead_letter" : "retry";
    update.nextAttemptAt = nextAttemptAt;
  }

  async recordCustomerMessage(input: RecordCustomerMessageInput) {
    let customer = this.customers.get(input.user.id);
    if (!customer) {
      customer = {
        id: randomUUID(),
        telegramUserId: input.user.id,
        telegramChatId: input.chatId,
        username: input.user.username ?? null,
        firstName: input.user.first_name,
        lastName: input.user.last_name ?? "",
        languageCode: input.user.language_code ?? null,
        isBlocked: false
      };
      this.customers.set(input.user.id, customer);
    }
    const inserted = !this.messages.some((message) => "updateId" in message && message.updateId === input.updateId);
    if (inserted) this.messages.push(structuredClone(input));
    const summaryKey = `${customer.id}:${input.mediaGroupId ?? input.updateId}`;
    if (!this.mediaSummaries.has(summaryKey)) this.mediaSummaries.set(summaryKey, input.mediaGroupId ? null : input.receivedAt);
    const shouldSendSummary = input.mediaGroupId ? this.mediaSummaries.get(summaryKey) === null : true;
    return {customer: structuredClone(customer), inserted, shouldSendSummary};
  }

  async markMediaGroupSummarySent(customerId: string, mediaGroupId: string, sentAt: Date): Promise<void> {
    this.mediaSummaries.set(`${customerId}:${mediaGroupId}`, sentAt);
  }

  async recordAdminReply(input: RecordAdminReplyInput): Promise<boolean> {
    const inserted = !this.messages.some((message) => "updateId" in message && message.updateId === input.updateId);
    if (inserted) this.messages.push(structuredClone(input));
    return inserted;
  }

  async createAdminRoute(input: CreateAdminRouteInput): Promise<void> {
    if (this.routes.some((route) => route.adminChatId === input.adminChatId && route.adminMessageId === input.adminMessageId)) return;
    this.routes.push({id: randomUUID(), ...structuredClone(input)});
  }

  async findAdminRoute(adminTelegramId: number, adminChatId: number, adminMessageId: number) {
    return this.routes.find((route) =>
      route.adminTelegramId === adminTelegramId
      && route.adminChatId === adminChatId
      && route.adminMessageId === adminMessageId
    ) ?? null;
  }

  async markCustomerBlocked(customerId: string, blocked: boolean): Promise<void> {
    const customer = [...this.customers.values()].find((item) => item.id === customerId);
    if (customer) customer.isBlocked = blocked;
  }

  async getBotSettings(): Promise<BotSettingsRecord> {
    return structuredClone(this.settings);
  }

  async updateBotSettings(input: UpdateBotSettingsInput): Promise<BotSettingsRecord | null> {
    if (input.expectedVersion !== this.settings.version) return null;
    const {expectedVersion: _expectedVersion, ...settings} = input;
    void _expectedVersion;
    this.settings = {
      ...this.settings,
      ...structuredClone(settings),
      version: this.settings.version + 1
    };
    return structuredClone(this.settings);
  }

  async isUserWhitelisted(chatId: number, userId: number): Promise<boolean> {
    return this.whitelistedUsers.has(`${chatId}:${userId}`) || this.whitelistedUsers.has(`*:${userId}`);
  }

  async findAutoReplies(text: string): Promise<AutoReplyRuleRecord[]> {
    const normalized = text.toLowerCase();
    return this.autoReplies.filter((rule) => normalized.includes(rule.keyword.toLowerCase()));
  }

  async listAutoReplyRules(): Promise<AutoReplyRuleDetails[]> {
    return this.autoReplies.map((rule, index) => ({
      ...structuredClone(rule),
      enabled: (rule as Partial<AutoReplyRuleDetails>).enabled ?? true,
      version: (rule as Partial<AutoReplyRuleDetails>).version ?? 1,
      priority: rule.priority ?? index + 100
    }));
  }

  async createAutoReplyRule(input: SaveAutoReplyRuleInput): Promise<AutoReplyRuleDetails> {
    const rule: AutoReplyRuleDetails = {
      id: randomUUID(),
      ...structuredClone(input),
      responseType: "text",
      version: 1
    };
    this.autoReplies.push(rule);
    return structuredClone(rule);
  }

  async updateAutoReplyRule(
    id: string,
    expectedVersion: number,
    input: SaveAutoReplyRuleInput
  ): Promise<AutoReplyRuleDetails | null> {
    const index = this.autoReplies.findIndex((rule) => rule.id === id);
    const current = (await this.listAutoReplyRules()).find((rule) => rule.id === id);
    if (index < 0 || !current || current.version !== expectedVersion) return null;
    const updated: AutoReplyRuleDetails = {id, ...structuredClone(input), responseType: "text", version: expectedVersion + 1};
    this.autoReplies[index] = updated;
    return structuredClone(updated);
  }

  async getSupportStats() {
    return {
      customers: this.customers.size,
      messagesToday: this.messages.length,
      pendingUpdates: [...this.updates.values()].filter((item) => ["pending", "retry", "processing"].includes(item.status)).length,
      deadLetters: [...this.updates.values()].filter((item) => item.status === "dead_letter").length
        + [...this.outbox.values()].filter((item) => item.status === "dead_letter").length
    };
  }

  async isAdminProfile(userId: string): Promise<boolean> {
    return this.adminProfileIds.has(userId);
  }

  async createJoinVerification(input: CreateJoinVerificationInput) {
    const existing = this.joins.find((item) =>
      item.telegramChatId === input.telegramChatId
      && item.telegramUserId === input.telegramUserId
      && item.status === "pending"
    );
    if (existing) return {record: structuredClone(existing), created: false};
    const record: JoinVerificationRecord = {
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      joinedAt: input.joinedAt,
      status: "pending",
      verificationMessageId: null,
      expiresAt: input.expiresAt,
      attempts: 0,
      timeoutAction: input.timeoutAction
    };
    this.joins.push(record);
    return {record: structuredClone(record), created: true};
  }

  async setJoinVerificationMessage(id: string, messageId: number): Promise<void> {
    const record = this.requireJoin(id);
    record.verificationMessageId ??= messageId;
  }

  async getPendingJoinVerification(chatId: number, userId: number) {
    return this.joins.find((item) => item.telegramChatId === chatId && item.telegramUserId === userId && item.status === "pending") ?? null;
  }

  async recordJoinCheck(id: string): Promise<void> {
    this.requireJoin(id).attempts += 1;
  }

  async completeJoinVerification(id: string, status: JoinVerificationRecord["status"]): Promise<boolean> {
    const record = this.requireJoin(id);
    if (record.status !== "pending") return false;
    record.status = status;
    return true;
  }

  async claimExpiredJoinVerification(_workerId: string, now: Date) {
    return this.joins.find((item) => item.status === "pending" && item.expiresAt <= now) ?? null;
  }

  async claimDueChannelPost(_workerId: string, now: Date) {
    const post = this.channelPosts.find((item) =>
      (item.status === "scheduled" || item.status === "failed")
      && item.scheduledAt !== null
      && item.scheduledAt <= now
      && item.attempts < item.maxAttempts
    );
    if (!post) return null;
    post.status = "publishing";
    post.attempts += 1;
    return structuredClone(post);
  }

  async completeChannelPost(id: string, channelMessageIds: number[]): Promise<boolean> {
    const post = this.channelPosts.find((item) => item.id === id);
    if (!post || post.status !== "publishing") return false;
    Object.assign(post, {status: "published", channelMessageId: channelMessageIds[0] ?? null, channelMessageIds});
    return true;
  }

  async retryChannelPost(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    const post = this.channelPosts.find((item) => item.id === id);
    if (!post) return;
    post.status = deadLetter ? "dead_letter" : "failed";
    post.scheduledAt = nextAttemptAt;
    post.lastError = error;
  }

  async createChannelPost(input: SaveChannelPostInput): Promise<ChannelPostDetails> {
    const now = new Date();
    const post: ChannelPostDetails = {
      id: randomUUID(),
      status: input.scheduledAt ? "scheduled" : "draft",
      contentType: input.contentType,
      content: structuredClone(input.content),
      parseMode: input.parseMode,
      scheduledAt: input.scheduledAt,
      attempts: 0,
      maxAttempts: 8,
      channelMessageId: null,
      channelMessageIds: [],
      lastError: null,
      isPinned: false,
      deletedAt: null,
      version: 1,
      createdByTelegramId: input.actorTelegramId,
      createdAt: now,
      updatedAt: now
    };
    this.channelPosts.push(post);
    return structuredClone(post);
  }

  async updateChannelPost(input: UpdateChannelPostInput): Promise<ChannelPostDetails | null> {
    const post = this.channelPosts.find((item) => item.id === input.id);
    if (!post || (post.version ?? 1) !== input.expectedVersion || !["draft", "scheduled", "failed"].includes(post.status)) return null;
    Object.assign(post, {
      status: input.scheduledAt ? "scheduled" : "draft",
      contentType: input.contentType,
      content: structuredClone(input.content),
      parseMode: input.parseMode,
      scheduledAt: input.scheduledAt,
      attempts: 0,
      lastError: null,
      version: (post.version ?? 1) + 1,
      updatedAt: new Date()
    });
    return asChannelDetails(post);
  }

  async transitionChannelPost(
    id: string,
    expectedVersion: number,
    action: "cancel" | "retry",
    _actorTelegramId: number,
    now: Date
  ): Promise<ChannelPostDetails | null> {
    const post = this.channelPosts.find((item) => item.id === id);
    const allowed = action === "cancel" ? ["draft", "scheduled", "failed"] : ["failed", "dead_letter"];
    if (!post || (post.version ?? 1) !== expectedVersion || !allowed.includes(post.status)) return null;
    post.status = action === "cancel" ? "cancelled" : "scheduled";
    if (action === "retry") {
      post.scheduledAt = now;
      post.attempts = 0;
      post.lastError = null;
    }
    post.version = (post.version ?? 1) + 1;
    post.updatedAt = now;
    return asChannelDetails(post);
  }

  async listChannelPosts(status: string | null, limit: number): Promise<ChannelPostDetails[]> {
    return this.channelPosts
      .filter((post) => !status || post.status === status)
      .slice(0, limit)
      .map(asChannelDetails);
  }

  async createChannelOperation(input: CreateChannelOperationInput): Promise<ChannelOperationRecord | null> {
    const post = this.channelPosts.find((item) => item.id === input.channelPostId);
    const active = this.channelOperations.some((item) =>
      item.channelPostId === input.channelPostId && ["pending", "processing", "failed"].includes(item.status)
    );
    if (
      !post || post.status !== "published" || !post.channelMessageIds?.length || post.deletedAt
      || (post.version ?? 1) !== input.expectedVersion || active
      || (input.action === "edit_text" && post.contentType !== "text")
      || (input.action === "edit_caption" && post.contentType === "text")
    ) return null;
    post.version = (post.version ?? 1) + 1;
    const operation = {
      id: randomUUID(),
      channelPostId: post.id,
      action: input.action,
      payload: structuredClone(input.payload),
      channelMessageIds: [...post.channelMessageIds],
      attempts: 0,
      maxAttempts: 8,
      status: "pending" as const,
      nextAttemptAt: new Date(0)
    };
    this.channelOperations.push(operation);
    return structuredClone(operation);
  }

  async claimDueChannelOperation(_workerId: string, now: Date): Promise<ChannelOperationRecord | null> {
    const operation = this.channelOperations.find((item) =>
      (item.status === "pending" || item.status === "failed")
      && item.nextAttemptAt <= now && item.attempts < item.maxAttempts
    );
    if (!operation) return null;
    operation.status = "processing";
    operation.attempts += 1;
    return structuredClone(operation);
  }

  async completeChannelOperation(operation: ChannelOperationRecord, completedAt: Date): Promise<void> {
    const stored = this.channelOperations.find((item) => item.id === operation.id);
    const post = this.channelPosts.find((item) => item.id === operation.channelPostId);
    if (!stored || stored.status !== "processing" || !post) throw new Error("Channel operation is not processing");
    stored.status = "completed";
    if (operation.action === "edit_text" && operation.payload.text !== undefined) {
      post.content.text = operation.payload.text;
    }
    if (operation.action === "edit_caption" && operation.payload.caption !== undefined && post.content.media?.[0]) {
      post.content.media[0].caption = operation.payload.caption;
    }
    if (operation.action === "edit_text" || operation.action === "edit_caption") {
      post.parseMode = operation.payload.parseMode ?? null;
    }
    if (operation.action === "pin") post.isPinned = true;
    if (operation.action === "unpin") post.isPinned = false;
    if (operation.action === "delete") post.deletedAt = completedAt;
  }

  async retryChannelOperation(id: string, _error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    const operation = this.channelOperations.find((item) => item.id === id);
    if (!operation) return;
    operation.status = deadLetter ? "dead_letter" : "failed";
    operation.nextAttemptAt = nextAttemptAt;
  }

  async claimAdminApiRequest(idempotencyKey: string): Promise<boolean> {
    if (this.adminApiRequests.has(idempotencyKey)) return false;
    this.adminApiRequests.add(idempotencyKey);
    return true;
  }

  async getModerationRules(): Promise<ModerationRuleRecord[]> {
    return structuredClone(this.moderationRules);
  }

  async listModerationRules(): Promise<ModerationRuleDetails[]> {
    return this.moderationRules.map((rule, index) => ({
      ...structuredClone(rule),
      enabled: (rule as Partial<ModerationRuleDetails>).enabled ?? true,
      priority: (rule as Partial<ModerationRuleDetails>).priority ?? index + 100,
      version: (rule as Partial<ModerationRuleDetails>).version ?? 1
    }));
  }

  async createModerationRule(input: SaveModerationRuleInput): Promise<ModerationRuleDetails> {
    const rule: ModerationRuleDetails = {id: randomUUID(), ...structuredClone(input), version: 1};
    this.moderationRules.push(rule);
    return structuredClone(rule);
  }

  async updateModerationRule(
    id: string,
    expectedVersion: number,
    input: SaveModerationRuleInput
  ): Promise<ModerationRuleDetails | null> {
    const index = this.moderationRules.findIndex((rule) => rule.id === id);
    if (index < 0) return null;
    const current = (await this.listModerationRules()).find((rule) => rule.id === id);
    if (!current || current.version !== expectedVersion) return null;
    const updated: ModerationRuleDetails = {id, ...structuredClone(input), version: expectedVersion + 1};
    this.moderationRules[index] = updated;
    return structuredClone(updated);
  }

  async getGroupModerationSettings(): Promise<GroupModerationSettings> {
    return structuredClone(this.moderationSettings);
  }

  async updateGroupModerationSettings(settings: GroupModerationSettings, expectedVersion: number): Promise<GroupModerationSettings | null> {
    if (this.moderationSettings.version !== expectedVersion) return null;
    this.moderationSettings = {...structuredClone(settings), version: expectedVersion + 1};
    return structuredClone(this.moderationSettings);
  }

  async countRecentModerationViolations(chatId: number, userId: number, since: Date): Promise<number> {
    return this.moderationActions.filter((item) =>
      item.chatId === chatId && item.userId === userId && (item.mutedUntil?.getTime() ?? Number.POSITIVE_INFINITY) >= since.getTime()
    ).length;
  }

  async recordModerationAction(input: RecordModerationActionInput): Promise<boolean> {
    const exists = this.moderationActions.some((item) =>
      item.chatId === input.chatId
      && item.messageId === input.messageId
      && item.ruleId === input.ruleId
      && item.action === input.action
    );
    if (!exists) this.moderationActions.push(structuredClone(input));
    return !exists;
  }

  async createGroupOperation(input: CreateGroupOperationInput): Promise<GroupOperationRecord> {
    const operation = {
      id: randomUUID(),
      action: input.action,
      telegramChatId: input.telegramChatId,
      telegramUserId: input.telegramUserId,
      untilAt: input.untilAt,
      reason: input.reason,
      attempts: 0,
      maxAttempts: 8,
      status: "pending" as const,
      nextAttemptAt: new Date(0)
    };
    this.groupOperations.push(operation);
    return structuredClone(operation);
  }

  async claimDueGroupOperation(_workerId: string, now: Date): Promise<GroupOperationRecord | null> {
    const operation = this.groupOperations.find((item) =>
      (item.status === "pending" || item.status === "failed")
      && item.nextAttemptAt <= now && item.attempts < item.maxAttempts
    );
    if (!operation) return null;
    operation.status = "processing";
    operation.attempts += 1;
    return structuredClone(operation);
  }

  async completeGroupOperation(id: string): Promise<void> {
    const operation = this.groupOperations.find((item) => item.id === id);
    if (operation) operation.status = "completed";
  }

  async retryGroupOperation(id: string, _error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    const operation = this.groupOperations.find((item) => item.id === id);
    if (!operation) return;
    operation.status = deadLetter ? "dead_letter" : "failed";
    operation.nextAttemptAt = nextAttemptAt;
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(structuredClone(input));
  }

  async heartbeat(): Promise<void> {}

  async getServiceHealth() {
    return {database: "ok" as const, worker: "ok" as const, workerLastSeenAt: new Date()};
  }

  async acquireOutbox(input: AcquireOutboxInput): Promise<OutboxLease> {
    let record = this.outbox.get(input.idempotencyKey);
    if (!record) {
      record = {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        status: "pending",
        attempts: 0,
        maxAttempts: input.maxAttempts,
        nextAttemptAt: new Date(0),
        response: null
      };
      this.outbox.set(input.idempotencyKey, record);
    }
    if (record.status === "sent" || record.status === "dead_letter") return {record: structuredClone(record), execute: false};
    if (record.attempts >= record.maxAttempts) {
      record.status = "dead_letter";
      return {record: structuredClone(record), execute: false};
    }
    if (record.nextAttemptAt > input.now || record.status === "processing") return {record: structuredClone(record), execute: false};
    record.status = "processing";
    record.attempts += 1;
    return {record: structuredClone(record), execute: true};
  }

  async markOutboxSent(id: string, response: unknown): Promise<void> {
    const record = this.findOutboxById(id);
    record.status = "sent";
    record.response = structuredClone(response);
  }

  async markOutboxRetry(id: string, _error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    const record = this.findOutboxById(id);
    record.status = deadLetter ? "dead_letter" : "retry";
    record.nextAttemptAt = nextAttemptAt;
  }

  async close(): Promise<void> {}

  private requireUpdate(updateId: number): MutableUpdate {
    const update = this.updates.get(updateId);
    if (!update) throw new Error(`Update ${updateId} not found`);
    return update;
  }

  private requireJoin(id: string): JoinVerificationRecord {
    const record = this.joins.find((item) => item.id === id);
    if (!record) throw new Error(`Join verification ${id} not found`);
    return record;
  }

  private findOutboxById(id: string): OutboxRecord {
    const record = [...this.outbox.values()].find((item) => item.id === id);
    if (!record) throw new Error(`Outbox ${id} not found`);
    return record;
  }
}

type MutableChannelPost = ChannelPostRecord & Partial<Pick<
  ChannelPostDetails,
  "channelMessageId" | "channelMessageIds" | "lastError" | "isPinned" | "deletedAt" | "version" | "createdByTelegramId" | "createdAt" | "updatedAt"
>>;

function asChannelDetails(post: MutableChannelPost): ChannelPostDetails {
  const now = new Date();
  return structuredClone({
    ...post,
    channelMessageId: post.channelMessageId ?? null,
    channelMessageIds: post.channelMessageIds ?? (post.channelMessageId ? [post.channelMessageId] : []),
    lastError: post.lastError ?? null,
    isPinned: post.isPinned ?? false,
    deletedAt: post.deletedAt ?? null,
    version: post.version ?? 1,
    createdByTelegramId: post.createdByTelegramId ?? 7141080131,
    createdAt: post.createdAt ?? now,
    updatedAt: post.updatedAt ?? now
  });
}
