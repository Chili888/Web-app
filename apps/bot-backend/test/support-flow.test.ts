import assert from "node:assert/strict";
import {describe, it} from "node:test";
import type {TelegramUpdate} from "../src/domain.js";
import {silentLogger} from "../src/logger.js";
import {OutboxExecutor} from "../src/services/outbox-executor.js";
import {SupportService} from "../src/services/support-service.js";
import {
  ADMIN_ID,
  FIXED_NOW,
  adminReplyUpdate,
  createHarness,
  customerUpdate,
  customerUser,
  menuCallbackUpdate,
  persistAndProcess
} from "./helpers/fixtures.js";

describe("direct customer support", () => {
  it("sends customer identity and text to the configured administrator", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(100, 1000));

    assert.equal(harness.store.customers.size, 1);
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.telegram.count("copyMessage"), 1);
    assert.equal(harness.store.routes.length, 2);
    assert.ok(harness.store.routes.every((route) => route.customerChatId === customerUser().id));
    assert.equal(harness.store.updates.get(100)?.status, "completed");
  });

  it("supports customer media and metadata types through copyMessage", async () => {
    const harness = createHarness();
    const user = customerUser(170);
    const updates: TelegramUpdate[] = [
      customerUpdate(171, 1701, {from: user, text: undefined, photo: [{file_id: "photo"}], caption: "图片说明"}),
      customerUpdate(172, 1702, {from: user, text: undefined, video: {file_id: "video"}, caption: "视频说明"}),
      customerUpdate(173, 1703, {from: user, text: undefined, voice: {file_id: "voice"}}),
      customerUpdate(174, 1704, {from: user, text: undefined, audio: {file_id: "audio"}}),
      customerUpdate(175, 1705, {from: user, text: undefined, document: {file_id: "document"}}),
      customerUpdate(176, 1706, {from: user, text: undefined, animation: {file_id: "animation"}}),
      customerUpdate(177, 1707, {from: user, text: undefined, sticker: {file_id: "sticker"}}),
      customerUpdate(178, 1708, {from: user, text: undefined, video_note: {file_id: "video-note"}}),
      customerUpdate(179, 1709, {from: user, text: undefined, contact: {phone_number: "000", first_name: "联系人"}}),
      customerUpdate(180, 1710, {from: user, text: undefined, location: {latitude: 1, longitude: 2}}),
      customerUpdate(181, 1711, {from: user, text: undefined, venue: {location: {latitude: 1, longitude: 2}, title: "地点", address: "地址"}}),
      customerUpdate(182, 1712, {from: user, text: undefined, poll: {id: "poll", question: "问题", is_closed: false}}),
      customerUpdate(183, 1713, {from: user, text: undefined, dice: {emoji: "🎲", value: 6}})
    ];
    for (const update of updates) await persistAndProcess(harness, update);

    assert.equal(harness.telegram.count("copyMessage"), updates.length);
    assert.deepEqual(
      harness.store.messages.map((message) => "messageType" in message ? message.messageType : ""),
      ["photo", "video", "voice", "audio", "document", "animation", "sticker", "video_note", "contact", "location", "venue", "poll", "dice"]
    );
  });

  it("sends the named /start welcome page and six inline buttons without forwarding the command", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(200, 2000, {text: "/start"}));

    assert.equal(harness.telegram.count("sendMessage"), 2);
    assert.equal(harness.telegram.count("copyMessage"), 0);
    assert.equal(harness.store.routes.length, 1);
    assert.equal(harness.store.routes[0]?.routeType, "customer_start");
    const welcome = harness.telegram.calls.find((call) => call.method === "sendMessage")?.input as {
      chatId: number;
      text: string;
      replyMarkup: {inline_keyboard: Array<Array<{text: string; callback_data?: string; url?: string; web_app?: {url: string}}>>};
    };
    assert.equal(welcome.chatId, customerUser().id);
    assert.match(welcome.text, /^⚡ 欢迎，张！/u);
    assert.match(welcome.text, /天津品质天花板/u);
    assert.equal(welcome.replyMarkup.inline_keyboard.length, 3);
    const buttons = welcome.replyMarkup.inline_keyboard.flat();
    assert.equal(buttons.length, 6);
    assert.deepEqual(buttons.map((button) => button.text), [
      "💎 为什么选择我们？", "📋 现货咨询", "🤝 交易必看",
      "🙋 联系客服", "🛍 进入商城", "📢 关注频道"
    ]);
    assert.deepEqual(buttons.slice(0, 4).map((button) => button.callback_data), [
      "menu_why_us", "menu_stock", "menu_trade_rules", "menu_contact"
    ]);
    assert.equal(buttons[4]?.web_app?.url, "https://example.test/app");
    assert.equal(buttons[5]?.url, "https://t.me/TJ_NO1_ice");
  });

  it("answers menu callbacks, returns dynamic content, and never routes menu clicks to the administrator", async () => {
    const harness = createHarness();
    const cases = [
      ["menu_why_us", "为什么选择我们"],
      ["menu_stock", "现货咨询说明"],
      ["menu_trade_rules", "交易必看说明"],
      ["menu_contact", "请直接把您的需求"]
    ] as const;
    for (const [index, [data, expected]] of cases.entries()) {
      await persistAndProcess(harness, menuCallbackUpdate(201 + index, data));
      const sent = harness.telegram.calls.filter((call) => call.method === "sendMessage").at(-1)?.input as {chatId: number; text: string};
      assert.equal(sent.chatId, customerUser().id);
      assert.match(sent.text, new RegExp(expected, "u"));
    }
    assert.equal(harness.telegram.count("answerCallbackQuery"), cases.length);
    assert.equal(harness.telegram.count("sendMessage"), cases.length);
    assert.equal(harness.telegram.count("copyMessage"), 0);
    assert.equal(harness.store.routes.length, 0);
  });

  it("handles repeated callback ids idempotently without duplicate menu responses", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, menuCallbackUpdate(205, "menu_stock", customerUser(), "same-callback"));
    await persistAndProcess(harness, menuCallbackUpdate(206, "menu_stock", customerUser(), "same-callback"));
    assert.equal(harness.telegram.count("answerCallbackQuery"), 2);
    assert.equal(harness.telegram.count("sendMessage"), 1);
  });

  it("still notifies the administrator when an automatic reply matches", async () => {
    const harness = createHarness();
    harness.store.autoReplies.push({
      id: "rule-1",
      matchType: "contains",
      keyword: "营业时间",
      responseType: "text",
      responseContent: "营业时间为 09:00-18:00",
      priority: 1
    });
    await persistAndProcess(harness, customerUpdate(210, 2100, {text: "营业时间是什么"}));

    assert.equal(harness.telegram.count("sendMessage"), 2);
    assert.equal(harness.telegram.count("copyMessage"), 1);
    assert.equal(harness.store.routes.length, 2);
  });

  it("routes an administrator reply using the persisted replied-message mapping", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(220, 2200));
    const route = harness.store.routes.find((item) => item.sourceMessageType === "text");
    assert.ok(route);

    await persistAndProcess(harness, adminReplyUpdate(221, 2201, route.adminMessageId));

    const customerCopy = harness.telegram.calls.at(-1);
    assert.equal(customerCopy?.method, "copyMessage");
    assert.equal((customerCopy?.input as {chatId: number}).chatId, customerUser().id);
    assert.ok(harness.store.audits.some((audit) => audit.action === "admin_reply_sent"));
  });

  it("copies administrator media replies with captions to the routed customer", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(222, 2220));
    const route = harness.store.routes.find((item) => item.routeType === "customer_summary");
    assert.ok(route);
    await persistAndProcess(harness, adminReplyUpdate(223, 2221, route.adminMessageId, {
      text: undefined,
      photo: [{file_id: "admin-photo"}],
      caption: "管理员图片说明"
    }));
    const copy = harness.telegram.calls.at(-1);
    assert.equal(copy?.method, "copyMessage");
    assert.equal((copy?.input as {chatId: number}).chatId, customerUser().id);
    const recorded = harness.store.messages.at(-1);
    assert.equal(recorded && "messageType" in recorded ? recorded.messageType : null, "photo");
  });

  it("keeps routes usable after the service instance restarts", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(230, 2300));
    const route = harness.store.routes[0];
    assert.ok(route);

    const outbox = new OutboxExecutor(harness.store, silentLogger, {
      maxAttempts: 3,
      retryBaseMs: 1000,
      workerId: "restarted-worker",
      now: () => FIXED_NOW,
      random: () => 0
    });
    const restarted = new SupportService(harness.config, harness.store, harness.telegram, outbox, silentLogger, {
      workerId: "restarted-worker",
      now: () => FIXED_NOW
    });
    await harness.store.persistUpdate(adminReplyUpdate(231, 2301, route.adminMessageId));
    await restarted.processNext();

    assert.ok(harness.store.audits.some((audit) => audit.action === "admin_reply_sent"));
  });

  it("prompts an administrator who did not reply to a routed message", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, adminReplyUpdate(240, 2400));
    const notice = harness.telegram.calls.at(-1);
    assert.equal(notice?.method, "sendMessage");
    assert.match((notice?.input as {text: string}).text, /请回复一条客户消息/);
  });

  it("treats every non-admin private user as a customer", async () => {
    const harness = createHarness();
    const nonAdmin = customerUser(ADMIN_ID + 1);
    await persistAndProcess(harness, customerUpdate(250, 2500, {from: nonAdmin, chat: {id: nonAdmin.id, type: "private"}}));
    assert.equal(harness.store.customers.size, 1);
    assert.equal(harness.telegram.count("copyMessage"), 1);
  });

  it("does not cross-route simultaneous customers", async () => {
    const harness = createHarness();
    const first = customerUser(30001);
    const second = customerUser(30002);
    await persistAndProcess(harness, customerUpdate(260, 2600, {from: first, chat: {id: first.id, type: "private"}}));
    const firstRoute = harness.store.routes.find((route) => route.customerChatId === first.id);
    await persistAndProcess(harness, customerUpdate(261, 2601, {from: second, chat: {id: second.id, type: "private"}}));
    const secondRoute = harness.store.routes.find((route) => route.customerChatId === second.id);
    assert.ok(firstRoute && secondRoute);

    await persistAndProcess(harness, adminReplyUpdate(262, 2602, firstRoute.adminMessageId));
    await persistAndProcess(harness, adminReplyUpdate(263, 2603, secondRoute.adminMessageId));
    const copies = harness.telegram.calls.filter((call) => call.method === "copyMessage").slice(-2);
    assert.deepEqual(copies.map((call) => (call.input as {chatId: number}).chatId), [first.id, second.id]);
  });

  it("sends one identity summary for a media group", async () => {
    const harness = createHarness();
    const user = customerUser(31000);
    await persistAndProcess(harness, customerUpdate(270, 2700, {from: user, text: undefined, photo: [{file_id: "a"}], media_group_id: "album"}));
    await persistAndProcess(harness, customerUpdate(271, 2701, {from: user, text: undefined, photo: [{file_id: "b"}], media_group_id: "album"}));
    assert.equal(harness.telegram.count("sendMessage"), 1);
    assert.equal(harness.telegram.count("copyMessage"), 2);
    assert.equal(harness.store.routes.length, 3);
  });

  it("reports an unsupported message type instead of silently dropping it", async () => {
    const harness = createHarness();
    await persistAndProcess(harness, customerUpdate(280, 2800, {text: undefined}));
    assert.equal(harness.telegram.count("copyMessage"), 0);
    assert.equal(harness.telegram.count("sendMessage"), 3);
    assert.equal(harness.store.updates.get(280)?.status, "completed");
  });
});
