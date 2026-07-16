import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {loadConfig} from "../src/config.js";

const BASE_ENV = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_MAIN_CHANNEL: "@TJ_NO1_ice",
  TELEGRAM_DISCUSSION_GROUP: "@TJ_ice_Group",
  DATABASE_URL: "postgresql://test"
};

describe("environment configuration", () => {
  it("loads the new administrator and operations settings", () => {
    const config = loadConfig({...BASE_ENV, TELEGRAM_ADMIN_IDS: "7141080131"});
    assert.deepEqual([...config.telegramAdminIds], [7141080131]);
    assert.equal(config.joinVerifyTimeoutSeconds, 600);
    assert.equal(config.joinVerifyTimeoutAction, "kick");
    assert.equal(config.appTimezone, "Asia/Shanghai");
    assert.equal(config.telegramInitDataMaxAgeSeconds, 900);
    assert.deepEqual([...config.storefrontOrigins], []);
  });

  it("normalizes an exact storefront CORS origin and rejects paths", () => {
    const config = loadConfig({...BASE_ENV, TELEGRAM_ADMIN_IDS: "7141080131", STOREFRONT_ORIGIN: "https://shop.example.test/"});
    assert.deepEqual([...config.storefrontOrigins], ["https://shop.example.test"]);
    assert.throws(
      () => loadConfig({...BASE_ENV, TELEGRAM_ADMIN_IDS: "7141080131", STOREFRONT_ORIGIN: "https://shop.example.test/app"}),
      /STOREFRONT_ORIGINS/
    );
  });

  it("allows the server storefront and GitHub Pages rollback origin together", () => {
    const config = loadConfig({
      ...BASE_ENV,
      TELEGRAM_ADMIN_IDS: "7141080131",
      STOREFRONT_ORIGINS: "https://bot.cverseintl.cloud,https://chili888.github.io/"
    });
    assert.deepEqual(
      [...config.storefrontOrigins],
      ["https://bot.cverseintl.cloud", "https://chili888.github.io"]
    );
  });

  it("accepts the old agent allowlist only as an administrator compatibility alias", () => {
    const config = loadConfig({...BASE_ENV, TELEGRAM_AGENT_ALLOWLIST: "7141080131"});
    assert.deepEqual([...config.telegramAdminIds], [7141080131]);
  });

  it("does not require the deprecated forum support group variable", () => {
    const config = loadConfig({...BASE_ENV, TELEGRAM_ADMIN_IDS: "7141080131", TELEGRAM_SUPPORT_GROUP_ID: ""});
    assert.equal("telegramSupportGroupId" in config, false);
  });
});
