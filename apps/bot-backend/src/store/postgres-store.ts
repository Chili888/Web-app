import {Pool, types} from "pg";
import type {QueryResultRow} from "pg";
import {databasePoolConfig} from "../database.js";
import type {
  AdminMessageRouteRecord,
  AutoReplyRuleDetails,
  AutoReplyRuleRecord,
  BotMenuButton,
  BotSettingsRecord,
  ChannelOperationRecord,
  ChannelPostRecord,
  ChannelPostDetails,
  GroupModerationSettings,
  GroupOperationRecord,
  JoinVerificationRecord,
  MessageType,
  ModerationRuleRecord,
  ModerationRuleDetails,
  OutboxLease,
  OutboxRecord,
  StoredUpdate,
  TelegramCustomerRecord,
  TelegramUpdate
} from "../domain.js";
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
  SupportStats,
  SupportStore,
  UpdateBotSettingsInput,
  UpdateChannelPostInput
} from "./store.js";

types.setTypeParser(20, (value) => Number(value));

interface UpdateRow extends QueryResultRow {
  update_id: number;
  payload: TelegramUpdate;
  status: StoredUpdate["status"];
  attempts: number;
  next_attempt_at: Date;
}

interface CustomerRow extends QueryResultRow {
  id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  username: string | null;
  first_name: string;
  last_name: string;
  language_code: string | null;
  is_blocked: boolean;
}

interface RouteRow extends QueryResultRow {
  id: string;
  admin_telegram_id: number;
  admin_chat_id: number;
  admin_message_id: number;
  customer_id: string;
  customer_chat_id: number;
  customer_message_id: number;
  source_message_type: MessageType;
  route_type: AdminMessageRouteRecord["routeType"];
}

interface JoinRow extends QueryResultRow {
  id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  joined_at: Date;
  verification_status: JoinVerificationRecord["status"];
  verification_message_id: number | null;
  expires_at: Date;
  attempts: number;
  timeout_action: JoinVerificationRecord["timeoutAction"];
}

interface ChannelPostRow extends QueryResultRow {
  id: string;
  status: ChannelPostRecord["status"];
  content_type: string;
  content: ChannelPostRecord["content"];
  parse_mode: ChannelPostRecord["parseMode"];
  scheduled_at: Date | null;
  attempts: number;
  max_attempts: number;
}

interface ChannelPostDetailsRow extends ChannelPostRow {
  channel_message_id: number | null;
  channel_message_ids: number[];
  last_error: string | null;
  is_pinned: boolean;
  deleted_at: Date | null;
  version: number;
  created_by_telegram_id: number;
  created_at: Date;
  updated_at: Date;
}

interface ChannelOperationRow extends QueryResultRow {
  id: string;
  channel_post_id: string;
  action: ChannelOperationRecord["action"];
  payload: ChannelOperationRecord["payload"];
  channel_message_ids: number[];
  attempts: number;
  max_attempts: number;
}

interface GroupOperationRow extends QueryResultRow {
  id: string;
  action: GroupOperationRecord["action"];
  telegram_chat_ref: string;
  telegram_user_id: number;
  until_at: Date | null;
  reason: string;
  attempts: number;
  max_attempts: number;
}

interface ModerationRuleDetailsRow extends QueryResultRow {
  id: string;
  enabled: boolean;
  mode: ModerationRuleDetails["mode"];
  rule_type: ModerationRuleDetails["ruleType"];
  pattern: string | null;
  action_duration_seconds: number | null;
  priority: number;
  version: number;
}

interface OutboxRow extends QueryResultRow {
  id: string;
  idempotency_key: string;
  action: string;
  status: OutboxRecord["status"];
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  telegram_response: unknown;
}

function updateFromRow(row: UpdateRow): StoredUpdate {
  return {
    updateId: row.update_id,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at
  };
}

function customerFromRow(row: CustomerRow): TelegramCustomerRecord {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    languageCode: row.language_code,
    isBlocked: row.is_blocked
  };
}

function routeFromRow(row: RouteRow): AdminMessageRouteRecord {
  return {
    id: row.id,
    adminTelegramId: row.admin_telegram_id,
    adminChatId: row.admin_chat_id,
    adminMessageId: row.admin_message_id,
    customerId: row.customer_id,
    customerChatId: row.customer_chat_id,
    customerMessageId: row.customer_message_id,
    sourceMessageType: row.source_message_type,
    routeType: row.route_type
  };
}

function joinFromRow(row: JoinRow): JoinVerificationRecord {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    joinedAt: row.joined_at,
    status: row.verification_status,
    verificationMessageId: row.verification_message_id,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    timeoutAction: row.timeout_action
  };
}

function channelPostFromRow(row: ChannelPostRow): ChannelPostRecord {
  return {
    id: row.id,
    status: row.status,
    contentType: row.content_type,
    content: row.content,
    parseMode: row.parse_mode,
    scheduledAt: row.scheduled_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  };
}

function channelPostDetailsFromRow(row: ChannelPostDetailsRow): ChannelPostDetails {
  return {
    ...channelPostFromRow(row),
    channelMessageId: row.channel_message_id,
    channelMessageIds: row.channel_message_ids,
    lastError: row.last_error,
    isPinned: row.is_pinned,
    deletedAt: row.deleted_at,
    version: row.version,
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function channelOperationFromRow(row: ChannelOperationRow): ChannelOperationRecord {
  return {
    id: row.id,
    channelPostId: row.channel_post_id,
    action: row.action,
    payload: row.payload,
    channelMessageIds: row.channel_message_ids,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  };
}

function groupOperationFromRow(row: GroupOperationRow): GroupOperationRecord {
  return {
    id: row.id,
    action: row.action,
    telegramChatId: /^-?\d+$/.test(row.telegram_chat_ref) ? Number(row.telegram_chat_ref) : row.telegram_chat_ref,
    telegramUserId: row.telegram_user_id,
    untilAt: row.until_at,
    reason: row.reason,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  };
}

function moderationRuleDetailsFromRow(row: ModerationRuleDetailsRow): ModerationRuleDetails {
  return {
    id: row.id,
    enabled: row.enabled,
    mode: row.mode,
    ruleType: row.rule_type,
    pattern: row.pattern,
    actionDurationSeconds: row.action_duration_seconds,
    priority: row.priority,
    version: row.version
  };
}

function outboxFromRow(row: OutboxRow): OutboxRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    response: row.telegram_response
  };
}

function updateType(update: TelegramUpdate): string {
  if (update.callback_query) return "callback_query";
  if (update.message) return "message";
  if (update.edited_message) return "edited_message";
  if (update.channel_post) return "channel_post";
  if (update.edited_channel_post) return "edited_channel_post";
  return "unknown";
}

export class PostgresSupportStore implements SupportStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool(databasePoolConfig(databaseUrl, {max: 12, idleTimeoutMillis: 30_000}));
  }

  async persistUpdate(update: TelegramUpdate): Promise<boolean> {
    const result = await this.pool.query(
      `insert into support.telegram_updates (update_id, payload, update_type)
       values ($1, $2::jsonb, $3)
       on conflict (update_id) do nothing`,
      [update.update_id, JSON.stringify(update), updateType(update)]
    );
    return result.rowCount === 1;
  }

  async claimNextUpdate(workerId: string, now: Date): Promise<StoredUpdate | null> {
    const result = await this.pool.query<UpdateRow>(
      `with candidate as (
         select id
         from support.telegram_updates
         where (
           (status in ('pending', 'retry') and next_attempt_at <= $2::timestamptz)
           or (status = 'processing' and locked_at < ($2::timestamptz - interval '5 minutes'))
         )
         order by created_at
         for update skip locked
         limit 1
       )
       update support.telegram_updates u
       set status = 'processing', attempts = attempts + 1,
           locked_at = $2::timestamptz, locked_by = $1
       from candidate
       where u.id = candidate.id
       returning u.update_id, u.payload, u.status, u.attempts, u.next_attempt_at`,
      [workerId, now]
    );
    return result.rows[0] ? updateFromRow(result.rows[0]) : null;
  }

  async completeUpdate(updateId: number, status: "completed" | "ignored", messageType?: MessageType): Promise<void> {
    await this.pool.query(
      `update support.telegram_updates
       set status = $2,
           payload = jsonb_build_object('update_id', update_id, 'message_type', $3::text),
           payload_redacted_at = now(), processed_at = now(),
           locked_at = null, locked_by = null, last_error = null
       where update_id = $1`,
      [updateId, status, messageType ?? "unknown"]
    );
  }

  async retryUpdate(updateId: number, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `update support.telegram_updates
       set status = $2, next_attempt_at = $3::timestamptz, last_error = $4,
           locked_at = null, locked_by = null,
           processed_at = case when $2 = 'dead_letter' then now() else processed_at end
       where update_id = $1`,
      [updateId, deadLetter ? "dead_letter" : "retry", nextAttemptAt, error.slice(0, 500)]
    );
  }

  async recordCustomerMessage(input: RecordCustomerMessageInput) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1::bigint)", [input.user.id]);
      const customerResult = await client.query<CustomerRow>(
        `insert into support.telegram_customers (
           telegram_user_id, telegram_chat_id, username, first_name, last_name,
           language_code, first_seen_at, last_seen_at
         ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz)
         on conflict (telegram_user_id) do update set
           telegram_chat_id = excluded.telegram_chat_id,
           username = excluded.username,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           language_code = excluded.language_code,
           last_seen_at = excluded.last_seen_at
         returning id, telegram_user_id, telegram_chat_id, username,
                   first_name, last_name, language_code, is_blocked`,
        [
          input.user.id, input.chatId, input.user.username ?? null, input.user.first_name,
          input.user.last_name ?? "", input.user.language_code ?? null, input.receivedAt
        ]
      );
      const customer = customerFromRow(customerResult.rows[0] as CustomerRow);
      const messageResult = await client.query(
        `insert into support.telegram_customer_messages (
           telegram_update_id, customer_id, customer_message_id, message_type,
           media_group_id, direction, telegram_file_id, received_at
         ) values ($1, $2, $3, $4, $5, 'customer_to_admin', $6, $7::timestamptz)
         on conflict (telegram_update_id) do nothing
         returning id`,
        [
          input.updateId, customer.id, input.messageId, input.messageType,
          input.mediaGroupId, input.telegramFileId, input.receivedAt
        ]
      );
      const inserted = messageResult.rowCount === 1;
      let shouldSendSummary = true;
      if (input.mediaGroupId) {
        await client.query(
          `insert into support.telegram_media_group_summaries (customer_id, media_group_id)
           values ($1, $2) on conflict do nothing`,
          [customer.id, input.mediaGroupId]
        );
        const summary = await client.query<{sent_at: Date | null} & QueryResultRow>(
          `select sent_at from support.telegram_media_group_summaries
           where customer_id = $1 and media_group_id = $2`,
          [customer.id, input.mediaGroupId]
        );
        shouldSendSummary = summary.rows[0]?.sent_at === null;
      }
      await client.query("commit");
      return {customer, inserted, shouldSendSummary};
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markMediaGroupSummarySent(customerId: string, mediaGroupId: string, sentAt: Date): Promise<void> {
    await this.pool.query(
      `update support.telegram_media_group_summaries
       set sent_at = coalesce(sent_at, $3::timestamptz)
       where customer_id = $1 and media_group_id = $2`,
      [customerId, mediaGroupId, sentAt]
    );
  }

  async recordAdminReply(input: RecordAdminReplyInput): Promise<boolean> {
    const result = await this.pool.query(
      `insert into support.telegram_customer_messages (
         telegram_update_id, customer_id, customer_message_id, message_type,
         direction, telegram_file_id, delivery_status, target_message_id, received_at
       ) values ($1, $2, $3, $4, 'admin_to_customer', $5, 'sent', $6, $7::timestamptz)
       on conflict (telegram_update_id) do nothing`,
      [
        input.updateId, input.customerId, input.adminMessageId, input.messageType,
        input.telegramFileId, input.targetMessageId, input.receivedAt
      ]
    );
    return result.rowCount === 1;
  }

  async createAdminRoute(input: CreateAdminRouteInput): Promise<void> {
    await this.pool.query(
      `insert into support.telegram_admin_message_routes (
         admin_telegram_id, admin_chat_id, admin_message_id, customer_id,
         customer_chat_id, customer_message_id, source_message_type, route_type
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (admin_chat_id, admin_message_id) do nothing`,
      [
        input.adminTelegramId, input.adminChatId, input.adminMessageId, input.customerId,
        input.customerChatId, input.customerMessageId, input.sourceMessageType, input.routeType
      ]
    );
  }

  async findAdminRoute(adminTelegramId: number, adminChatId: number, adminMessageId: number, now: Date) {
    const result = await this.pool.query<RouteRow>(
      `select id, admin_telegram_id, admin_chat_id, admin_message_id, customer_id,
              customer_chat_id, customer_message_id, source_message_type, route_type
       from support.telegram_admin_message_routes
       where admin_telegram_id = $1 and admin_chat_id = $2 and admin_message_id = $3
         and (expires_at is null or expires_at > $4::timestamptz)
       limit 1`,
      [adminTelegramId, adminChatId, adminMessageId, now]
    );
    return result.rows[0] ? routeFromRow(result.rows[0]) : null;
  }

  async markCustomerBlocked(customerId: string, blocked: boolean): Promise<void> {
    await this.pool.query(
      "update support.telegram_customers set is_blocked = $2 where id = $1",
      [customerId, blocked]
    );
  }

  async getBotSettings(): Promise<BotSettingsRecord> {
    const result = await this.pool.query<{
      version: number;
      welcome_message: string;
      help_message: string;
      why_us_message: string;
      stock_message: string;
      trade_rules_message: string;
      contact_message: string;
      business_hours: string;
      offline_message: string;
      mini_app_url: string;
      channel_url: string;
      group_url: string;
      automatic_reply_enabled: boolean;
      join_verify_enabled: boolean;
      join_verify_prompt: string;
      join_verify_timeout_seconds: number;
      join_verify_timeout_action: JoinVerificationRecord["timeoutAction"];
      join_verify_welcome_message: string;
      menu_buttons: BotMenuButton[];
    } & QueryResultRow>(
      `select version, welcome_message, help_message, why_us_message, stock_message,
              trade_rules_message, contact_message, business_hours, offline_message,
              mini_app_url, channel_url, group_url, automatic_reply_enabled,
              join_verify_enabled, join_verify_prompt, join_verify_timeout_seconds,
              join_verify_timeout_action, join_verify_welcome_message, menu_buttons
       from support.bot_settings where id = true`
    );
    const row = result.rows[0];
    if (!row) throw new Error("Bot settings are missing");
    return {
      version: row.version,
      welcomeMessage: row.welcome_message,
      helpMessage: row.help_message,
      whyUsMessage: row.why_us_message,
      stockMessage: row.stock_message,
      tradeRulesMessage: row.trade_rules_message,
      contactMessage: row.contact_message,
      businessHours: row.business_hours,
      offlineMessage: row.offline_message,
      miniAppUrl: row.mini_app_url,
      channelUrl: row.channel_url,
      groupUrl: row.group_url,
      automaticReplyEnabled: row.automatic_reply_enabled,
      joinVerifyEnabled: row.join_verify_enabled,
      joinVerifyPrompt: row.join_verify_prompt,
      joinVerifyTimeoutSeconds: row.join_verify_timeout_seconds,
      joinVerifyTimeoutAction: row.join_verify_timeout_action,
      joinVerifyWelcomeMessage: row.join_verify_welcome_message,
      menuButtons: row.menu_buttons
    };
  }

  async updateBotSettings(input: UpdateBotSettingsInput): Promise<BotSettingsRecord | null> {
    const result = await this.pool.query(
      `update support.bot_settings
       set welcome_message = $2, help_message = $3, why_us_message = $4,
           stock_message = $5, trade_rules_message = $6, contact_message = $7,
           business_hours = $8, offline_message = $9, mini_app_url = $10,
           channel_url = $11, group_url = $12, automatic_reply_enabled = $13,
           menu_buttons = $14::jsonb, version = version + 1
       where id = true and version = $1`,
      [
        input.expectedVersion, input.welcomeMessage, input.helpMessage, input.whyUsMessage,
        input.stockMessage, input.tradeRulesMessage, input.contactMessage,
        input.businessHours, input.offlineMessage, input.miniAppUrl, input.channelUrl,
        input.groupUrl, input.automaticReplyEnabled, JSON.stringify(input.menuButtons)
      ]
    );
    return result.rowCount === 1 ? this.getBotSettings() : null;
  }

  async isUserWhitelisted(chatId: number, userId: number): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from support.telegram_user_whitelist
       where telegram_user_id = $2 and enabled = true
         and (telegram_chat_id is null or telegram_chat_id = $1)
       limit 1`,
      [chatId, userId]
    );
    return result.rowCount === 1;
  }

  async findAutoReplies(text: string): Promise<AutoReplyRuleRecord[]> {
    const result = await this.pool.query<{
      id: string;
      match_type: AutoReplyRuleRecord["matchType"];
      keyword: string;
      response_type: "text";
      response_content: string;
      priority: number;
    } & QueryResultRow>(
      `select id, match_type, keyword, response_type, response_content, priority
       from support.bot_auto_reply_rules
       where enabled = true
       order by priority, created_at
       limit 100`
    );
    const normalized = text.trim().toLocaleLowerCase("zh-CN");
    return result.rows.filter((row) => ruleMatches(row.match_type, row.keyword, normalized)).map((row) => ({
      id: row.id,
      matchType: row.match_type,
      keyword: row.keyword,
      responseType: row.response_type,
      responseContent: row.response_content,
      priority: row.priority
    }));
  }

  async listAutoReplyRules(): Promise<AutoReplyRuleDetails[]> {
    const result = await this.pool.query<{
      id: string;
      enabled: boolean;
      match_type: AutoReplyRuleRecord["matchType"];
      keyword: string;
      response_content: string;
      priority: number;
      version: number;
    } & QueryResultRow>(
      `select id, enabled, match_type, keyword, response_content, priority, version
       from support.bot_auto_reply_rules order by priority, created_at limit 500`
    );
    return result.rows.map((row) => ({
      id: row.id,
      enabled: row.enabled,
      matchType: row.match_type,
      keyword: row.keyword,
      responseType: "text",
      responseContent: row.response_content,
      priority: row.priority,
      version: row.version
    }));
  }

  async createAutoReplyRule(input: SaveAutoReplyRuleInput): Promise<AutoReplyRuleDetails> {
    const result = await this.pool.query<{
      id: string;
      version: number;
    } & QueryResultRow>(
      `insert into support.bot_auto_reply_rules (
         enabled, match_type, keyword, response_type, response_content, priority
       ) values ($1, $2, $3, 'text', $4, $5)
       returning id, version`,
      [input.enabled, input.matchType, input.keyword, input.responseContent, input.priority]
    );
    return {
      id: result.rows[0]?.id as string,
      ...input,
      responseType: "text",
      version: result.rows[0]?.version ?? 1
    };
  }

  async updateAutoReplyRule(
    id: string,
    expectedVersion: number,
    input: SaveAutoReplyRuleInput
  ): Promise<AutoReplyRuleDetails | null> {
    const result = await this.pool.query<{version: number} & QueryResultRow>(
      `update support.bot_auto_reply_rules
       set enabled = $3, match_type = $4, keyword = $5,
           response_content = $6, priority = $7, version = version + 1
       where id = $1 and version = $2
       returning version`,
      [id, expectedVersion, input.enabled, input.matchType, input.keyword, input.responseContent, input.priority]
    );
    return result.rows[0] ? {
      id,
      ...input,
      responseType: "text",
      version: result.rows[0].version
    } : null;
  }

  async getSupportStats(now: Date): Promise<SupportStats> {
    const result = await this.pool.query<{
      customers: number;
      messages_today: number;
      pending_updates: number;
      dead_letters: number;
    } & QueryResultRow>(
      `select
         (select count(*)::int from support.telegram_customers) as customers,
         (select count(*)::int from support.telegram_customer_messages
          where received_at >= date_trunc('day', $1::timestamptz)) as messages_today,
         (select count(*)::int from support.telegram_updates
          where status in ('pending', 'retry', 'processing')) as pending_updates,
         ((select count(*) from support.telegram_updates where status = 'dead_letter')
          + (select count(*) from support.telegram_outbox where status = 'dead_letter'))::int as dead_letters`,
      [now]
    );
    const row = result.rows[0] as (typeof result.rows)[number];
    return {
      customers: row.customers,
      messagesToday: row.messages_today,
      pendingUpdates: row.pending_updates,
      deadLetters: row.dead_letters
    };
  }

  async isAdminProfile(userId: string): Promise<boolean> {
    const result = await this.pool.query<{allowed: boolean} & QueryResultRow>(
      "select exists (select 1 from public.admin_profiles where user_id = $1::uuid) as allowed",
      [userId]
    );
    return result.rows[0]?.allowed === true;
  }

  async createJoinVerification(input: CreateJoinVerificationInput) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1::bigint)", [input.telegramUserId]);
      const existing = await client.query<JoinRow>(
        `${JOIN_SELECT}
         where telegram_chat_id = $1 and telegram_user_id = $2
           and verification_status = 'pending'
         order by created_at desc limit 1 for update`,
        [input.telegramChatId, input.telegramUserId]
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return {record: joinFromRow(existing.rows[0]), created: false};
      }
      const inserted = await client.query<JoinRow>(
        `insert into support.join_verifications (
           source_update_id, telegram_user_id, telegram_chat_id, joined_at,
           expires_at, timeout_action
         ) values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)
         returning id, telegram_user_id, telegram_chat_id, joined_at,
                   verification_status, verification_message_id, expires_at, attempts, timeout_action`,
        [
          input.updateId, input.telegramUserId, input.telegramChatId, input.joinedAt,
          input.expiresAt, input.timeoutAction
        ]
      );
      await client.query("commit");
      return {record: joinFromRow(inserted.rows[0] as JoinRow), created: true};
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setJoinVerificationMessage(id: string, messageId: number): Promise<void> {
    await this.pool.query(
      `update support.join_verifications
       set verification_message_id = coalesce(verification_message_id, $2)
       where id = $1`,
      [id, messageId]
    );
  }

  async getPendingJoinVerification(chatId: number, userId: number) {
    const result = await this.pool.query<JoinRow>(
      `${JOIN_SELECT}
       where telegram_chat_id = $1 and telegram_user_id = $2
         and verification_status = 'pending'
       order by created_at desc limit 1`,
      [chatId, userId]
    );
    return result.rows[0] ? joinFromRow(result.rows[0]) : null;
  }

  async recordJoinCheck(id: string, status: string): Promise<void> {
    await this.pool.query(
      `update support.join_verifications
       set attempts = attempts + 1, last_check_status = $2
       where id = $1 and verification_status = 'pending'`,
      [id, status.slice(0, 80)]
    );
  }

  async completeJoinVerification(
    id: string,
    status: JoinVerificationRecord["status"],
    verifiedAt: Date | null
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update support.join_verifications
       set verification_status = $2,
           verified_at = $3::timestamptz,
           locked_at = null,
           locked_by = null
       where id = $1 and verification_status = 'pending'`,
      [id, status, verifiedAt]
    );
    return result.rowCount === 1;
  }

  async claimExpiredJoinVerification(workerId: string, now: Date) {
    const result = await this.pool.query<JoinRow>(
      `with candidate as (
         select id from support.join_verifications
         where verification_status = 'pending'
           and expires_at <= $2::timestamptz
           and (locked_at is null or locked_at < ($2::timestamptz - interval '5 minutes'))
         order by expires_at, created_at
         for update skip locked
         limit 1
       )
       update support.join_verifications verification
       set locked_at = $2::timestamptz, locked_by = $1
       from candidate
       where verification.id = candidate.id
       returning verification.id, verification.telegram_user_id,
                 verification.telegram_chat_id, verification.joined_at,
                 verification.verification_status, verification.verification_message_id,
                 verification.expires_at, verification.attempts, verification.timeout_action`,
      [workerId, now]
    );
    return result.rows[0] ? joinFromRow(result.rows[0]) : null;
  }

  async claimDueChannelPost(workerId: string, now: Date) {
    const result = await this.pool.query<ChannelPostRow>(
      `with candidate as (
         select id from support.channel_posts
         where status in ('scheduled', 'failed')
           and coalesce(next_attempt_at, scheduled_at) <= $2::timestamptz
           and attempts < max_attempts
           and (locked_at is null or locked_at < ($2::timestamptz - interval '5 minutes'))
         order by coalesce(next_attempt_at, scheduled_at), created_at
         for update skip locked
         limit 1
       )
       update support.channel_posts post
       set status = 'publishing', attempts = attempts + 1,
           locked_at = $2::timestamptz, locked_by = $1
       from candidate
       where post.id = candidate.id
       returning post.id, post.status, post.content_type, post.content,
                 post.parse_mode, post.scheduled_at, post.attempts, post.max_attempts`,
      [workerId, now]
    );
    return result.rows[0] ? channelPostFromRow(result.rows[0]) : null;
  }

  async completeChannelPost(id: string, channelMessageIds: number[], publishedAt: Date): Promise<boolean> {
    const channelMessageId = channelMessageIds[0];
    if (!channelMessageId) throw new Error("At least one channel message ID is required");
    const result = await this.pool.query(
      `update support.channel_posts
       set status = 'published', channel_message_id = $2, channel_message_ids = $3::bigint[],
           published_at = $4::timestamptz, next_attempt_at = null,
           locked_at = null, locked_by = null, last_error = null
       where id = $1 and status = 'publishing'`,
      [id, channelMessageId, channelMessageIds, publishedAt]
    );
    return result.rowCount === 1;
  }

  async retryChannelPost(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `update support.channel_posts
       set status = $2, last_error = $3, next_attempt_at = $4::timestamptz,
           locked_at = null, locked_by = null
       where id = $1 and status = 'publishing'`,
      [id, deadLetter ? "dead_letter" : "failed", error.slice(0, 500), nextAttemptAt]
    );
  }

  async createChannelPost(input: SaveChannelPostInput): Promise<ChannelPostDetails> {
    const result = await this.pool.query<ChannelPostDetailsRow>(
      `insert into support.channel_posts (
         status, content_type, content, parse_mode, scheduled_at, next_attempt_at,
         timezone, created_by_telegram_id
       ) values (
         case when $4::timestamptz is null then 'draft' else 'scheduled' end,
         $1, $2::jsonb, $3, $4::timestamptz, $4::timestamptz, $5, $6
       )
       returning ${CHANNEL_POST_DETAILS_COLUMNS}`,
      [
        input.contentType, JSON.stringify(input.content), input.parseMode,
        input.scheduledAt, input.timezone, input.actorTelegramId
      ]
    );
    return channelPostDetailsFromRow(result.rows[0] as ChannelPostDetailsRow);
  }

  async updateChannelPost(input: UpdateChannelPostInput) {
    const result = await this.pool.query<ChannelPostDetailsRow>(
      `update support.channel_posts
       set status = case when $5::timestamptz is null then 'draft' else 'scheduled' end,
           content_type = $2, content = $3::jsonb, parse_mode = $4,
           scheduled_at = $5::timestamptz, next_attempt_at = $5::timestamptz,
           timezone = $6, attempts = 0, last_error = null, version = version + 1
       where id = $1 and version = $7
         and status in ('draft', 'scheduled', 'failed')
       returning ${CHANNEL_POST_DETAILS_COLUMNS}`,
      [
        input.id, input.contentType, JSON.stringify(input.content), input.parseMode,
        input.scheduledAt, input.timezone, input.expectedVersion
      ]
    );
    return result.rows[0] ? channelPostDetailsFromRow(result.rows[0]) : null;
  }

  async transitionChannelPost(
    id: string,
    expectedVersion: number,
    action: "cancel" | "retry",
    _actorTelegramId: number,
    now: Date
  ) {
    const status = action === "cancel" ? "cancelled" : "scheduled";
    const allowed = action === "cancel"
      ? ["draft", "scheduled", "failed"]
      : ["failed", "dead_letter"];
    const result = await this.pool.query<ChannelPostDetailsRow>(
      `update support.channel_posts
       set status = $3,
           next_attempt_at = case when $3 = 'scheduled' then $4::timestamptz else null end,
           scheduled_at = case when $3 = 'scheduled' then $4::timestamptz else scheduled_at end,
           attempts = case when $3 = 'scheduled' then 0 else attempts end,
           last_error = case when $3 = 'scheduled' then null else last_error end,
           locked_at = null, locked_by = null, version = version + 1
       where id = $1 and version = $2 and status = any($5::text[])
       returning ${CHANNEL_POST_DETAILS_COLUMNS}`,
      [id, expectedVersion, status, now, allowed]
    );
    return result.rows[0] ? channelPostDetailsFromRow(result.rows[0]) : null;
  }

  async listChannelPosts(status: string | null, limit: number): Promise<ChannelPostDetails[]> {
    const result = await this.pool.query<ChannelPostDetailsRow>(
      `select ${CHANNEL_POST_DETAILS_COLUMNS}
       from support.channel_posts
       where ($1::text is null or status = $1)
       order by created_at desc
       limit $2`,
      [status, limit]
    );
    return result.rows.map(channelPostDetailsFromRow);
  }

  async createChannelOperation(input: CreateChannelOperationInput): Promise<ChannelOperationRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const post = await client.query<{channel_message_ids: number[]} & QueryResultRow>(
        `update support.channel_posts post
         set version = version + 1
         where id = $1 and version = $2 and status = 'published'
           and cardinality(channel_message_ids) > 0 and deleted_at is null
           and (
             ($3 = 'edit_text' and content_type = 'text')
             or ($3 = 'edit_caption' and content_type <> 'text')
             or $3 in ('delete', 'pin', 'unpin')
           )
           and not exists (
             select 1 from support.channel_operations operation
             where operation.channel_post_id = post.id
               and operation.status in ('pending', 'processing', 'failed')
           )
         returning channel_message_ids`,
        [input.channelPostId, input.expectedVersion, input.action]
      );
      if (!post.rows[0]) {
        await client.query("rollback");
        return null;
      }
      const operation = await client.query<ChannelOperationRow>(
        `insert into support.channel_operations as operation (
           channel_post_id, idempotency_key, action, payload, channel_message_ids, created_by_telegram_id
         ) values ($1, $2, $3, $4::jsonb, $5, $6)
         returning ${CHANNEL_OPERATION_COLUMNS}`,
        [
          input.channelPostId, input.idempotencyKey, input.action, JSON.stringify(input.payload),
          post.rows[0].channel_message_ids, input.actorTelegramId
        ]
      );
      await client.query("commit");
      return channelOperationFromRow(operation.rows[0] as ChannelOperationRow);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDueChannelOperation(workerId: string, now: Date): Promise<ChannelOperationRecord | null> {
    const result = await this.pool.query<ChannelOperationRow>(
      `with candidate as (
         select id from support.channel_operations
         where status in ('pending', 'failed')
           and next_attempt_at <= $2::timestamptz
           and attempts < max_attempts
           and (locked_at is null or locked_at < ($2::timestamptz - interval '5 minutes'))
         order by next_attempt_at, created_at
         for update skip locked
         limit 1
       )
       update support.channel_operations operation
       set status = 'processing', attempts = attempts + 1,
           locked_at = $2::timestamptz, locked_by = $1
       from candidate
       where operation.id = candidate.id
       returning ${CHANNEL_OPERATION_COLUMNS.replaceAll("\n", " ")}`,
      [workerId, now]
    );
    return result.rows[0] ? channelOperationFromRow(result.rows[0]) : null;
  }

  async completeChannelOperation(operation: ChannelOperationRecord, completedAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const completed = await client.query(
        `update support.channel_operations
         set status = 'completed', completed_at = $2::timestamptz,
             locked_at = null, locked_by = null, last_error = null
         where id = $1 and status = 'processing'`,
        [operation.id, completedAt]
      );
      if (completed.rowCount !== 1) throw new Error("Channel operation is not processing");
      const text = operation.payload.text ?? null;
      const caption = operation.payload.caption ?? null;
      const parseMode = operation.payload.parseMode ?? null;
      await client.query(
        `update support.channel_posts
         set content = case
               when $2 = 'edit_text' then jsonb_set(content, '{text}', to_jsonb($3::text), true)
               when $2 = 'edit_caption' then jsonb_set(content, '{media,0,caption}', to_jsonb($4::text), true)
               else content
             end,
             parse_mode = case when $2 in ('edit_text', 'edit_caption') then $5 else parse_mode end,
             is_pinned = case when $2 = 'pin' then true when $2 = 'unpin' then false else is_pinned end,
             deleted_at = case when $2 = 'delete' then $6::timestamptz else deleted_at end
         where id = $1`,
        [operation.channelPostId, operation.action, text, caption, parseMode, completedAt]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async retryChannelOperation(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `update support.channel_operations
       set status = $2, last_error = $3, next_attempt_at = $4::timestamptz,
           locked_at = null, locked_by = null
       where id = $1 and status = 'processing'`,
      [id, deadLetter ? "dead_letter" : "failed", error.slice(0, 500), nextAttemptAt]
    );
  }

  async claimAdminApiRequest(
    idempotencyKey: string,
    adminTelegramId: number,
    method: string,
    path: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `insert into support.admin_api_requests (
         idempotency_key, admin_telegram_id, method, path
       ) values ($1, $2, $3, $4)
       on conflict (idempotency_key) do nothing`,
      [idempotencyKey, adminTelegramId, method, path]
    );
    return result.rowCount === 1;
  }

  async getModerationRules(): Promise<ModerationRuleRecord[]> {
    const result = await this.pool.query<{
      id: string;
      mode: ModerationRuleRecord["mode"];
      rule_type: ModerationRuleRecord["ruleType"];
      pattern: string | null;
      action_duration_seconds: number | null;
    } & QueryResultRow>(
      `select id, mode, rule_type, pattern, action_duration_seconds
       from support.moderation_rules
       where enabled = true and rule_type in ('keyword', 'link')
       order by priority, created_at
       limit 200`
    );
    return result.rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      ruleType: row.rule_type,
      pattern: row.pattern,
      actionDurationSeconds: row.action_duration_seconds
    }));
  }

  async listModerationRules(): Promise<ModerationRuleDetails[]> {
    const result = await this.pool.query<ModerationRuleDetailsRow>(
      `select id, enabled, mode, rule_type, pattern, action_duration_seconds, priority, version
       from support.moderation_rules order by priority, created_at limit 500`
    );
    return result.rows.map(moderationRuleDetailsFromRow);
  }

  async createModerationRule(input: SaveModerationRuleInput): Promise<ModerationRuleDetails> {
    const result = await this.pool.query<ModerationRuleDetailsRow>(
      `insert into support.moderation_rules (
         enabled, mode, rule_type, pattern, action_duration_seconds, priority
       ) values ($1, $2, $3, $4, $5, $6)
       returning id, enabled, mode, rule_type, pattern, action_duration_seconds, priority, version`,
      [input.enabled, input.mode, input.ruleType, input.pattern, input.actionDurationSeconds, input.priority]
    );
    return moderationRuleDetailsFromRow(result.rows[0] as ModerationRuleDetailsRow);
  }

  async updateModerationRule(
    id: string,
    expectedVersion: number,
    input: SaveModerationRuleInput
  ): Promise<ModerationRuleDetails | null> {
    const result = await this.pool.query<ModerationRuleDetailsRow>(
      `update support.moderation_rules
       set enabled = $3, mode = $4, rule_type = $5, pattern = $6,
           action_duration_seconds = $7, priority = $8, version = version + 1
       where id = $1 and version = $2
       returning id, enabled, mode, rule_type, pattern, action_duration_seconds, priority, version`,
      [
        id, expectedVersion, input.enabled, input.mode, input.ruleType,
        input.pattern, input.actionDurationSeconds, input.priority
      ]
    );
    return result.rows[0] ? moderationRuleDetailsFromRow(result.rows[0]) : null;
  }

  async getGroupModerationSettings(): Promise<GroupModerationSettings> {
    const result = await this.pool.query<{
      enabled: boolean;
      violation_window_seconds: number;
      mute_after_violations: number;
      ban_after_violations: number;
      mute_duration_seconds: number;
      warning_message: string;
      version: number;
    } & QueryResultRow>(
      `select enabled, violation_window_seconds, mute_after_violations,
              ban_after_violations, mute_duration_seconds, warning_message, version
       from support.group_moderation_settings where singleton = true`
    );
    const row = result.rows[0];
    if (!row) throw new Error("Group moderation settings are missing");
    return {
      version: row.version,
      enabled: row.enabled,
      violationWindowSeconds: row.violation_window_seconds,
      muteAfterViolations: row.mute_after_violations,
      banAfterViolations: row.ban_after_violations,
      muteDurationSeconds: row.mute_duration_seconds,
      warningMessage: row.warning_message
    };
  }

  async updateGroupModerationSettings(settings: GroupModerationSettings, expectedVersion: number): Promise<GroupModerationSettings | null> {
    const updated = await this.pool.query(
      `update support.group_moderation_settings
       set enabled = $1, violation_window_seconds = $2, mute_after_violations = $3,
           ban_after_violations = $4, mute_duration_seconds = $5, warning_message = $6,
           version = version + 1
       where singleton = true and version = $7`,
      [
        settings.enabled, settings.violationWindowSeconds, settings.muteAfterViolations,
        settings.banAfterViolations, settings.muteDurationSeconds, settings.warningMessage, expectedVersion
      ]
    );
    if (updated.rowCount !== 1) return null;
    return this.getGroupModerationSettings();
  }

  async countRecentModerationViolations(chatId: number, userId: number, since: Date): Promise<number> {
    const result = await this.pool.query<{count: number} & QueryResultRow>(
      `select count(*)::int as count from support.moderation_actions
       where telegram_chat_id = $1 and telegram_user_id = $2
         and created_at >= $3::timestamptz and reversed_at is null`,
      [chatId, userId, since]
    );
    return result.rows[0]?.count ?? 0;
  }

  async recordModerationAction(input: RecordModerationActionInput): Promise<boolean> {
    const result = await this.pool.query(
      `insert into support.moderation_actions (
         telegram_chat_id, telegram_user_id, source_message_id, rule_id,
         action, reason_code, muted_until
       ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       on conflict (telegram_chat_id, source_message_id, rule_id, action)
         where source_message_id is not null and rule_id is not null
       do nothing`,
      [
        input.chatId, input.userId, input.messageId, input.ruleId,
        input.action, input.reasonCode, input.mutedUntil
      ]
    );
    return result.rowCount === 1;
  }

  async createGroupOperation(input: CreateGroupOperationInput): Promise<GroupOperationRecord> {
    const result = await this.pool.query<GroupOperationRow>(
      `insert into support.group_operations as operation (
         idempotency_key, action, telegram_chat_ref, telegram_user_id,
         until_at, reason, created_by_telegram_id
       ) values ($1, $2, $3, $4, $5::timestamptz, $6, $7)
       returning ${GROUP_OPERATION_COLUMNS}`,
      [
        input.idempotencyKey, input.action, input.telegramChatId, input.telegramUserId,
        input.untilAt, input.reason, input.actorTelegramId
      ]
    );
    return groupOperationFromRow(result.rows[0] as GroupOperationRow);
  }

  async claimDueGroupOperation(workerId: string, now: Date): Promise<GroupOperationRecord | null> {
    const result = await this.pool.query<GroupOperationRow>(
      `with candidate as (
         select id from support.group_operations
         where status in ('pending', 'failed') and next_attempt_at <= $2::timestamptz
           and attempts < max_attempts
           and (locked_at is null or locked_at < ($2::timestamptz - interval '5 minutes'))
         order by next_attempt_at, created_at
         for update skip locked limit 1
       )
       update support.group_operations operation
       set status = 'processing', attempts = attempts + 1,
           locked_at = $2::timestamptz, locked_by = $1
       from candidate where operation.id = candidate.id
       returning ${GROUP_OPERATION_COLUMNS.replaceAll("\n", " ")}`,
      [workerId, now]
    );
    return result.rows[0] ? groupOperationFromRow(result.rows[0]) : null;
  }

  async completeGroupOperation(id: string, completedAt: Date): Promise<void> {
    await this.pool.query(
      `update support.group_operations
       set status = 'completed', completed_at = $2::timestamptz,
           locked_at = null, locked_by = null, last_error = null
       where id = $1 and status = 'processing'`,
      [id, completedAt]
    );
  }

  async retryGroupOperation(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `update support.group_operations
       set status = $2, last_error = $3, next_attempt_at = $4::timestamptz,
           locked_at = null, locked_by = null
       where id = $1 and status = 'processing'`,
      [id, deadLetter ? "dead_letter" : "failed", error.slice(0, 500), nextAttemptAt]
    );
  }

  async writeAudit(input: AuditInput): Promise<void> {
    await this.pool.query(
      `insert into support.audit_logs (
         actor_type, actor_telegram_id, action, entity_type, entity_id,
         before_state, after_state, metadata
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        input.actorType, input.actorTelegramId, input.action, input.entityType, input.entityId,
        JSON.stringify(input.beforeState ?? null), JSON.stringify(input.afterState ?? null),
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  async heartbeat(workerId: string, workerType: string, now: Date): Promise<void> {
    await this.pool.query(
      `insert into support.worker_heartbeats (worker_id, worker_type, last_seen_at)
       values ($1, $2, $3::timestamptz)
       on conflict (worker_id) do update set
         worker_type = excluded.worker_type,
         last_seen_at = excluded.last_seen_at`,
      [workerId, workerType, now]
    );
  }

  async getServiceHealth(now: Date) {
    const result = await this.pool.query<{last_seen_at: Date | null} & QueryResultRow>(
      `select max(last_seen_at) as last_seen_at
       from support.worker_heartbeats
       where worker_type = 'telegram'`
    );
    const lastSeenAt = result.rows[0]?.last_seen_at ?? null;
    const age = lastSeenAt ? now.getTime() - lastSeenAt.getTime() : Number.POSITIVE_INFINITY;
    return {
      database: "ok" as const,
      worker: lastSeenAt ? (age <= 60_000 ? "ok" as const : "stale" as const) : "missing" as const,
      workerLastSeenAt: lastSeenAt
    };
  }

  async acquireOutbox(input: AcquireOutboxInput): Promise<OutboxLease> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into support.telegram_outbox (
           idempotency_key, action, payload, max_attempts, next_attempt_at
         ) values ($1, $2, $3::jsonb, $4, $5::timestamptz)
         on conflict (idempotency_key) do nothing`,
        [input.idempotencyKey, input.action, JSON.stringify(input.payload), input.maxAttempts, input.now]
      );
      const selected = await client.query<OutboxRow>(
        `select id, idempotency_key, action, status, attempts, max_attempts,
                case when status = 'processing' and locked_at is not null
                  then greatest(next_attempt_at, locked_at + interval '5 minutes')
                  else next_attempt_at end as next_attempt_at,
                telegram_response
         from support.telegram_outbox
         where idempotency_key = $1
         for update`,
        [input.idempotencyKey]
      );
      let row = selected.rows[0] as OutboxRow;
      if (row.status === "sent" || row.status === "dead_letter") {
        await client.query("commit");
        return {record: outboxFromRow(row), execute: false};
      }
      if (row.attempts >= row.max_attempts) {
        const dead = await client.query<OutboxRow>(
          `update support.telegram_outbox
           set status = 'dead_letter', locked_at = null, locked_by = null
           where id = $1
           returning id, idempotency_key, action, status, attempts, max_attempts,
                     next_attempt_at, telegram_response`,
          [row.id]
        );
        await client.query("commit");
        return {record: outboxFromRow(dead.rows[0] as OutboxRow), execute: false};
      }
      const acquired = await client.query<OutboxRow>(
        `update support.telegram_outbox
         set status = 'processing', attempts = attempts + 1,
             locked_at = $2::timestamptz, locked_by = $3
         where id = $1
           and next_attempt_at <= $2::timestamptz
           and (
             status in ('pending', 'retry')
             or (status = 'processing' and locked_at < ($2::timestamptz - interval '5 minutes'))
           )
         returning id, idempotency_key, action, status, attempts, max_attempts,
                   next_attempt_at, telegram_response`,
        [row.id, input.now, input.workerId]
      );
      row = acquired.rows[0] ?? row;
      await client.query("commit");
      return {record: outboxFromRow(row), execute: acquired.rowCount === 1};
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboxSent(id: string, response: unknown, sentAt: Date): Promise<void> {
    await this.pool.query(
      `update support.telegram_outbox
       set status = 'sent', telegram_response = $2::jsonb,
           sent_at = $3::timestamptz, locked_at = null, locked_by = null, last_error = null
       where id = $1`,
      [id, JSON.stringify(response), sentAt]
    );
  }

  async markOutboxRetry(id: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.pool.query(
      `update support.telegram_outbox
       set status = $2, last_error = $3, next_attempt_at = $4::timestamptz,
           locked_at = null, locked_by = null
       where id = $1`,
      [id, deadLetter ? "dead_letter" : "retry", error.slice(0, 500), nextAttemptAt]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const JOIN_SELECT = `
  select id, telegram_user_id, telegram_chat_id, joined_at, verification_status,
         verification_message_id, expires_at, attempts, timeout_action
  from support.join_verifications
`;

const CHANNEL_POST_DETAILS_COLUMNS = `
  id, status, content_type, content, parse_mode, scheduled_at, attempts, max_attempts,
  channel_message_id, channel_message_ids, last_error, is_pinned, deleted_at, version,
  created_by_telegram_id, created_at, updated_at
`;

const CHANNEL_OPERATION_COLUMNS = `
  operation.id, operation.channel_post_id, operation.action, operation.payload,
  operation.channel_message_ids, operation.attempts, operation.max_attempts
`;

const GROUP_OPERATION_COLUMNS = `
  operation.id, operation.action, operation.telegram_chat_ref, operation.telegram_user_id,
  operation.until_at, operation.reason, operation.attempts, operation.max_attempts
`;

function ruleMatches(matchType: AutoReplyRuleRecord["matchType"], keyword: string, normalizedText: string): boolean {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedKeyword) return false;
  if (matchType === "exact") return normalizedText === normalizedKeyword;
  if (matchType === "prefix") return normalizedText.startsWith(normalizedKeyword);
  if (matchType === "contains") return normalizedText.includes(normalizedKeyword);
  try {
    return new RegExp(keyword, "iu").test(normalizedText);
  } catch {
    return false;
  }
}
