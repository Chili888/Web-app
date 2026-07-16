import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {describe, it} from "node:test";
import {ADMIN_ID, DISCUSSION_GROUP_ID, createHarness, customerUpdate, customerUser, persistAndProcess} from "./helpers/fixtures.js";

describe("discussion group moderation", () => {
  it("deletes a configured keyword violation and audits it", async () => {
    const harness = createHarness();
    const ruleId = randomUUID();
    harness.store.moderationRules.push({
      id: ruleId,
      mode: "delete",
      ruleType: "keyword",
      pattern: "广告词",
      actionDurationSeconds: null
    });
    await persistAndProcess(harness, groupMessage(700, customerUser(70001), "这里有广告词"));

    assert.equal(harness.telegram.count("deleteMessage"), 1);
    assert.equal(harness.store.moderationActions.length, 1);
    assert.equal(harness.store.audits.at(-1)?.action, "group_moderation_delete");
  });

  it("mutes a link spammer for the configured duration", async () => {
    const harness = createHarness();
    harness.store.moderationRules.push({
      id: randomUUID(),
      mode: "mute",
      ruleType: "link",
      pattern: null,
      actionDurationSeconds: 900
    });
    await persistAndProcess(harness, groupMessage(710, customerUser(71001), "访问 https://spam.example"));

    assert.equal(harness.telegram.count("deleteMessage"), 1);
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
    assert.equal(harness.store.moderationActions[0]?.mutedUntil?.toISOString(), "2026-07-15T12:45:00.000Z");
  });

  it("skips administrators and whitelisted users", async () => {
    const harness = createHarness();
    harness.store.moderationRules.push({
      id: randomUUID(),
      mode: "delete",
      ruleType: "link",
      pattern: null,
      actionDurationSeconds: null
    });
    await persistAndProcess(harness, groupMessage(720, customerUser(ADMIN_ID), "https://admin.example"));
    const allowed = customerUser(72001);
    harness.store.whitelistedUsers.add(`${DISCUSSION_GROUP_ID}:${allowed.id}`);
    await persistAndProcess(harness, groupMessage(721, allowed, "https://allowed.example"));

    assert.equal(harness.telegram.count("deleteMessage"), 0);
    assert.equal(harness.store.moderationActions.length, 0);
  });

  it("escalates a repeated violation from warning to mute", async () => {
    const harness = createHarness();
    harness.store.moderationRules.push({
      id: randomUUID(),
      mode: "delete",
      ruleType: "keyword",
      pattern: "重复广告",
      actionDurationSeconds: null
    });
    const user = customerUser(73001);
    await persistAndProcess(harness, groupMessage(730, user, "重复广告"));
    await persistAndProcess(harness, groupMessage(731, user, "再次重复广告"));
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
    assert.equal(harness.store.moderationActions[1]?.action, "mute");
  });

  it("executes a queued manual unmute operation", async () => {
    const harness = createHarness();
    await harness.store.createGroupOperation({
      idempotencyKey: "manual-unmute-73002",
      action: "unmute",
      telegramChatId: DISCUSSION_GROUP_ID,
      telegramUserId: 73002,
      untilAt: null,
      reason: "人工解除",
      actorTelegramId: ADMIN_ID
    });
    await harness.service.processMaintenance();
    assert.equal(harness.telegram.count("restrictChatMember"), 1);
    assert.equal(harness.store.groupOperations[0]?.status, "completed");
  });
});

function groupMessage(updateId: number, user: ReturnType<typeof customerUser>, text: string) {
  return customerUpdate(updateId, updateId + 1000, {
    from: user,
    chat: {id: DISCUSSION_GROUP_ID, type: "supergroup", username: "TJ_ice_Group"},
    text
  });
}
