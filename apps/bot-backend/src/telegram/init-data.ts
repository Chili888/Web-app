import {createHmac, timingSafeEqual} from "node:crypto";

export interface MiniAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: MiniAppUser;
  authDate: Date;
  queryId: string | null;
  hash: string;
}

export class InitDataValidationError extends Error {
  constructor(readonly code: "missing" | "invalid_hash" | "invalid_auth_date" | "expired" | "invalid_user") {
    super(`Telegram initData validation failed: ${code}`);
    this.name = "InitDataValidationError";
  }
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: {now?: Date; maxAgeSeconds?: number; futureSkewSeconds?: number} = {}
): ValidatedInitData {
  if (!initData || !botToken) throw new InitDataValidationError("missing");
  const parameters = new URLSearchParams(initData);
  const hash = parameters.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new InitDataValidationError("invalid_hash");

  const values = [...parameters.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(values).digest();
  const supplied = Buffer.from(hash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new InitDataValidationError("invalid_hash");
  }

  const authDateSeconds = Number(parameters.get("auth_date"));
  if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds <= 0) {
    throw new InitDataValidationError("invalid_auth_date");
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 900;
  const futureSkewSeconds = options.futureSkewSeconds ?? 30;
  if (authDateSeconds < nowSeconds - maxAgeSeconds || authDateSeconds > nowSeconds + futureSkewSeconds) {
    throw new InitDataValidationError("expired");
  }

  let user: MiniAppUser;
  try {
    user = JSON.parse(parameters.get("user") ?? "null") as MiniAppUser;
  } catch {
    throw new InitDataValidationError("invalid_user");
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") {
    throw new InitDataValidationError("invalid_user");
  }
  return {
    user,
    authDate: new Date(authDateSeconds * 1000),
    queryId: parameters.get("query_id"),
    hash: hash.toLowerCase()
  };
}
