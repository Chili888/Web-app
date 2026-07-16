import type {
  AdminMessageRouteRecord,
  AutoReplyRuleRecord,
  AutoReplyRuleDetails,
  BotSettingsRecord,
  BotMenuButton,
  ChannelPostRecord,
  ChannelPostContent,
  ChannelPostDetails,
  ChannelOperationAction,
  ChannelOperationRecord,
  CustomerMessageResolution,
  JoinTimeoutAction,
  JoinVerificationRecord,
  GroupModerationSettings,
  GroupOperationAction,
  GroupOperationRecord,
  ModerationRuleRecord,
  ModerationRuleDetails,
  MessageType,
  OutboxLease,
  StoredUpdate,
  TelegramUpdate,
  TelegramChatRef,
  TelegramUser
} from "../domain.js";

export interface RecordCustomerMessageInput {
  updateId: number;
  user: TelegramUser;
  chatId: number;
  messageId: number;
  messageType: MessageType;
  mediaGroupId: string | null;
  telegramFileId: string | null;
  receivedAt: Date;
}

export interface RecordAdminReplyInput {
  updateId: number;
  customerId: string;
  adminMessageId: number;
  messageType: MessageType;
  telegramFileId: string | null;
  receivedAt: Date;
  targetMessageId: number;
}

export interface CreateAdminRouteInput {
  adminTelegramId: number;
  adminChatId: number;
  adminMessageId: number;
  customerId: string;
  customerChatId: number;
  customerMessageId: number;
  sourceMessageType: MessageType;
  routeType: AdminMessageRouteRecord["routeType"];
}

export interface CreateJoinVerificationInput {
  updateId: number;
  telegramUserId: number;
  telegramChatId: number;
  joinedAt: Date;
  expiresAt: Date;
  timeoutAction: JoinTimeoutAction;
}

export interface AuditInput {
  actorType: "system" | "telegram_user" | "support_agent";
  actorTelegramId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: unknown;
}

export interface RecordModerationActionInput {
  chatId: number;
  userId: number;
  messageId: number;
  ruleId: string;
  action: ModerationRuleRecord["mode"];
  reasonCode: string;
  mutedUntil: Date | null;
}

export interface SaveChannelPostInput {
  contentType: string;
  content: ChannelPostContent;
  parseMode: ChannelPostRecord["parseMode"];
  scheduledAt: Date | null;
  timezone: string;
  actorTelegramId: number;
}

export interface UpdateChannelPostInput extends SaveChannelPostInput {
  id: string;
  expectedVersion: number;
}

export interface CreateChannelOperationInput {
  channelPostId: string;
  expectedVersion: number;
  idempotencyKey: string;
  action: ChannelOperationAction;
  payload: ChannelOperationRecord["payload"];
  actorTelegramId: number;
}

export interface CreateGroupOperationInput {
  idempotencyKey: string;
  action: GroupOperationAction;
  telegramChatId: TelegramChatRef;
  telegramUserId: number;
  untilAt: Date | null;
  reason: string;
  actorTelegramId: number;
}

export interface SaveModerationRuleInput {
  enabled: boolean;
  mode: ModerationRuleRecord["mode"];
  ruleType: ModerationRuleRecord["ruleType"];
  pattern: string | null;
  actionDurationSeconds: number | null;
  priority: number;
}

export interface UpdateBotSettingsInput {
  expectedVersion: number;
  welcomeMessage: string;
  helpMessage: string;
  whyUsMessage: string;
  stockMessage: string;
  tradeRulesMessage: string;
  contactMessage: string;
  businessHours: string;
  offlineMessage: string;
  miniAppUrl: string;
  channelUrl: string;
  groupUrl: string;
  automaticReplyEnabled: boolean;
  menuButtons: BotMenuButton[];
}

export interface SaveAutoReplyRuleInput {
  enabled: boolean;
  matchType: AutoReplyRuleRecord["matchType"];
  keyword: string;
  responseContent: string;
  priority: number;
}

export interface AcquireOutboxInput {
  idempotencyKey: string;
  action: string;
  payload: unknown;
  maxAttempts: number;
  workerId: string;
  now: Date;
}

export interface SupportStats {
  customers: number;
  messagesToday: number;
  pendingUpdates: number;
  deadLetters: number;
}

export interface ServiceHealth {
  database: "ok";
  worker: "ok" | "stale" | "missing";
  workerLastSeenAt: Date | null;
}

export interface SupportStore {
  persistUpdate(update: TelegramUpdate): Promise<boolean>;
  claimNextUpdate(workerId: string, now: Date): Promise<StoredUpdate | null>;
  completeUpdate(updateId: number, status: "completed" | "ignored", messageType?: MessageType): Promise<void>;
  retryUpdate(updateId: number, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;

  recordCustomerMessage(input: RecordCustomerMessageInput): Promise<CustomerMessageResolution>;
  markMediaGroupSummarySent(customerId: string, mediaGroupId: string, sentAt: Date): Promise<void>;
  recordAdminReply(input: RecordAdminReplyInput): Promise<boolean>;
  createAdminRoute(input: CreateAdminRouteInput): Promise<void>;
  findAdminRoute(adminTelegramId: number, adminChatId: number, adminMessageId: number, now: Date): Promise<AdminMessageRouteRecord | null>;
  markCustomerBlocked(customerId: string, blocked: boolean): Promise<void>;
  getBotSettings(): Promise<BotSettingsRecord>;
  updateBotSettings(input: UpdateBotSettingsInput): Promise<BotSettingsRecord | null>;
  isUserWhitelisted(chatId: number, userId: number): Promise<boolean>;
  findAutoReplies(text: string): Promise<AutoReplyRuleRecord[]>;
  listAutoReplyRules(): Promise<AutoReplyRuleDetails[]>;
  createAutoReplyRule(input: SaveAutoReplyRuleInput): Promise<AutoReplyRuleDetails>;
  updateAutoReplyRule(id: string, expectedVersion: number, input: SaveAutoReplyRuleInput): Promise<AutoReplyRuleDetails | null>;
  getSupportStats(now: Date): Promise<SupportStats>;

  createJoinVerification(input: CreateJoinVerificationInput): Promise<{record: JoinVerificationRecord; created: boolean}>;
  setJoinVerificationMessage(id: string, messageId: number): Promise<void>;
  getPendingJoinVerification(chatId: number, userId: number): Promise<JoinVerificationRecord | null>;
  recordJoinCheck(id: string, status: string): Promise<void>;
  completeJoinVerification(id: string, status: JoinVerificationRecord["status"], verifiedAt: Date | null): Promise<boolean>;
  claimExpiredJoinVerification(workerId: string, now: Date): Promise<JoinVerificationRecord | null>;

  claimDueChannelPost(workerId: string, now: Date): Promise<ChannelPostRecord | null>;
  completeChannelPost(id: string, channelMessageIds: number[], publishedAt: Date): Promise<boolean>;
  retryChannelPost(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;
  createChannelPost(input: SaveChannelPostInput): Promise<ChannelPostDetails>;
  updateChannelPost(input: UpdateChannelPostInput): Promise<ChannelPostDetails | null>;
  transitionChannelPost(
    id: string,
    expectedVersion: number,
    action: "cancel" | "retry",
    actorTelegramId: number,
    now: Date
  ): Promise<ChannelPostDetails | null>;
  listChannelPosts(status: string | null, limit: number): Promise<ChannelPostDetails[]>;
  createChannelOperation(input: CreateChannelOperationInput): Promise<ChannelOperationRecord | null>;
  claimDueChannelOperation(workerId: string, now: Date): Promise<ChannelOperationRecord | null>;
  completeChannelOperation(operation: ChannelOperationRecord, completedAt: Date): Promise<void>;
  retryChannelOperation(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;
  claimAdminApiRequest(idempotencyKey: string, adminTelegramId: number, method: string, path: string): Promise<boolean>;

  getModerationRules(): Promise<ModerationRuleRecord[]>;
  listModerationRules(): Promise<ModerationRuleDetails[]>;
  createModerationRule(input: SaveModerationRuleInput): Promise<ModerationRuleDetails>;
  updateModerationRule(id: string, expectedVersion: number, input: SaveModerationRuleInput): Promise<ModerationRuleDetails | null>;
  getGroupModerationSettings(): Promise<GroupModerationSettings>;
  updateGroupModerationSettings(settings: GroupModerationSettings, expectedVersion: number): Promise<GroupModerationSettings | null>;
  countRecentModerationViolations(chatId: number, userId: number, since: Date): Promise<number>;
  recordModerationAction(input: RecordModerationActionInput): Promise<boolean>;
  createGroupOperation(input: CreateGroupOperationInput): Promise<GroupOperationRecord>;
  claimDueGroupOperation(workerId: string, now: Date): Promise<GroupOperationRecord | null>;
  completeGroupOperation(id: string, completedAt: Date): Promise<void>;
  retryGroupOperation(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;

  writeAudit(input: AuditInput): Promise<void>;
  heartbeat(workerId: string, workerType: string, now: Date): Promise<void>;
  getServiceHealth(now: Date): Promise<ServiceHealth>;
  acquireOutbox(input: AcquireOutboxInput): Promise<OutboxLease>;
  markOutboxSent(id: string, response: unknown, sentAt: Date): Promise<void>;
  markOutboxRetry(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;
  close(): Promise<void>;
}
