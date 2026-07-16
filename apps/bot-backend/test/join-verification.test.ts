import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  DISCUSSION_GROUP_ID,
  FIXED_NOW,
  createHarness,
  customerUser,
  joinCallbackUpdate,
  newMemberUpdate,
  persistAndProcess,
  testConfig
} from "./helpers/fixtures.js";

describe("channel membership verification", () => {
  it("restricts a new member and persists one verification", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, newMemberUpdate(400));

    assert.equal(harness.store.joins.length, 1);
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.store.joins[0]?.status, "pending");
  });

  it("is idempotent for duplicate member events while verification is pending", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, newMemberUpdate(410));
    await persistAndProcess(harness, newMemberUpdate(411));
    assert.equal(harness.store.joins.length, 1);
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
  });

  it("verifies a current channel member and removes restrictions", async () => {
    const harness = createHarness();
    const user = customerUser(42000);
    harness.telegram.setMembership("@TJ_NO1_ice", user.id, "left");
    await persistAndProcess(harness, newMemberUpdate(420, user));
    harness.telegram.setMembership("@TJ_NO1_ice", user.id, "member");
    await persistAndProcess(harness, joinCallbackUpdate(421, user));

    assert.equal(harness.store.joins[0]?.status, "verified");
    assert.equal(harness.telegram.count("restrictChatMember"), 2);
    assert.equal(harness.telegram.count("editMessageText"), 1);
  });

  it("keeps left and kicked users restricted", async () => {
    for (const status of ["left", "kicked"] as const) {
      const harness = createHarness();
      const user = customerUser(status === "left" ? 43001 : 43002);
      harness.telegram.setMembership("@TJ_NO1_ice", user.id, status);
      await persistAndProcess(harness, newMemberUpdate(status === "left" ? 430 : 431, user));
      await persistAndProcess(harness, joinCallbackUpdate(status === "left" ? 432 : 433, user));
      assert.equal(harness.store.joins[0]?.status, "pending");
      assert.equal(harness.telegram.count("restrictChatMember"), 1);
    }
  });

  it("does not allow one user to verify another user", async () => {
    const harness = createHarness();
    const owner = customerUser(44001);
    const attacker = customerUser(44002);
    await persistAndProcess(harness, newMemberUpdate(440, owner));
    const callback = joinCallbackUpdate(441, attacker);
    if (callback.callback_query) callback.callback_query.data = `verify_join:${owner.id}`;
    await persistAndProcess(harness, callback);
    assert.equal(harness.store.joins[0]?.status, "pending");
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
  });

  it("bypasses configured administrators", async () => {
    const admin = customerUser(45001);
    const harness = createHarness(testConfig({telegramAdminIds: new Set([admin.id])}));
    await persistAndProcess(harness, newMemberUpdate(450, admin));
    assert.equal(harness.store.joins.length, 0);
    assert.equal(harness.telegram.count("restrictChatMember"), 0);
  });

  it("bypasses a persisted whitelist entry", async () => {
    const user = customerUser(45002);
    const harness = createHarness();
    harness.store.whitelistedUsers.add(`${DISCUSSION_GROUP_ID}:${user.id}`);
    await persistAndProcess(harness, newMemberUpdate(451, user));
    assert.equal(harness.store.joins.length, 0);
    assert.equal(harness.telegram.count("restrictChatMember"), 0);
  });

  it("kicks timed-out members without permanently banning them", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, newMemberUpdate(460));
    const verification = harness.store.joins[0];
    if (verification) verification.expiresAt = new Date(FIXED_NOW.getTime() - 1000);
    await harness.service.processMaintenance();

    assert.equal(harness.store.joins[0]?.status, "kicked");
    assert.equal(harness.telegram.count("banChatMember"), 1);
    assert.equal(harness.telegram.count("unbanChatMember"), 1);
  });

  it("ignores new-member events from unrelated groups", async () => {
    const harness = createHarness();
    const update = newMemberUpdate(470);
    if (update.message) update.message.chat.id = DISCUSSION_GROUP_ID - 1;
    await persistAndProcess(harness, update);
    assert.equal(harness.store.joins.length, 0);
  });
});
