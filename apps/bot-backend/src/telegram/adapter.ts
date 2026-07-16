import type {ChannelMediaItem, TelegramChatMember, TelegramChatRef, TelegramMessageId} from "../domain.js";

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: {url: string};
}

export interface CopyMessageInput {
  chatId: TelegramChatRef;
  fromChatId: TelegramChatRef;
  messageId: number;
}

export interface SendMessageInput {
  chatId: TelegramChatRef;
  text: string;
  replyMarkup?: {inline_keyboard: InlineKeyboardButton[][]};
  parseMode?: "HTML" | "MarkdownV2";
}

export interface SendMediaInput extends ChannelMediaItem {
  chatId: TelegramChatRef;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: {inline_keyboard: InlineKeyboardButton[][]};
}

export interface SendMediaGroupInput {
  chatId: TelegramChatRef;
  media: ChannelMediaItem[];
  parseMode?: "HTML" | "MarkdownV2";
}

export interface EditMessageTextInput {
  chatId: TelegramChatRef;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: {inline_keyboard: InlineKeyboardButton[][]};
}

export interface EditMessageCaptionInput {
  chatId: TelegramChatRef;
  messageId: number;
  caption: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: {inline_keyboard: InlineKeyboardButton[][]};
}

export interface RestrictChatMemberInput {
  chatId: TelegramChatRef;
  userId: number;
  permissions: Record<string, boolean>;
  untilDate?: number;
}

export interface TelegramAdapter {
  copyMessage(input: CopyMessageInput): Promise<TelegramMessageId>;
  sendMessage(input: SendMessageInput): Promise<TelegramMessageId>;
  sendMedia(input: SendMediaInput): Promise<TelegramMessageId>;
  sendMediaGroup(input: SendMediaGroupInput): Promise<TelegramMessageId[]>;
  editMessageText(input: EditMessageTextInput): Promise<true>;
  editMessageCaption(input: EditMessageCaptionInput): Promise<true>;
  answerCallbackQuery(callbackQueryId: string, text: string, showAlert?: boolean): Promise<true>;
  getChatMember(chatId: TelegramChatRef, userId: number): Promise<TelegramChatMember>;
  restrictChatMember(input: RestrictChatMemberInput): Promise<true>;
  banChatMember(chatId: TelegramChatRef, userId: number): Promise<true>;
  unbanChatMember(chatId: TelegramChatRef, userId: number): Promise<true>;
  deleteMessage(chatId: TelegramChatRef, messageId: number): Promise<true>;
  pinChatMessage(chatId: TelegramChatRef, messageId: number): Promise<true>;
  unpinChatMessage(chatId: TelegramChatRef, messageId: number): Promise<true>;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds?: number,
    readonly description?: string
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}
