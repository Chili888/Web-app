import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {describe, it} from "node:test";
import {InitDataValidationError, validateTelegramInitData} from "../src/telegram/init-data.js";

const TOKEN = "123456:TEST_TOKEN_NOT_REAL";
const NOW = new Date("2026-07-15T12:30:00.000Z");

describe("Telegram Mini App initData", () => {
  it("accepts authentic and current initData", () => {
    const initData = signedInitData({auth_date: String(Math.floor(NOW.getTime() / 1000))});
    const result = validateTelegramInitData(initData, TOKEN, {now: NOW});
    assert.equal(result.user.id, 7141080131);
    assert.equal(result.queryId, "query-1");
  });

  it("rejects tampered initData", () => {
    const initData = signedInitData({auth_date: String(Math.floor(NOW.getTime() / 1000))})
      .replace("Admin", "Attacker");
    assert.throws(
      () => validateTelegramInitData(initData, TOKEN, {now: NOW}),
      (error: unknown) => error instanceof InitDataValidationError && error.code === "invalid_hash"
    );
  });

  it("rejects expired initData", () => {
    const authDate = Math.floor(NOW.getTime() / 1000) - 901;
    const initData = signedInitData({auth_date: String(authDate)});
    assert.throws(
      () => validateTelegramInitData(initData, TOKEN, {now: NOW, maxAgeSeconds: 900}),
      (error: unknown) => error instanceof InitDataValidationError && error.code === "expired"
    );
  });
});

function signedInitData(overrides: Record<string, string>): string {
  const parameters = new URLSearchParams({
    auth_date: "0",
    query_id: "query-1",
    user: JSON.stringify({id: 7141080131, first_name: "Admin", username: "admin"}),
    ...overrides
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  parameters.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return parameters.toString();
}
