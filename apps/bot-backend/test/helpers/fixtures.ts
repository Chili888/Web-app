import type {AppConfig} from "../../src/config.js";
import type {TelegramMessage, TelegramUpdate, TelegramUser} from "../../src/domain.js";
import {silentLogger} from "../../src/logger.js";
import {OutboxExecutor} from "../../src/services/outbox-executor.js";
import {SupportService} from "../../src/services/support-service.js";
import {FakeTelegramAdapter} from "./fake-telegram.js";
import {InMemorySupportStore} from "./in-memory-store.js";

export const FIXED_NOW = new Date("2026-07-15T12:30:00.000Z");
export const ADMIN_ID = 7141080131;
export const DISCUSSION_GROUP_ID = -100200300400;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "test-token",
    telegramWebhookSecret: "test-secret",
    telegramBotUsername: "TJ_ice_CS_bot",
    telegramAdminIds: new Set([ADMIN_ID]),
    telegramMainChannel: "@TJ_NO1_ice",
    telegramDiscussionGroup: DISCUSSION_GROUP_ID,
    telegramInitDataMaxAgeSeconds: 900,
    supabaseUrl: null,
    supabaseAnonKey: null,
    databaseUrl: "postgresql://test",
    appBaseUrl: "https://example.test",
    storefrontOrigins: new Set(["https://shop.example.test"]),
    appTimezone: "Asia/Shanghai",
    joinVerifyEnabled: true,
    joinVerifyTimeoutSeconds: 600,
    joinVerifyTimeoutAction: "kick",
    autoReplyEnabled: true,
    logLevel: "silent",
    port: 3000,
    workerPollIntervalMs: 10,
    workerMaxAttempts: 3,
    workerRetryBaseMs: 1000,
    ...overrides
  };
}

export function customerUser(id = 10001): TelegramUser {
  return {id, is_bot: false, first_name: "张", last_name: "三", username: `customer${id}`, language_code: "zh-hans"};
}

type MessageOverrides = Omit<Partial<TelegramMessage>, "text"> & {text?: string | undefined};

export function customerUpdate(updateId: number, messageId: number, message: MessageOverrides = {}): TelegramUpdate {
  const user = message.from ?? customerUser();
  const base: TelegramMessage = {
    message_id: messageId,
    from: user,
    chat: message.chat ?? {id: user.id, type: "private"},
    date: message.date ?? Math.floor(FIXED_NOW.getTime() / 1000)
  };
  if (!Object.hasOwn(message, "text")) base.text = "咨询商品";
  return {
    update_id: updateId,
    message: {...base, ...message} as TelegramMessage
  };
}

export function adminReplyUpdate(
  updateId: number,
  messageId: number,
  repliedMessageId?: number,
  message: MessageOverrides = {}
): TelegramUpdate {
  const {text, ...overrides} = message;
  const adminMessage: TelegramMessage = {
    message_id: messageId,
    from: {id: ADMIN_ID, is_bot: false, first_name: "管理员"},
    chat: {id: ADMIN_ID, type: "private"},
    date: Math.floor(FIXED_NOW.getTime() / 1000),
    ...(repliedMessageId === undefined ? {} : {
      reply_to_message: {message_id: repliedMessageId, chat: {id: ADMIN_ID, type: "private"}, date: 1}
    }),
    ...overrides
  };
  if (!Object.hasOwn(message, "text")) adminMessage.text = "管理员回复";
  else if (text !== undefined) adminMessage.text = text;
  return {
    update_id: updateId,
    message: adminMessage
  };
}

export function newMemberUpdate(updateId: number, user = customerUser()): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 1000,
      from: {id: ADMIN_ID, is_bot: false, first_name: "管理员"},
      chat: {id: DISCUSSION_GROUP_ID, type: "supergroup", title: "讨论群", username: "TJ_ice_Group"},
      date: Math.floor(FIXED_NOW.getTime() / 1000),
      new_chat_members: [user]
    }
  };
}

export function joinCallbackUpdate(updateId: number, user = customerUser()): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: user,
      data: `verify_join:${user.id}`,
      message: {
        message_id: updateId + 2000,
        chat: {id: DISCUSSION_GROUP_ID, type: "supergroup"},
        date: Math.floor(FIXED_NOW.getTime() / 1000)
      }
    }
  };
}

export function menuCallbackUpdate(
  updateId: number,
  data: "menu_why_us" | "menu_stock" | "menu_trade_rules" | "menu_contact",
  user = customerUser(),
  callbackId = `menu-callback-${updateId}`
): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: user,
      data,
      message: {
        message_id: updateId + 3000,
        chat: {id: user.id, type: "private"},
        date: Math.floor(FIXED_NOW.getTime() / 1000)
      }
    }
  };
}

export function createHarness(config = testConfig(), now = FIXED_NOW) {
  const store = new InMemorySupportStore();
  const telegram = new FakeTelegramAdapter();
  const outbox = new OutboxExecutor(store, silentLogger, {
    maxAttempts: config.workerMaxAttempts,
    retryBaseMs: config.workerRetryBaseMs,
    workerId: "test-worker",
    now: () => now,
    random: () => 0
  });
  const service = new SupportService(config, store, telegram, outbox, silentLogger, {
    workerId: "test-worker",
    now: () => now
  });
  return {config, store, telegram, outbox, service};
}

export async function persistAndProcess(harness: ReturnType<typeof createHarness>, update: TelegramUpdate): Promise<void> {
  await harness.store.persistUpdate(update);
  await harness.service.processNext();
}
