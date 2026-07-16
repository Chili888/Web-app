export type MessageType =
  | "command"
  | "text"
  | "photo"
  | "video"
  | "voice"
  | "audio"
  | "document"
  | "animation"
  | "sticker"
  | "video_note"
  | "contact"
  | "location"
  | "venue"
  | "poll"
  | "dice"
  | "system"
  | "unknown";
export type UpdateStatus = "pending" | "processing" | "retry" | "completed" | "ignored" | "dead_letter";
export type OutboxStatus = "pending" | "processing" | "retry" | "sent" | "dead_letter";
export type JoinVerificationStatus = "pending" | "verified" | "failed" | "expired" | "kicked" | "banned" | "bypassed";
export type JoinTimeoutAction = "kick" | "ban" | "mute" | "none";
export type TelegramChatRef = number | string;

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  reply_to_message?: TelegramMessage;
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  video?: TelegramFile;
  voice?: TelegramFile;
  audio?: TelegramFile;
  document?: TelegramFile;
  animation?: TelegramFile;
  sticker?: TelegramFile;
  video_note?: TelegramFile;
  contact?: {phone_number: string; first_name: string; last_name?: string; user_id?: number};
  location?: {latitude: number; longitude: number};
  venue?: {location: {latitude: number; longitude: number}; title: string; address: string};
  poll?: {id: string; question: string; is_closed: boolean};
  dice?: {emoji: string; value: number};
  media_group_id?: string;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  new_chat_title?: string;
  delete_chat_photo?: true;
  group_chat_created?: true;
  supergroup_chat_created?: true;
  channel_chat_created?: true;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TelegramUser;
  is_member?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface StoredUpdate {
  updateId: number;
  payload: TelegramUpdate;
  status: UpdateStatus;
  attempts: number;
  nextAttemptAt: Date;
}

export interface TelegramCustomerRecord {
  id: string;
  telegramUserId: number;
  telegramChatId: number;
  username: string | null;
  firstName: string;
  lastName: string;
  languageCode: string | null;
  isBlocked: boolean;
}

export interface AdminMessageRouteRecord {
  id: string;
  adminTelegramId: number;
  adminChatId: number;
  adminMessageId: number;
  customerId: string;
  customerChatId: number;
  customerMessageId: number;
  sourceMessageType: MessageType;
  routeType: "customer_summary" | "customer_content" | "customer_media" | "customer_start";
}

export interface CustomerMessageResolution {
  customer: TelegramCustomerRecord;
  inserted: boolean;
  shouldSendSummary: boolean;
}

export interface BotSettingsRecord {
  version: number;
  welcomeMessage: string;
  helpMessage: string;
  whyUsMessage: string;
  stockMessage: string;
  tradeRulesMessage: string;
  contactMessage: string;
  businessHours: string;
  offlineMessage: string;
  miniAppUrl: string;
  channelUrl: string;
  groupUrl: string;
  automaticReplyEnabled: boolean;
  joinVerifyEnabled: boolean;
  joinVerifyPrompt: string;
  joinVerifyTimeoutSeconds: number;
  joinVerifyTimeoutAction: JoinTimeoutAction;
  joinVerifyWelcomeMessage: string;
  menuButtons: BotMenuButton[];
}

export type BotMenuButtonKey = "why_us" | "stock" | "trade_rules" | "contact" | "mini_app" | "channel";

export interface BotMenuButton {
  key: BotMenuButtonKey;
  label: string;
  visible: boolean;
  position: number;
}

export interface AutoReplyRuleRecord {
  id: string;
  matchType: "exact" | "contains" | "prefix" | "regex";
  keyword: string;
  responseType: "text";
  responseContent: string;
  priority: number;
}

export interface AutoReplyRuleDetails extends AutoReplyRuleRecord {
  enabled: boolean;
  version: number;
}

export interface JoinVerificationRecord {
  id: string;
  telegramUserId: number;
  telegramChatId: number;
  joinedAt: Date;
  status: JoinVerificationStatus;
  verificationMessageId: number | null;
  expiresAt: Date;
  attempts: number;
  timeoutAction: JoinTimeoutAction;
}

export type ChannelMediaType = "photo" | "video" | "document" | "animation" | "audio";

export interface ChannelMediaItem {
  type: ChannelMediaType;
  media: string;
  caption?: string;
}

export interface ChannelPostContent {
  text?: string;
  media?: ChannelMediaItem[];
  buttons?: Array<Array<{text: string; url?: string; web_app?: {url: string}}>>;
  pin?: boolean;
}

export interface ChannelPostRecord {
  id: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "cancelled" | "failed" | "dead_letter";
  contentType: string;
  content: ChannelPostContent;
  parseMode: "HTML" | "MarkdownV2" | null;
  scheduledAt: Date | null;
  attempts: number;
  maxAttempts: number;
}

export interface ChannelPostDetails extends ChannelPostRecord {
  channelMessageId: number | null;
  channelMessageIds: number[];
  lastError: string | null;
  isPinned: boolean;
  deletedAt: Date | null;
  version: number;
  createdByTelegramId: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ChannelOperationAction = "edit_text" | "edit_caption" | "delete" | "pin" | "unpin";

export interface ChannelOperationRecord {
  id: string;
  channelPostId: string;
  action: ChannelOperationAction;
  payload: {text?: string; caption?: string; parseMode?: "HTML" | "MarkdownV2" | null};
  channelMessageIds: number[];
  attempts: number;
  maxAttempts: number;
}

export interface ModerationRuleRecord {
  id: string;
  mode: "log" | "delete" | "mute" | "ban";
  ruleType: "keyword" | "link";
  pattern: string | null;
  actionDurationSeconds: number | null;
}

export interface ModerationRuleDetails extends ModerationRuleRecord {
  enabled: boolean;
  priority: number;
  version: number;
}

export interface GroupModerationSettings {
  version: number;
  enabled: boolean;
  violationWindowSeconds: number;
  muteAfterViolations: number;
  banAfterViolations: number;
  muteDurationSeconds: number;
  warningMessage: string;
}

export type GroupOperationAction = "mute" | "unmute" | "ban" | "unban" | "kick";

export interface GroupOperationRecord {
  id: string;
  action: GroupOperationAction;
  telegramChatId: TelegramChatRef;
  telegramUserId: number;
  untilAt: Date | null;
  reason: string;
  attempts: number;
  maxAttempts: number;
}

export interface OutboxRecord {
  id: string;
  idempotencyKey: string;
  action: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  response: unknown;
}

export interface OutboxLease {
  record: OutboxRecord;
  execute: boolean;
}

export interface TelegramMessageId {
  message_id: number;
}

export function telegramDisplayName(user: TelegramUser): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || (user.username ? `@${user.username}` : `用户 ${user.id}`);
}

export function detectMessageType(message: TelegramMessage): MessageType {
  if (message.text) return message.text.startsWith("/") ? "command" : "text";
  if (message.photo?.length) return "photo";
  if (message.video) return "video";
  if (message.voice) return "voice";
  if (message.audio) return "audio";
  if (message.document) return "document";
  if (message.animation) return "animation";
  if (message.sticker) return "sticker";
  if (message.video_note) return "video_note";
  if (message.contact) return "contact";
  if (message.venue) return "venue";
  if (message.location) return "location";
  if (message.poll) return "poll";
  if (message.dice) return "dice";
  if (isSystemMessage(message)) return "system";
  return "unknown";
}

export function messageFileId(message: TelegramMessage): string | null {
  return message.photo?.at(-1)?.file_id
    ?? message.video?.file_id
    ?? message.voice?.file_id
    ?? message.audio?.file_id
    ?? message.document?.file_id
    ?? message.animation?.file_id
    ?? message.sticker?.file_id
    ?? message.video_note?.file_id
    ?? null;
}

export function isSystemMessage(message: TelegramMessage): boolean {
  return Boolean(
    message.new_chat_members?.length
    || message.left_chat_member
    || message.new_chat_title
    || message.delete_chat_photo
    || message.group_chat_created
    || message.supergroup_chat_created
    || message.channel_chat_created
  );
}
