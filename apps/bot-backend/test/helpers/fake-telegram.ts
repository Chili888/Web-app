import type {TelegramChatMember, TelegramMessageId} from "../../src/domain.js";
import type {
  CopyMessageInput,
  EditMessageCaptionInput,
  EditMessageTextInput,
  RestrictChatMemberInput,
  SendMediaGroupInput,
  SendMediaInput,
  SendMessageInput,
  TelegramAdapter
} from "../../src/telegram/adapter.js";

type Method = keyof TelegramAdapter;

export class FakeTelegramAdapter implements TelegramAdapter {
  readonly calls: Array<{method: Method; input: unknown}> = [];
  private readonly failures = new Map<Method, Error[]>();
  private readonly memberships = new Map<string, TelegramChatMember["status"]>();
  private nextMessageId = 1000;

  failNext(method: Method, error: Error): void {
    const failures = this.failures.get(method) ?? [];
    failures.push(error);
    this.failures.set(method, failures);
  }

  setMembership(chatId: number | string, userId: number, status: TelegramChatMember["status"]): void {
    this.memberships.set(`${chatId}:${userId}`, status);
  }

  async copyMessage(input: CopyMessageInput): Promise<TelegramMessageId> {
    this.record("copyMessage", input);
    this.throwFailure("copyMessage");
    return {message_id: this.nextId()};
  }

  async sendMessage(input: SendMessageInput): Promise<TelegramMessageId> {
    this.record("sendMessage", input);
    this.throwFailure("sendMessage");
    return {message_id: this.nextId()};
  }

  async sendMedia(input: SendMediaInput): Promise<TelegramMessageId> {
    this.record("sendMedia", input);
    this.throwFailure("sendMedia");
    return {message_id: this.nextId()};
  }

  async sendMediaGroup(input: SendMediaGroupInput): Promise<TelegramMessageId[]> {
    this.record("sendMediaGroup", input);
    this.throwFailure("sendMediaGroup");
    return input.media.map(() => ({message_id: this.nextId()}));
  }

  async editMessageText(input: EditMessageTextInput): Promise<true> {
    this.record("editMessageText", input);
    this.throwFailure("editMessageText");
    return true;
  }

  async editMessageCaption(input: EditMessageCaptionInput): Promise<true> {
    this.record("editMessageCaption", input);
    this.throwFailure("editMessageCaption");
    return true;
  }

  async answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false): Promise<true> {
    this.record("answerCallbackQuery", {callbackQueryId, text, showAlert});
    this.throwFailure("answerCallbackQuery");
    return true;
  }

  async getChatMember(chatId: number | string, userId: number): Promise<TelegramChatMember> {
    this.record("getChatMember", {chatId, userId});
    this.throwFailure("getChatMember");
    return {
      status: this.memberships.get(`${chatId}:${userId}`) ?? "member",
      user: {id: userId, is_bot: false, first_name: "User"}
    };
  }

  async restrictChatMember(input: RestrictChatMemberInput): Promise<true> {
    this.record("restrictChatMember", input);
    this.throwFailure("restrictChatMember");
    return true;
  }

  async banChatMember(chatId: number | string, userId: number): Promise<true> {
    this.record("banChatMember", {chatId, userId});
    this.throwFailure("banChatMember");
    return true;
  }

  async unbanChatMember(chatId: number | string, userId: number): Promise<true> {
    this.record("unbanChatMember", {chatId, userId});
    this.throwFailure("unbanChatMember");
    return true;
  }

  async deleteMessage(chatId: number | string, messageId: number): Promise<true> {
    this.record("deleteMessage", {chatId, messageId});
    this.throwFailure("deleteMessage");
    return true;
  }

  async pinChatMessage(chatId: number | string, messageId: number): Promise<true> {
    this.record("pinChatMessage", {chatId, messageId});
    this.throwFailure("pinChatMessage");
    return true;
  }

  async unpinChatMessage(chatId: number | string, messageId: number): Promise<true> {
    this.record("unpinChatMessage", {chatId, messageId});
    this.throwFailure("unpinChatMessage");
    return true;
  }

  count(method: Method): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  private record(method: Method, input: unknown): void {
    this.calls.push({method, input: structuredClone(input)});
  }

  private throwFailure(method: Method): void {
    const error = this.failures.get(method)?.shift();
    if (error) throw error;
  }

  private nextId(): number {
    this.nextMessageId += 1;
    return this.nextMessageId;
  }
}
