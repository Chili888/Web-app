import type {TelegramChatMember, TelegramMessageId} from "../domain.js";
import type {
  CopyMessageInput,
  EditMessageCaptionInput,
  EditMessageTextInput,
  RestrictChatMemberInput,
  SendMediaGroupInput,
  SendMediaInput,
  SendMessageInput,
  TelegramAdapter
} from "./adapter.js";
import {TelegramApiError} from "./adapter.js";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {retry_after?: number};
}

export class HttpTelegramAdapter implements TelegramAdapter {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  copyMessage(input: CopyMessageInput): Promise<TelegramMessageId> {
    return this.call("copyMessage", {
      chat_id: input.chatId,
      from_chat_id: input.fromChatId,
      message_id: input.messageId
    });
  }

  sendMessage(input: SendMessageInput): Promise<TelegramMessageId> {
    return this.call("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode ? {parse_mode: input.parseMode} : {}),
      ...(input.replyMarkup ? {reply_markup: input.replyMarkup} : {})
    });
  }

  sendMedia(input: SendMediaInput): Promise<TelegramMessageId> {
    const method = `send${input.type[0]?.toUpperCase()}${input.type.slice(1)}`;
    return this.call(method, {
      chat_id: input.chatId,
      [input.type]: input.media,
      ...(input.caption ? {caption: input.caption} : {}),
      ...(input.parseMode ? {parse_mode: input.parseMode} : {}),
      ...(input.replyMarkup ? {reply_markup: input.replyMarkup} : {})
    });
  }

  sendMediaGroup(input: SendMediaGroupInput): Promise<TelegramMessageId[]> {
    return this.call("sendMediaGroup", {
      chat_id: input.chatId,
      media: input.media.map((item) => ({
        type: item.type,
        media: item.media,
        ...(item.caption ? {caption: item.caption} : {}),
        ...(item.caption && input.parseMode ? {parse_mode: input.parseMode} : {})
      }))
    });
  }

  editMessageText(input: EditMessageTextInput): Promise<true> {
    return this.call("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      ...(input.parseMode ? {parse_mode: input.parseMode} : {}),
      ...(input.replyMarkup ? {reply_markup: input.replyMarkup} : {})
    });
  }

  editMessageCaption(input: EditMessageCaptionInput): Promise<true> {
    return this.call("editMessageCaption", {
      chat_id: input.chatId,
      message_id: input.messageId,
      caption: input.caption,
      ...(input.parseMode ? {parse_mode: input.parseMode} : {}),
      ...(input.replyMarkup ? {reply_markup: input.replyMarkup} : {})
    });
  }

  answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false): Promise<true> {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    });
  }

  getChatMember(chatId: number | string, userId: number): Promise<TelegramChatMember> {
    return this.call("getChatMember", {chat_id: chatId, user_id: userId});
  }

  restrictChatMember(input: RestrictChatMemberInput): Promise<true> {
    return this.call("restrictChatMember", {
      chat_id: input.chatId,
      user_id: input.userId,
      permissions: input.permissions,
      use_independent_chat_permissions: true,
      ...(input.untilDate === undefined ? {} : {until_date: input.untilDate})
    });
  }

  banChatMember(chatId: number | string, userId: number): Promise<true> {
    return this.call("banChatMember", {chat_id: chatId, user_id: userId});
  }

  unbanChatMember(chatId: number | string, userId: number): Promise<true> {
    return this.call("unbanChatMember", {chat_id: chatId, user_id: userId, only_if_banned: true});
  }

  deleteMessage(chatId: number | string, messageId: number): Promise<true> {
    return this.call("deleteMessage", {chat_id: chatId, message_id: messageId});
  }

  pinChatMessage(chatId: number | string, messageId: number): Promise<true> {
    return this.call("pinChatMessage", {chat_id: chatId, message_id: messageId, disable_notification: true});
  }

  unpinChatMessage(chatId: number | string, messageId: number): Promise<true> {
    return this.call("unpinChatMessage", {chat_id: chatId, message_id: messageId});
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 240) : "unknown";
      throw new TelegramApiError(`Telegram network error: ${detail}`, 0);
    }

    let payload: TelegramResponse<T>;
    try {
      payload = await response.json() as TelegramResponse<T>;
    } catch {
      throw new TelegramApiError("Telegram returned invalid JSON", response.status);
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      const description = (payload.description || `Telegram API ${method} failed`).slice(0, 240);
      throw new TelegramApiError(description, payload.error_code || response.status, payload.parameters?.retry_after, description);
    }
    return payload.result;
  }
}
