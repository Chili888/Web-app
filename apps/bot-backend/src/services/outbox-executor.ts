import type {AppLogger} from "../logger.js";
import type {SupportStore} from "../store/store.js";
import {TelegramApiError} from "../telegram/adapter.js";

export class OutboxDeferredError extends Error {
  constructor(
    message: string,
    readonly nextAttemptAt: Date,
    readonly terminal: boolean
  ) {
    super(message);
    this.name = "OutboxDeferredError";
  }
}

export interface OutboxExecutorOptions {
  maxAttempts: number;
  retryBaseMs: number;
  workerId: string;
  now?: () => Date;
  random?: () => number;
}

export class OutboxExecutor {
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly store: SupportStore,
    private readonly logger: AppLogger,
    private readonly options: OutboxExecutorOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async execute<T>(
    idempotencyKey: string,
    action: string,
    payload: unknown,
    operation: () => Promise<T>
  ): Promise<T> {
    const lease = await this.store.acquireOutbox({
      idempotencyKey,
      action,
      payload,
      maxAttempts: this.options.maxAttempts,
      workerId: this.options.workerId,
      now: this.now()
    });

    if (lease.record.status === "sent") return lease.record.response as T;
    if (lease.record.status === "dead_letter") {
      throw new OutboxDeferredError("Outbox action is dead-lettered", lease.record.nextAttemptAt, true);
    }
    if (!lease.execute) {
      throw new OutboxDeferredError("Outbox action is not due", lease.record.nextAttemptAt, false);
    }

    try {
      const response = await operation();
      await this.store.markOutboxSent(lease.record.id, response, this.now());
      return response;
    } catch (error) {
      const retry = classifyRetry(
        error,
        lease.record.attempts,
        lease.record.maxAttempts,
        this.options.retryBaseMs,
        this.now(),
        this.random
      );
      const message = safeErrorMessage(error);
      await this.store.markOutboxRetry(lease.record.id, message, retry.nextAttemptAt, retry.terminal);
      this.logger.warn(
        {action, outboxId: lease.record.id, attempts: lease.record.attempts, terminal: retry.terminal},
        "Telegram outbox action failed"
      );
      throw new OutboxDeferredError(message, retry.nextAttemptAt, retry.terminal);
    }
  }
}

export function classifyRetry(
  error: unknown,
  attempt: number,
  maxAttempts: number,
  retryBaseMs: number,
  now: Date,
  random: () => number = Math.random
): {nextAttemptAt: Date; terminal: boolean} {
  if (attempt >= maxAttempts) return {nextAttemptAt: now, terminal: true};
  if (error instanceof TelegramApiError) {
    if (error.statusCode === 429 && error.retryAfterSeconds !== undefined) {
      return {nextAttemptAt: new Date(now.getTime() + error.retryAfterSeconds * 1000), terminal: false};
    }
    if (error.statusCode > 0 && error.statusCode < 500) {
      return {nextAttemptAt: now, terminal: true};
    }
  }

  const exponential = Math.min(retryBaseMs * (2 ** Math.max(0, attempt - 1)), 5 * 60_000);
  const jitter = Math.floor(random() * Math.max(1, retryBaseMs));
  return {nextAttemptAt: new Date(now.getTime() + exponential + jitter), terminal: false};
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .slice(0, 1000);
}
