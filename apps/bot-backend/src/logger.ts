const REDACTED_KEYS = /token|secret|password|authorization|jwt|service.?role|headers?|payload|init.?data|request.?body|text.?content/i;

export interface AppLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    REDACTED_KEYS.test(key) ? "[REDACTED]" : sanitize(entry)
  ]));
}

function redactString(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

export function createLogger(level = "info"): AppLogger {
  const priorities = new Map([["debug", 10], ["info", 20], ["warn", 30], ["error", 40]]);
  const threshold = priorities.get(level) ?? 20;
  const write = (entryLevel: string, fields: Record<string, unknown>, message: string): void => {
    if ((priorities.get(entryLevel) ?? 20) < threshold) return;
    const entry = {level: entryLevel, time: new Date().toISOString(), message, fields: sanitize(fields)};
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  };
  return {
    debug: (fields, message) => write("debug", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message)
  };
}

export const silentLogger: AppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
