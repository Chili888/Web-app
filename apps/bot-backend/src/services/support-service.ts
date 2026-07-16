import type {
  BotSettingsRecord,
  ChannelOperationRecord,
  ChannelPostRecord,
  GroupOperationRecord,
  JoinVerificationRecord,
  MessageType,
  StoredUpdate,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramUser
} from "../domain.js";
import {detectMessageType, messageFileId, telegramDisplayName} from "../domain.js";
import type {AppConfig} from "../config.js";
import type {AppLogger} from "../logger.js";
import type {SupportStore} from "../store/store.js";
import type {InlineKeyboardButton, TelegramAdapter} from "../telegram/adapter.js";
import {TelegramApiError} from "../telegram/adapter.js";
import type {OutboxExecutor} from "./outbox-executor.js";
import {OutboxDeferredError, safeErrorMessage} from "./outbox-executor.js";

export interface SupportServiceOptions {
  workerId: string;
  now?: () => Date;
}

const MUTED_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false
};

const MEMBER_PERMISSIONS = Object.fromEntries(
  Object.keys(MUTED_PERMISSIONS).map((permission) => [permission, true])
);

export class SupportService {
  private readonly now: () => Date;
  private lastBotSettings: BotSettingsRecord | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly store: SupportStore,
    private readonly telegram: TelegramAdapter,
    private readonly outbox: OutboxExecutor,
    private readonly logger: AppLogger,
    private readonly options: SupportServiceOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async processNext(): Promise<boolean> {
    const stored = await this.store.claimNextUpdate(this.options.workerId, this.now());
    if (!stored) return false;
    try {
      const result = await this.routeUpdate(stored);
      await this.store.completeUpdate(stored.updateId, result.handled ? "completed" : "ignored", result.messageType);
    } catch (error) {
      await this.deferUpdate(stored, error);
    }
    return true;
  }

  async processMaintenance(): Promise<boolean> {
    if (this.config.joinVerifyEnabled) {
      const verification = await this.store.claimExpiredJoinVerification(this.options.workerId, this.now());
      if (verification) {
        await this.applyVerificationTimeout(verification);
        return true;
      }
    }
    const channelPost = await this.store.claimDueChannelPost(this.options.workerId, this.now());
    if (channelPost) {
      await this.publishChannelPost(channelPost);
      return true;
    }
    const channelOperation = await this.store.claimDueChannelOperation(this.options.workerId, this.now());
    if (channelOperation) {
      await this.executeChannelOperation(channelOperation);
      return true;
    }
    const groupOperation = await this.store.claimDueGroupOperation(this.options.workerId, this.now());
    if (!groupOperation) return false;
    await this.executeGroupOperation(groupOperation);
    return true;
  }

  private async publishChannelPost(post: ChannelPostRecord): Promise<void> {
    try {
      const messageIds = await this.sendChannelPost(post);
      const firstMessageId = messageIds[0];
      if (!firstMessageId) throw new Error("Channel post did not return a message ID");
      if (post.content.pin) {
        await this.outbox.execute(
          `channel-post:${post.id}:pin`,
          "pin_channel_post",
          {postId: post.id, messageId: firstMessageId},
          () => this.telegram.pinChatMessage(this.config.telegramMainChannel, firstMessageId)
        );
      }
      await this.store.completeChannelPost(post.id, messageIds, this.now());
      await this.store.writeAudit({
        actorType: "system",
        actorTelegramId: null,
        action: "channel_post_published",
        entityType: "channel_post",
        entityId: post.id,
        metadata: {contentType: post.contentType, messageCount: messageIds.length}
      });
    } catch (error) {
      const terminal = error instanceof OutboxDeferredError
        ? error.terminal
        : post.attempts >= post.maxAttempts;
      const nextAttemptAt = error instanceof OutboxDeferredError
        ? error.nextAttemptAt
        : new Date(this.now().getTime() + retryDelay(post.attempts, this.config.workerRetryBaseMs));
      await this.store.retryChannelPost(post.id, safeErrorMessage(error), nextAttemptAt, terminal);
      this.logger.error(
        {channelPostId: post.id, attempts: post.attempts, terminal},
        "Channel publication failed"
      );
    }
  }

  private async executeChannelOperation(operation: ChannelOperationRecord): Promise<void> {
    try {
      await this.performChannelOperation(operation);
      await this.store.completeChannelOperation(operation, this.now());
      await this.store.writeAudit({
        actorType: "system",
        actorTelegramId: null,
        action: `channel_post_${operation.action}_completed`,
        entityType: "channel_post",
        entityId: operation.channelPostId,
        metadata: {operationId: operation.id, messageCount: operation.channelMessageIds.length}
      });
    } catch (error) {
      const terminal = error instanceof OutboxDeferredError
        ? error.terminal
        : operation.attempts >= operation.maxAttempts;
      const nextAttemptAt = error instanceof OutboxDeferredError
        ? error.nextAttemptAt
        : new Date(this.now().getTime() + retryDelay(operation.attempts, this.config.workerRetryBaseMs));
      await this.store.retryChannelOperation(operation.id, safeErrorMessage(error), nextAttemptAt, terminal);
      this.logger.error(
        {channelOperationId: operation.id, action: operation.action, attempts: operation.attempts, terminal},
        "Channel operation failed"
      );
    }
  }

  private async performChannelOperation(operation: ChannelOperationRecord): Promise<void> {
    const firstMessageId = operation.channelMessageIds[0];
    if (!firstMessageId) throw new Error("Channel operation has no Telegram message ID");
    const key = `channel-operation:${operation.id}`;
    if (operation.action === "edit_text") {
      const text = operation.payload.text?.trim();
      if (!text) throw new Error("Channel text edit is empty");
      await this.outbox.execute(key, "edit_channel_text", {operationId: operation.id}, () =>
        this.telegram.editMessageText({
          chatId: this.config.telegramMainChannel,
          messageId: firstMessageId,
          text,
          ...(operation.payload.parseMode ? {parseMode: operation.payload.parseMode} : {})
        })
      );
      return;
    }
    if (operation.action === "edit_caption") {
      await this.outbox.execute(key, "edit_channel_caption", {operationId: operation.id}, () =>
        this.telegram.editMessageCaption({
          chatId: this.config.telegramMainChannel,
          messageId: firstMessageId,
          caption: operation.payload.caption ?? "",
          ...(operation.payload.parseMode ? {parseMode: operation.payload.parseMode} : {})
        })
      );
      return;
    }
    if (operation.action === "delete") {
      for (const messageId of operation.channelMessageIds) {
        await this.outbox.execute(
          `${key}:delete:${messageId}`,
          "delete_channel_message",
          {operationId: operation.id, messageId},
          () => this.telegram.deleteMessage(this.config.telegramMainChannel, messageId)
        );
      }
      return;
    }
    if (operation.action === "pin") {
      await this.outbox.execute(key, "pin_channel_message", {operationId: operation.id}, () =>
        this.telegram.pinChatMessage(this.config.telegramMainChannel, firstMessageId)
      );
      return;
    }
    await this.outbox.execute(key, "unpin_channel_message", {operationId: operation.id}, () =>
      this.telegram.unpinChatMessage(this.config.telegramMainChannel, firstMessageId)
    );
  }

  private async executeGroupOperation(operation: GroupOperationRecord): Promise<void> {
    try {
      await this.performGroupOperation(operation);
      await this.store.completeGroupOperation(operation.id, this.now());
      await this.store.writeAudit({
        actorType: "system",
        actorTelegramId: null,
        action: `group_${operation.action}_completed`,
        entityType: "telegram_group_member",
        entityId: `${operation.telegramChatId}:${operation.telegramUserId}`,
        metadata: {operationId: operation.id, reason: operation.reason.slice(0, 120)}
      });
    } catch (error) {
      const terminal = error instanceof OutboxDeferredError
        ? error.terminal
        : operation.attempts >= operation.maxAttempts;
      const nextAttemptAt = error instanceof OutboxDeferredError
        ? error.nextAttemptAt
        : new Date(this.now().getTime() + retryDelay(operation.attempts, this.config.workerRetryBaseMs));
      await this.store.retryGroupOperation(operation.id, safeErrorMessage(error), nextAttemptAt, terminal);
      this.logger.error(
        {groupOperationId: operation.id, action: operation.action, attempts: operation.attempts, terminal},
        "Group operation failed"
      );
    }
  }

  private async performGroupOperation(operation: GroupOperationRecord): Promise<void> {
    const key = `group-operation:${operation.id}`;
    if (operation.action === "mute" || operation.action === "unmute") {
      await this.outbox.execute(key, `${operation.action}_group_member`, {operationId: operation.id}, () =>
        this.telegram.restrictChatMember({
          chatId: operation.telegramChatId,
          userId: operation.telegramUserId,
          permissions: operation.action === "mute" ? MUTED_PERMISSIONS : MEMBER_PERMISSIONS,
          ...(operation.action === "mute" && operation.untilAt
            ? {untilDate: Math.floor(operation.untilAt.getTime() / 1000)}
            : {})
        })
      );
      return;
    }
    if (operation.action === "ban") {
      await this.outbox.execute(key, "ban_group_member", {operationId: operation.id}, () =>
        this.telegram.banChatMember(operation.telegramChatId, operation.telegramUserId)
      );
      return;
    }
    if (operation.action === "unban") {
      await this.outbox.execute(key, "unban_group_member", {operationId: operation.id}, () =>
        this.telegram.unbanChatMember(operation.telegramChatId, operation.telegramUserId)
      );
      return;
    }
    await this.outbox.execute(`${key}:ban`, "kick_group_member", {operationId: operation.id}, () =>
      this.telegram.banChatMember(operation.telegramChatId, operation.telegramUserId)
    );
    await this.outbox.execute(`${key}:unban`, "allow_group_rejoin", {operationId: operation.id}, () =>
      this.telegram.unbanChatMember(operation.telegramChatId, operation.telegramUserId)
    );
  }

  private async sendChannelPost(post: ChannelPostRecord): Promise<number[]> {
    const keyboard = post.content.buttons?.length
      ? {inline_keyboard: post.content.buttons}
      : undefined;
    if (post.contentType === "text") {
      if (!post.content.text?.trim()) throw new Error("Channel text post is empty");
      const sent = await this.outbox.execute(
        `channel-post:${post.id}:publish`,
        "publish_channel_text",
        {postId: post.id, contentType: post.contentType},
        () => this.telegram.sendMessage({
          chatId: this.config.telegramMainChannel,
          text: post.content.text as string,
          ...(post.parseMode ? {parseMode: post.parseMode} : {}),
          ...(keyboard ? {replyMarkup: keyboard} : {})
        })
      );
      return [sent.message_id];
    }

    const media = post.content.media ?? [];
    if (post.contentType === "media_group") {
      if (media.length < 2 || media.length > 10) throw new Error("Channel media group must contain 2 to 10 items");
      const sent = await this.outbox.execute(
        `channel-post:${post.id}:publish`,
        "publish_channel_media_group",
        {postId: post.id, contentType: post.contentType, itemCount: media.length},
        () => this.telegram.sendMediaGroup({
          chatId: this.config.telegramMainChannel,
          media,
          ...(post.parseMode ? {parseMode: post.parseMode} : {})
        })
      );
      return sent.map((message) => message.message_id);
    }

    const item = media[0];
    if (!item || media.length !== 1 || item.type !== post.contentType) {
      throw new Error("Channel media post content does not match content_type");
    }
    const sent = await this.outbox.execute(
      `channel-post:${post.id}:publish`,
      "publish_channel_media",
      {postId: post.id, contentType: post.contentType},
      () => this.telegram.sendMedia({
        chatId: this.config.telegramMainChannel,
        ...item,
        ...(post.parseMode ? {parseMode: post.parseMode} : {}),
        ...(keyboard ? {replyMarkup: keyboard} : {})
      })
    );
    return [sent.message_id];
  }

  private async routeUpdate(stored: StoredUpdate): Promise<{handled: boolean; messageType: MessageType}> {
    const update = stored.payload;
    if (update.callback_query) {
      return {handled: await this.handleCallback(update.callback_query), messageType: "system"};
    }
    const message = update.message;
    if (!message?.from) return {handled: false, messageType: "unknown"};

    if (message.chat.type === "private") {
      if (this.config.telegramAdminIds.has(message.from.id)) {
        return {handled: await this.handleAdminMessage(stored.updateId, message), messageType: detectMessageType(message)};
      }
      return {handled: await this.handleCustomerMessage(stored.updateId, message), messageType: detectMessageType(message)};
    }

    if (this.matchesDiscussionGroup(message.chat) && message.new_chat_members?.length) {
      await this.handleNewMembers(stored.updateId, message);
      return {handled: true, messageType: "system"};
    }
    if (this.matchesDiscussionGroup(message.chat)) {
      return {handled: await this.handleGroupModeration(stored.updateId, message), messageType: detectMessageType(message)};
    }
    return {handled: false, messageType: detectMessageType(message)};
  }

  private async handleGroupModeration(updateId: number, message: TelegramMessage): Promise<boolean> {
    const user = message.from;
    if (!user || user.is_bot || message.sender_chat || this.config.telegramAdminIds.has(user.id)) return false;
    if (await this.store.isUserWhitelisted(message.chat.id, user.id)) return false;
    const membership = await this.telegram.getChatMember(message.chat.id, user.id);
    if (isAdministrator(membership.status)) return false;

    const content = [message.text, message.caption].filter(Boolean).join("\n");
    if (!content) return false;
    const moderationSettings = await this.store.getGroupModerationSettings();
    if (!moderationSettings.enabled) return false;
    const rule = (await this.store.getModerationRules()).find((candidate) => moderationRuleMatches(candidate, content));
    if (!rule) return false;

    const since = new Date(this.now().getTime() - moderationSettings.violationWindowSeconds * 1000);
    const violationNumber = await this.store.countRecentModerationViolations(message.chat.id, user.id, since) + 1;
    const effectiveAction = rule.mode === "log" || rule.mode === "ban"
      ? rule.mode
      : violationNumber >= moderationSettings.banAfterViolations
        ? "ban"
        : rule.mode === "mute" || violationNumber >= moderationSettings.muteAfterViolations
          ? "mute"
          : "delete";
    const duration = Math.max(30, rule.actionDurationSeconds ?? moderationSettings.muteDurationSeconds);
    const mutedUntil = effectiveAction === "mute"
      ? new Date(this.now().getTime() + duration * 1000)
      : null;
    if (effectiveAction !== "log") {
      await this.outbox.execute(
        `moderation:${message.chat.id}:${message.message_id}:delete`,
        "delete_moderated_message",
        {updateId, chatId: message.chat.id, messageId: message.message_id, ruleId: rule.id},
        () => this.telegram.deleteMessage(message.chat.id, message.message_id)
      );
    }
    if (effectiveAction === "mute" && mutedUntil) {
      await this.outbox.execute(
        `moderation:${message.chat.id}:${message.message_id}:mute:${user.id}`,
        "mute_moderated_user",
        {updateId, chatId: message.chat.id, userId: user.id, ruleId: rule.id},
        () => this.telegram.restrictChatMember({
          chatId: message.chat.id,
          userId: user.id,
          permissions: MUTED_PERMISSIONS,
          untilDate: Math.floor(mutedUntil.getTime() / 1000)
        })
      );
    }
    if (effectiveAction === "ban") {
      await this.outbox.execute(
        `moderation:${message.chat.id}:${message.message_id}:ban:${user.id}`,
        "ban_moderated_user",
        {updateId, chatId: message.chat.id, userId: user.id, ruleId: rule.id},
        () => this.telegram.banChatMember(message.chat.id, user.id)
      );
    }
    if (effectiveAction === "delete" && violationNumber === 1 && moderationSettings.warningMessage.trim()) {
      await this.outbox.execute(
        `moderation:${message.chat.id}:${message.message_id}:warning:${user.id}`,
        "warn_moderated_user",
        {updateId, chatId: message.chat.id, userId: user.id, ruleId: rule.id},
        () => this.telegram.sendMessage({
          chatId: message.chat.id,
          text: `用户 ${user.id}：${moderationSettings.warningMessage.trim()}`
        })
      );
    }
    const recorded = await this.store.recordModerationAction({
      chatId: message.chat.id,
      userId: user.id,
      messageId: message.message_id,
      ruleId: rule.id,
      action: effectiveAction,
      reasonCode: rule.ruleType,
      mutedUntil
    });
    if (recorded) {
      await this.store.writeAudit({
        actorType: "system",
        actorTelegramId: user.id,
        action: `group_moderation_${effectiveAction}`,
        entityType: "moderation_action",
        entityId: `${message.chat.id}:${message.message_id}:${rule.id}`,
        metadata: {updateId, ruleId: rule.id, reasonCode: rule.ruleType, violationNumber}
      });
    }
    return true;
  }

  private async handleCustomerMessage(updateId: number, message: TelegramMessage): Promise<boolean> {
    const user = message.from as TelegramUser;
    const messageType = detectMessageType(message);
    const receivedAt = new Date(message.date * 1000);
    const resolution = await this.store.recordCustomerMessage({
      updateId,
      user,
      chatId: message.chat.id,
      messageId: message.message_id,
      messageType,
      mediaGroupId: message.media_group_id ?? null,
      telegramFileId: messageFileId(message),
      receivedAt
    });

    if (resolution.customer.isBlocked) {
      await this.store.markCustomerBlocked(resolution.customer.id, false);
    }
    const settings = await this.getBotSettingsSafe();
    await this.sendCustomerAutomation(updateId, message, settings);
    const command = parseCommand(message.text, this.config.telegramBotUsername);
    if (command === "start") {
      for (const adminId of this.config.telegramAdminIds) {
        const notice = await this.outbox.execute(
          `update:${updateId}:admin:${adminId}:customer-start`,
          "send_customer_start_notice",
          {updateId, adminId, customerId: resolution.customer.id},
          () => this.telegram.sendMessage({
            chatId: adminId,
            text: customerStartSummary(user, message, this.config.appTimezone)
          })
        );
        await this.store.createAdminRoute({
          adminTelegramId: adminId,
          adminChatId: adminId,
          adminMessageId: notice.message_id,
          customerId: resolution.customer.id,
          customerChatId: resolution.customer.telegramChatId,
          customerMessageId: message.message_id,
          sourceMessageType: messageType,
          routeType: "customer_start"
        });
      }
      await this.store.writeAudit({
        actorType: "telegram_user",
        actorTelegramId: user.id,
        action: "customer_started_bot",
        entityType: "telegram_customer",
        entityId: resolution.customer.id,
        metadata: {updateId}
      });
      return true;
    }
    if (messageType === "unknown" || messageType === "system") {
      await this.sendCustomerText(
        updateId,
        "unsupported-message",
        message.chat.id,
        "已收到这条消息，但当前暂不支持完整处理该类型。客服已收到提示，请改用文字、图片、视频、语音或文件补充说明。",
        settings,
        false
      );
    }
    const summaryScope = message.media_group_id
      ? `media-group:${resolution.customer.id}:${message.media_group_id}`
      : `update:${updateId}`;

    for (const adminId of this.config.telegramAdminIds) {
      if (resolution.shouldSendSummary) {
        const summary = await this.outbox.execute(
          `${summaryScope}:admin:${adminId}:summary`,
          "send_customer_summary",
          {updateId, adminId, customerId: resolution.customer.id, messageType},
          () => this.telegram.sendMessage({chatId: adminId, text: customerSummary(user, message, messageType, this.config.appTimezone)})
        );
        await this.store.createAdminRoute({
          adminTelegramId: adminId,
          adminChatId: adminId,
          adminMessageId: summary.message_id,
          customerId: resolution.customer.id,
          customerChatId: resolution.customer.telegramChatId,
          customerMessageId: message.message_id,
          sourceMessageType: messageType,
          routeType: "customer_summary"
        });
      }

      const forwarded = messageType === "unknown" || messageType === "system"
        ? await this.outbox.execute(
          `update:${updateId}:admin:${adminId}:unsupported`,
          "send_unsupported_message_notice",
          {updateId, adminId, customerId: resolution.customer.id, messageType},
          () => this.telegram.sendMessage({
            chatId: adminId,
            text: `收到一种暂不支持的消息类型\n类型：${messageType}\nUpdate ID：${updateId}`
          })
        )
        : await this.outbox.execute(
          `update:${updateId}:admin:${adminId}:copy`,
          "copy_customer_message",
          {updateId, adminId, customerId: resolution.customer.id, messageType},
          () => this.telegram.copyMessage({
            chatId: adminId,
            fromChatId: message.chat.id,
            messageId: message.message_id
          })
        );

      await this.store.createAdminRoute({
        adminTelegramId: adminId,
        adminChatId: adminId,
        adminMessageId: forwarded.message_id,
        customerId: resolution.customer.id,
        customerChatId: resolution.customer.telegramChatId,
        customerMessageId: message.message_id,
        sourceMessageType: messageType,
        routeType: isMediaMessageType(messageType) ? "customer_media" : "customer_content"
      });
    }

    if (resolution.shouldSendSummary && message.media_group_id) {
      await this.store.markMediaGroupSummarySent(resolution.customer.id, message.media_group_id, this.now());
    }

    await this.store.writeAudit({
      actorType: "telegram_user",
      actorTelegramId: user.id,
      action: "customer_message_routed",
      entityType: "telegram_customer",
      entityId: resolution.customer.id,
      metadata: {updateId, messageType, mediaGroup: Boolean(message.media_group_id)}
    });
    return true;
  }

  private async sendCustomerAutomation(
    updateId: number,
    message: TelegramMessage,
    settings: BotSettingsRecord
  ): Promise<void> {
    const command = parseCommand(message.text, this.config.telegramBotUsername);
    if (command === "start") {
      const customerName = message.from?.first_name?.trim() || "朋友";
      const welcome = settings.welcomeMessage
        .replaceAll("{客户名称}", customerName)
        .replaceAll("{customer_name}", customerName);
      await this.sendCustomerText(updateId, "welcome", message.chat.id, welcome, settings);
    } else if (command === "help") {
      await this.sendCustomerText(updateId, "help", message.chat.id, settings.helpMessage, settings);
    }

    if (command === "start" || !this.config.autoReplyEnabled || !settings.automaticReplyEnabled || !message.text) return;
    const rules = await this.store.findAutoReplies(message.text);
    for (const rule of rules.slice(0, 3)) {
      await this.sendCustomerText(updateId, `auto-reply:${rule.id}`, message.chat.id, rule.responseContent, settings, false);
    }
  }

  private async sendCustomerText(
    updateId: number,
    suffix: string,
    chatId: number,
    text: string,
    settings: BotSettingsRecord,
    buttons = true
  ): Promise<void> {
    if (!text.trim()) return;
    const keyboard = buttons ? customerButtons(settings) : [];
    await this.outbox.execute(
      `update:${updateId}:customer:${suffix}`,
      "send_customer_automatic_reply",
      {updateId, suffix, chatId},
      () => this.telegram.sendMessage({
        chatId,
        text,
        ...(keyboard.length ? {replyMarkup: {inline_keyboard: keyboard}} : {})
      })
    );
  }

  private async getBotSettingsSafe(): Promise<BotSettingsRecord> {
    try {
      const settings = await this.store.getBotSettings();
      this.lastBotSettings = settings;
      return settings;
    } catch (error) {
      this.logger.warn(
        {postgresErrorCode: postgresErrorCode(error)},
        "Bot settings unavailable; using last known or safe defaults"
      );
      return this.lastBotSettings ?? defaultBotSettings(this.config);
    }
  }

  private async handleAdminMessage(updateId: number, message: TelegramMessage): Promise<boolean> {
    const admin = message.from as TelegramUser;
    const command = parseCommand(message.text, this.config.telegramBotUsername);
    if (command && ["start", "help", "customers", "stats", "broadcast_preview", "settings"].includes(command)) {
      await this.handleAdminCommand(updateId, message, command);
      return true;
    }

    const repliedMessageId = message.reply_to_message?.message_id;
    if (!repliedMessageId) {
      await this.sendAdminNotice(updateId, admin.id, "missing-route", "请回复一条客户消息，以便确认回复对象。");
      return true;
    }
    const route = await this.store.findAdminRoute(admin.id, message.chat.id, repliedMessageId, this.now());
    if (!route) {
      await this.sendAdminNotice(updateId, admin.id, "unknown-route", "未找到该消息对应的客户路由，请回复机器人最近转来的客户消息。");
      return true;
    }

    const messageType = detectMessageType(message);
    if (messageType === "unknown" || messageType === "system") {
      await this.sendAdminNotice(updateId, admin.id, "unsupported-reply", `暂不支持发送此消息类型：${messageType}`);
      return true;
    }

    try {
      const copied = await this.outbox.execute(
        `update:${updateId}:customer:${route.customerId}:copy`,
        "copy_admin_reply",
        {updateId, adminId: admin.id, customerId: route.customerId, messageType},
        () => this.telegram.copyMessage({
          chatId: route.customerChatId,
          fromChatId: message.chat.id,
          messageId: message.message_id
        })
      );
      await this.store.recordAdminReply({
        updateId,
        customerId: route.customerId,
        adminMessageId: message.message_id,
        messageType,
        telegramFileId: messageFileId(message),
        receivedAt: new Date(message.date * 1000),
        targetMessageId: copied.message_id
      });
      await this.store.writeAudit({
        actorType: "support_agent",
        actorTelegramId: admin.id,
        action: "admin_reply_sent",
        entityType: "telegram_customer",
        entityId: route.customerId,
        metadata: {updateId, messageType}
      });
    } catch (error) {
      if (!(error instanceof OutboxDeferredError) || !error.terminal) throw error;
      const reason = customerDeliveryFailure(error.message);
      if (reason.blocked) await this.store.markCustomerBlocked(route.customerId, true);
      await this.sendAdminNotice(updateId, admin.id, "delivery-failed", `回复发送失败：${reason.text}`);
      await this.store.writeAudit({
        actorType: "support_agent",
        actorTelegramId: admin.id,
        action: "admin_reply_failed",
        entityType: "telegram_customer",
        entityId: route.customerId,
        metadata: {updateId, messageType, reason: reason.code}
      });
    }
    return true;
  }

  private async handleAdminCommand(updateId: number, message: TelegramMessage, command: string): Promise<void> {
    let text: string;
    if (command === "stats" || command === "customers") {
      const stats = await this.store.getSupportStats(this.now());
      text = [
        `客户总数：${stats.customers}`,
        `今日消息：${stats.messagesToday}`,
        `待处理更新：${stats.pendingUpdates}`,
        `死信：${stats.deadLetters}`
      ].join("\n");
    } else if (command === "settings") {
      text = "机器人设置请在管理后台修改。敏感配置不会在 Telegram 中显示。";
    } else if (command === "broadcast_preview") {
      text = "群发功能未启用。第一阶段不允许主动批量私聊。";
    } else {
      text = [
        "管理员使用说明",
        "请直接回复机器人转来的客户资料或消息。",
        "/customers - 客户统计",
        "/stats - 队列统计",
        "/settings - 设置入口",
        "/broadcast_preview - 群发状态"
      ].join("\n");
    }
    await this.sendAdminNotice(updateId, message.chat.id, `command:${command}`, text);
  }

  private async sendAdminNotice(updateId: number, adminId: number, suffix: string, text: string): Promise<void> {
    await this.outbox.execute(
      `update:${updateId}:admin:${adminId}:${suffix}`,
      "send_admin_notice",
      {updateId, adminId, suffix},
      () => this.telegram.sendMessage({chatId: adminId, text})
    );
  }

  private async handleNewMembers(updateId: number, message: TelegramMessage): Promise<void> {
    if (!this.config.joinVerifyEnabled) return;
    const settings = await this.getBotSettingsSafe();
    if (!settings.joinVerifyEnabled) return;
    for (const user of message.new_chat_members ?? []) {
      if (user.is_bot || this.config.telegramAdminIds.has(user.id)) continue;
      if (await this.store.isUserWhitelisted(message.chat.id, user.id)) {
        await this.auditJoinBypass(updateId, message.chat.id, user.id, "whitelist");
        continue;
      }
      const groupMembership = await this.telegram.getChatMember(message.chat.id, user.id);
      if (isAdministrator(groupMembership.status)) {
        await this.auditJoinBypass(updateId, message.chat.id, user.id, "group_administrator");
        continue;
      }
      const channelMembership = await this.telegram.getChatMember(this.config.telegramMainChannel, user.id);
      if (isAdministrator(channelMembership.status)) {
        await this.auditJoinBypass(updateId, message.chat.id, user.id, "channel_administrator");
        continue;
      }

      const joinedAt = new Date(message.date * 1000);
      const expiresAt = new Date(joinedAt.getTime() + settings.joinVerifyTimeoutSeconds * 1000);
      const {record, created} = await this.store.createJoinVerification({
        updateId,
        telegramUserId: user.id,
        telegramChatId: message.chat.id,
        joinedAt,
        expiresAt,
        timeoutAction: settings.joinVerifyTimeoutAction
      });
      if (!created) continue;

      await this.outbox.execute(
        `join:${record.id}:restrict`,
        "restrict_new_member",
        {verificationId: record.id, chatId: message.chat.id, userId: user.id},
        () => this.telegram.restrictChatMember({
          chatId: message.chat.id,
          userId: user.id,
          permissions: MUTED_PERMISSIONS
        })
      );
      const prompt = await this.outbox.execute(
        `join:${record.id}:prompt`,
        "send_join_verification",
        {verificationId: record.id, chatId: message.chat.id, userId: user.id},
        () => this.telegram.sendMessage({
          chatId: message.chat.id,
          text: `${telegramDisplayName(user)}，${settings.joinVerifyPrompt}`,
          replyMarkup: {inline_keyboard: [
            [{text: "📢 加入主频道", url: channelUrl(this.config.telegramMainChannel)}],
            [{text: "✅ 我已加入，立即验证", callback_data: `verify_join:${user.id}`}]
          ]}
        })
      );
      await this.store.setJoinVerificationMessage(record.id, prompt.message_id);
      await this.store.writeAudit({
        actorType: "system",
        actorTelegramId: user.id,
        action: "join_verification_started",
        entityType: "join_verification",
        entityId: record.id,
        metadata: {updateId, chatId: message.chat.id, expiresAt: expiresAt.toISOString()}
      });
    }
  }

  private async handleCallback(callback: TelegramCallbackQuery): Promise<boolean> {
    try {
      await this.telegram.answerCallbackQuery(callback.id, "");
    } catch {
      this.logger.warn(
        {callbackType: callback.data?.split(":", 1)[0] ?? "unknown"},
        "Telegram callback acknowledgement failed"
      );
    }
    if (isCustomerMenuCallback(callback.data)) {
      return this.handleCustomerMenuCallback(callback);
    }
    const match = /^verify_join:(\d+)$/.exec(callback.data ?? "");
    if (!match || !callback.message) return false;
    const expectedUserId = Number(match[1]);
    if (callback.from.id !== expectedUserId) {
      await this.sendCallbackFeedback(callback, "该验证按钮不属于你。");
      return true;
    }
    const verification = await this.store.getPendingJoinVerification(callback.message.chat.id, callback.from.id);
    if (!verification) {
      await this.sendCallbackFeedback(callback, "该验证已处理或已过期。");
      return true;
    }

    let membershipStatus = "unavailable";
    try {
      const membership = await this.telegram.getChatMember(this.config.telegramMainChannel, callback.from.id);
      membershipStatus = membership.status;
    } catch (error) {
      if (error instanceof TelegramApiError && error.statusCode > 0 && error.statusCode < 500) {
        membershipStatus = "unavailable";
      } else {
        throw error;
      }
    }
    await this.store.recordJoinCheck(verification.id, membershipStatus);
    if (!isJoined(membershipStatus)) {
      await this.sendCallbackFeedback(callback, "尚未确认你已加入主频道，请加入后重试。");
      return true;
    }

    await this.outbox.execute(
      `join:${verification.id}:unrestrict`,
      "unrestrict_verified_member",
      {verificationId: verification.id, chatId: verification.telegramChatId, userId: verification.telegramUserId},
      () => this.telegram.restrictChatMember({
        chatId: verification.telegramChatId,
        userId: verification.telegramUserId,
        permissions: MEMBER_PERMISSIONS
      })
    );
    const changed = await this.store.completeJoinVerification(verification.id, "verified", this.now());
    if (changed) {
      const settings = await this.getBotSettingsSafe();
      if (verification.verificationMessageId) {
        await this.outbox.execute(
          `join:${verification.id}:success-message`,
          "edit_join_verification_success",
          {verificationId: verification.id},
          () => this.telegram.editMessageText({
            chatId: verification.telegramChatId,
            messageId: verification.verificationMessageId as number,
            text: settings.joinVerifyWelcomeMessage
              ? `${telegramDisplayName(callback.from)}，${settings.joinVerifyWelcomeMessage}`
              : `${telegramDisplayName(callback.from)} 已完成频道关注验证。`
          })
        );
      }
      await this.store.writeAudit({
        actorType: "telegram_user",
        actorTelegramId: callback.from.id,
        action: "join_verification_completed",
        entityType: "join_verification",
        entityId: verification.id,
        metadata: {chatId: verification.telegramChatId}
      });
    } else {
      await this.sendCallbackFeedback(callback, "验证已完成。");
    }
    return true;
  }

  private async handleCustomerMenuCallback(callback: TelegramCallbackQuery): Promise<boolean> {
    const settings = await this.getBotSettingsSafe();
    const text = callback.data === "menu_why_us"
      ? settings.whyUsMessage
      : callback.data === "menu_stock"
        ? settings.stockMessage
        : callback.data === "menu_trade_rules"
          ? settings.tradeRulesMessage
          : settings.contactMessage;
    if (!text.trim()) return true;
    await this.outbox.execute(
      `callback:${callback.id}:customer-menu`,
      "send_customer_menu_content",
      {callbackId: callback.id, customerId: callback.from.id, menu: callback.data},
      () => this.telegram.sendMessage({chatId: callback.from.id, text})
    );
    return true;
  }

  private async sendCallbackFeedback(callback: TelegramCallbackQuery, text: string): Promise<void> {
    await this.outbox.execute(
      `callback:${callback.id}:feedback`,
      "send_callback_feedback",
      {callbackId: callback.id, customerId: callback.from.id},
      () => this.telegram.sendMessage({chatId: callback.from.id, text})
    );
  }

  private async applyVerificationTimeout(verification: JoinVerificationRecord): Promise<void> {
    let status: JoinVerificationRecord["status"] = "expired";
    if (verification.timeoutAction === "kick") {
      await this.outbox.execute(
        `join:${verification.id}:timeout-ban`,
        "ban_unverified_member_for_kick",
        {verificationId: verification.id},
        () => this.telegram.banChatMember(verification.telegramChatId, verification.telegramUserId)
      );
      await this.outbox.execute(
        `join:${verification.id}:timeout-unban`,
        "unban_kicked_member",
        {verificationId: verification.id},
        () => this.telegram.unbanChatMember(verification.telegramChatId, verification.telegramUserId)
      );
      status = "kicked";
    } else if (verification.timeoutAction === "ban") {
      await this.outbox.execute(
        `join:${verification.id}:timeout-ban`,
        "ban_unverified_member",
        {verificationId: verification.id},
        () => this.telegram.banChatMember(verification.telegramChatId, verification.telegramUserId)
      );
      status = "banned";
    }
    const changed = await this.store.completeJoinVerification(verification.id, status, null);
    if (!changed) return;
    if (verification.verificationMessageId) {
      await this.outbox.execute(
        `join:${verification.id}:timeout-message`,
        "edit_join_verification_timeout",
        {verificationId: verification.id},
        () => this.telegram.editMessageText({
          chatId: verification.telegramChatId,
          messageId: verification.verificationMessageId as number,
          text: "频道关注验证已超时。"
        })
      );
    }
    await this.store.writeAudit({
      actorType: "system",
      actorTelegramId: verification.telegramUserId,
      action: "join_verification_timed_out",
      entityType: "join_verification",
      entityId: verification.id,
      metadata: {action: verification.timeoutAction, result: status}
    });
  }

  private async auditJoinBypass(updateId: number, chatId: number, userId: number, reason: string): Promise<void> {
    await this.store.writeAudit({
      actorType: "system",
      actorTelegramId: userId,
      action: "join_verification_bypassed",
      entityType: "telegram_user",
      entityId: String(userId),
      metadata: {updateId, chatId, reason}
    });
  }

  private matchesDiscussionGroup(chat: TelegramChat): boolean {
    const configured = this.config.telegramDiscussionGroup;
    if (typeof configured === "number") return chat.id === configured;
    return configured.toLowerCase() === `@${chat.username ?? ""}`.toLowerCase();
  }

  private async deferUpdate(stored: StoredUpdate, error: unknown): Promise<void> {
    const message = safeErrorMessage(error);
    const terminal = error instanceof OutboxDeferredError
      ? error.terminal
      : stored.attempts >= this.config.workerMaxAttempts;
    const nextAttemptAt = error instanceof OutboxDeferredError
      ? error.nextAttemptAt
      : new Date(this.now().getTime() + retryDelay(stored.attempts, this.config.workerRetryBaseMs));
    await this.store.retryUpdate(stored.updateId, message, nextAttemptAt, terminal);
    this.logger.error(
      {updateId: stored.updateId, attempts: stored.attempts, terminal, errorCode: postgresErrorCode(error)},
      "Telegram update processing failed"
    );
  }
}

function parseCommand(text: string | undefined, botUsername: string): string | null {
  if (!text?.startsWith("/")) return null;
  const token = text.trim().split(/\s+/, 1)[0]?.slice(1).toLowerCase();
  if (!token) return null;
  const [command, mention] = token.split("@", 2);
  if (mention && mention !== botUsername.toLowerCase()) return null;
  return command || null;
}

function customerSummary(
  user: TelegramUser,
  message: TelegramMessage,
  messageType: MessageType,
  timezone: string
): string {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(message.date * 1000));
  return [
    "客户消息",
    `姓名：${telegramDisplayName(user)}`,
    `用户名：${user.username ? `@${user.username}` : "未设置"}`,
    `用户 ID：${user.id}`,
    `时间：${time}`,
    `消息类型：${messageType}`
  ].join("\n");
}

function customerStartSummary(user: TelegramUser, message: TelegramMessage, timezone: string): string {
  return customerSummary(user, message, "command", timezone)
    .replace("客户消息", "新客户启动机器人")
    .replace("消息类型：command", "行为：/start");
}

function customerButtons(settings: BotSettingsRecord) {
  const buttons = settings.menuButtons
    .filter((button) => button.visible)
    .sort((left, right) => left.position - right.position)
    .flatMap<InlineKeyboardButton>((button) => {
      if (button.key === "mini_app") {
        return settings.miniAppUrl ? [{text: button.label, web_app: {url: settings.miniAppUrl}}] : [];
      }
      if (button.key === "channel") {
        return settings.channelUrl ? [{text: button.label, url: settings.channelUrl}] : [];
      }
      const callbackData = {
        why_us: "menu_why_us",
        stock: "menu_stock",
        trade_rules: "menu_trade_rules",
        contact: "menu_contact"
      }[button.key];
      return callbackData ? [{text: button.label, callback_data: callbackData}] : [];
    });
  const rows: InlineKeyboardButton[][] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

function isCustomerMenuCallback(data: string | undefined): boolean {
  return data === "menu_why_us"
    || data === "menu_stock"
    || data === "menu_trade_rules"
    || data === "menu_contact";
}

function isMediaMessageType(messageType: MessageType): boolean {
  return [
    "photo", "video", "voice", "audio", "document", "animation", "sticker",
    "video_note", "contact", "location", "venue", "poll", "dice"
  ].includes(messageType);
}

function defaultBotSettings(config: AppConfig): BotSettingsRecord {
  return {
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
    helpMessage: "请直接发送文字、图片、视频、语音或文件，管理员会尽快回复。",
    whyUsMessage: "💎 为什么选择我们？\n\n1️⃣ 真实卖家，长期稳定\n\n本地长期经营，商品信息真实，沟通直接，重视长期合作。\n\n2️⃣ 品质稳定，严格筛选\n\n商品均经过筛选，商品详情、规格、价格及展示状态以实际确认为准。\n\n3️⃣ 响应迅速，沟通方便\n\n商品介绍、购买说明和配送说明清晰，有问题可以直接联系客服。",
    stockMessage: "📋 现货咨询\n\n具体商品、规格、价格和库存会随时调整。\n\n您可以直接把以下信息发给我们：\n\n• 想了解的商品\n• 需要的数量\n• 大概位置\n• 希望的时间\n• 其他疑问\n\n客服看到后会尽快回复。",
    tradeRulesMessage: "🤝 交易必看\n\n购买、支付、配送、售后及注意事项请以客服最终确认为准。Mini App 仅用于商品展示，不在应用内完成支付。",
    contactMessage: "请直接把您的需求、数量、大概位置或疑问顾虑发在下面，我们会尽快回复您：",
    businessHours: "",
    offlineMessage: "",
    miniAppUrl: "https://chili888.github.io/Web-app/",
    channelUrl: channelUrl(config.telegramMainChannel),
    groupUrl: chatUrl(config.telegramDiscussionGroup, "https://t.me/TJ_ice_Group"),
    automaticReplyEnabled: true,
    joinVerifyEnabled: config.joinVerifyEnabled,
    joinVerifyPrompt: "请先关注主频道，然后点击验证按钮。",
    joinVerifyTimeoutSeconds: config.joinVerifyTimeoutSeconds,
    joinVerifyTimeoutAction: config.joinVerifyTimeoutAction,
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
}

function customerDeliveryFailure(message: string): {code: string; text: string; blocked: boolean} {
  const normalized = message.toLowerCase();
  if (normalized.includes("blocked") || normalized.includes("forbidden")) {
    return {code: "customer_blocked_bot", text: "客户已拉黑机器人或禁止机器人发送消息。", blocked: true};
  }
  if (normalized.includes("chat not found") || normalized.includes("user not found")) {
    return {code: "customer_unavailable", text: "客户账号或聊天当前不可用。", blocked: false};
  }
  if (normalized.includes("too many requests")) {
    return {code: "telegram_rate_limited", text: "Telegram限流，请稍后重试。", blocked: false};
  }
  return {code: "unsupported_or_rejected", text: "Telegram拒绝了该消息类型或目标状态无效。", blocked: false};
}

function isAdministrator(status: string): boolean {
  return status === "administrator" || status === "creator";
}

function isJoined(status: string): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}

function channelUrl(channel: number | string): string {
  if (typeof channel === "string" && channel.startsWith("@")) return `https://t.me/${channel.slice(1)}`;
  return "https://t.me/TJ_NO1_ice";
}

function chatUrl(chat: number | string, fallback: string): string {
  return typeof chat === "string" && chat.startsWith("@") ? `https://t.me/${chat.slice(1)}` : fallback;
}

function retryDelay(attempt: number, base: number): number {
  return Math.min(base * (2 ** Math.max(0, attempt - 1)), 5 * 60_000);
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as {code?: unknown}).code;
  return typeof code === "string" ? code.slice(0, 20) : undefined;
}

function moderationRuleMatches(
  rule: {ruleType: "keyword" | "link"; pattern: string | null},
  content: string
): boolean {
  if (rule.ruleType === "link") return /(?:https?:\/\/|t\.me\/|www\.)/iu.test(content);
  const keyword = rule.pattern?.trim().toLocaleLowerCase("zh-CN");
  return Boolean(keyword && content.toLocaleLowerCase("zh-CN").includes(keyword));
}
