import type {JoinTimeoutAction, TelegramChatRef} from "./domain.js";

export interface AppConfig {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramBotUsername: string;
  telegramAdminIds: Set<number>;
  telegramMainChannel: TelegramChatRef;
  telegramDiscussionGroup: TelegramChatRef;
  telegramInitDataMaxAgeSeconds: number;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  databaseUrl: string;
  appBaseUrl: string;
  storefrontOrigins: Set<string>;
  appTimezone: string;
  joinVerifyEnabled: boolean;
  joinVerifyTimeoutSeconds: number;
  joinVerifyTimeoutAction: JoinTimeoutAction;
  autoReplyEnabled: boolean;
  logLevel: string;
  port: number;
  workerPollIntervalMs: number;
  workerMaxAttempts: number;
  workerRetryBaseMs: number;
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, value: string | undefined, fallback?: number): number {
  const candidate = value?.trim() || (fallback === undefined ? "" : String(fallback));
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = integer(name, value, fallback);
  if (parsed <= 0) throw new Error(`${name} must be greater than zero`);
  return parsed;
}

function booleanValue(name: string, value: string | undefined, fallback: boolean): boolean {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return fallback;
  if (candidate === "true") return true;
  if (candidate === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function chatRef(name: string, value: string): TelegramChatRef {
  const normalized = value.trim();
  if (normalized.startsWith("@")) return normalized;
  return integer(name, normalized);
}

function integerSet(name: string, value: string): Set<number> {
  return new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => integer(name, entry)));
}

function optionalOrigin(name: string, value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== candidate.replace(/\/$/, "")) throw new Error();
    return url.origin;
  } catch {
    throw new Error(`${name} must be an HTTP(S) origin without a path`);
  }
}

function originSet(env: NodeJS.ProcessEnv): Set<string> {
  const source = env.STOREFRONT_ORIGINS?.trim() || env.STOREFRONT_ORIGIN?.trim() || "";
  return new Set(source.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const origin = optionalOrigin("STOREFRONT_ORIGINS", entry);
    if (!origin) throw new Error("STOREFRONT_ORIGINS contains an empty origin");
    return origin;
  }));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const adminSource = env.TELEGRAM_ADMIN_IDS?.trim() || env.TELEGRAM_AGENT_ALLOWLIST?.trim() || "";
  if (!adminSource) throw new Error("TELEGRAM_ADMIN_IDS is required");
  const timeoutAction = env.JOIN_VERIFY_TIMEOUT_ACTION?.trim() || "kick";
  if (!["kick", "ban", "mute", "none"].includes(timeoutAction)) {
    throw new Error("JOIN_VERIFY_TIMEOUT_ACTION must be kick, ban, mute, or none");
  }
  const timezone = env.APP_TIMEZONE?.trim() || "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("zh-CN", {timeZone: timezone}).format();
  } catch {
    throw new Error("APP_TIMEZONE must be a valid IANA timezone");
  }

  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN", env),
    telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET", env),
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "TJ_ice_CS_bot",
    telegramAdminIds: integerSet("TELEGRAM_ADMIN_IDS", adminSource),
    telegramMainChannel: chatRef("TELEGRAM_MAIN_CHANNEL", required("TELEGRAM_MAIN_CHANNEL", env)),
    telegramDiscussionGroup: chatRef("TELEGRAM_DISCUSSION_GROUP", required("TELEGRAM_DISCUSSION_GROUP", env)),
    telegramInitDataMaxAgeSeconds: positiveInteger(
      "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS",
      env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      900
    ),
    supabaseUrl: optionalOrigin("SUPABASE_URL", env.SUPABASE_URL),
    supabaseAnonKey: env.SUPABASE_ANON_KEY?.trim() || null,
    databaseUrl: required("DATABASE_URL", env),
    appBaseUrl: env.APP_BASE_URL?.trim() || "http://localhost:3000",
    storefrontOrigins: originSet(env),
    appTimezone: timezone,
    joinVerifyEnabled: booleanValue("JOIN_VERIFY_ENABLED", env.JOIN_VERIFY_ENABLED, true),
    joinVerifyTimeoutSeconds: positiveInteger("JOIN_VERIFY_TIMEOUT_SECONDS", env.JOIN_VERIFY_TIMEOUT_SECONDS, 600),
    joinVerifyTimeoutAction: timeoutAction as JoinTimeoutAction,
    autoReplyEnabled: booleanValue("AUTO_REPLY_ENABLED", env.AUTO_REPLY_ENABLED, true),
    logLevel: env.LOG_LEVEL?.trim() || "info",
    port: positiveInteger("PORT", env.PORT, 3000),
    workerPollIntervalMs: positiveInteger("WORKER_POLL_INTERVAL_MS", env.WORKER_POLL_INTERVAL_MS, 500),
    workerMaxAttempts: positiveInteger("WORKER_MAX_ATTEMPTS", env.WORKER_MAX_ATTEMPTS, 8),
    workerRetryBaseMs: positiveInteger("WORKER_RETRY_BASE_MS", env.WORKER_RETRY_BASE_MS, 1000)
  };
}
