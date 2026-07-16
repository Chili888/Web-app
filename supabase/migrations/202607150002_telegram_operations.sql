create schema if not exists support;
revoke all on schema support from public;

create table if not exists support.telegram_customers (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null unique,
  username text,
  first_name text not null default '',
  last_name text not null default '',
  language_code text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support.telegram_customer_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null unique references support.telegram_updates(update_id) on delete restrict,
  customer_id uuid not null references support.telegram_customers(id) on delete restrict,
  customer_message_id bigint not null,
  message_type text not null,
  media_group_id text,
  direction text not null check (direction in ('customer_to_admin', 'admin_to_customer', 'system')),
  telegram_file_id text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed', 'dead_letter')),
  target_message_id bigint,
  error_code text,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, direction, customer_message_id)
);
create index if not exists telegram_customer_messages_customer_idx
  on support.telegram_customer_messages (customer_id, received_at desc);
create index if not exists telegram_customer_messages_delivery_idx
  on support.telegram_customer_messages (delivery_status, created_at)
  where delivery_status in ('queued', 'failed');

create table if not exists support.telegram_media_group_summaries (
  customer_id uuid not null references support.telegram_customers(id) on delete cascade,
  media_group_id text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (customer_id, media_group_id)
);

create table if not exists support.telegram_admin_message_routes (
  id uuid primary key default gen_random_uuid(),
  admin_telegram_id bigint not null,
  admin_chat_id bigint not null,
  admin_message_id bigint not null,
  customer_id uuid not null references support.telegram_customers(id) on delete restrict,
  customer_chat_id bigint not null,
  customer_message_id bigint not null,
  source_message_type text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (admin_chat_id, admin_message_id)
);
create index if not exists telegram_admin_routes_customer_idx
  on support.telegram_admin_message_routes (customer_id, created_at desc);
create index if not exists telegram_admin_routes_lookup_idx
  on support.telegram_admin_message_routes (admin_telegram_id, admin_chat_id, admin_message_id);

create table if not exists support.bot_auto_reply_rules (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  match_type text not null check (match_type in ('exact', 'contains', 'prefix', 'regex')),
  keyword text not null,
  response_type text not null default 'text' check (response_type in ('text')),
  response_content text not null,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bot_auto_reply_rules_enabled_idx
  on support.bot_auto_reply_rules (enabled, priority, created_at);

create table if not exists support.bot_settings (
  id boolean primary key default true check (id),
  welcome_message text not null default '欢迎联系人工客服，请直接发送您的问题。',
  help_message text not null default '请直接发送文字、图片、视频、语音或文件，管理员会尽快回复。',
  business_hours text not null default '',
  offline_message text not null default '',
  mini_app_url text not null default '',
  channel_url text not null default 'https://t.me/TJ_NO1_ice',
  group_url text not null default 'https://t.me/TJ_ice_Group',
  automatic_reply_enabled boolean not null default true,
  join_verify_enabled boolean not null default true,
  join_verify_prompt text not null default '请先关注主频道，然后点击验证按钮。',
  join_verify_timeout_seconds integer not null default 600 check (join_verify_timeout_seconds > 0),
  join_verify_timeout_action text not null default 'kick'
    check (join_verify_timeout_action in ('kick', 'ban', 'mute', 'none')),
  join_verify_welcome_message text not null default '验证成功，欢迎加入！',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into support.bot_settings (id) values (true) on conflict (id) do nothing;

create table if not exists support.telegram_user_whitelist (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_chat_id bigint,
  reason text not null default '',
  enabled boolean not null default true,
  created_by_telegram_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists telegram_user_whitelist_scope_idx
  on support.telegram_user_whitelist (telegram_user_id, coalesce(telegram_chat_id, 0));

create table if not exists support.join_verifications (
  id uuid primary key default gen_random_uuid(),
  source_update_id bigint not null unique references support.telegram_updates(update_id) on delete restrict,
  telegram_user_id bigint not null,
  telegram_chat_id bigint not null,
  joined_at timestamptz not null,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'failed', 'expired', 'kicked', 'banned', 'bypassed')),
  verification_message_id bigint,
  verified_at timestamptz,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_check_status text,
  timeout_action text not null check (timeout_action in ('kick', 'ban', 'mute', 'none')),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists join_verifications_one_pending_user_idx
  on support.join_verifications (telegram_chat_id, telegram_user_id)
  where verification_status = 'pending';
create index if not exists join_verifications_timeout_idx
  on support.join_verifications (expires_at, created_at)
  where verification_status = 'pending';

create table if not exists support.moderation_rules (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  mode text not null default 'log' check (mode in ('log', 'delete', 'mute')),
  rule_type text not null,
  pattern text,
  threshold integer,
  window_seconds integer,
  action_duration_seconds integer,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  telegram_user_id bigint not null,
  source_message_id bigint,
  rule_id uuid references support.moderation_rules(id) on delete set null,
  action text not null,
  reason_code text not null,
  muted_until timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_user_idx
  on support.moderation_actions (telegram_chat_id, telegram_user_id, created_at desc);
create unique index if not exists moderation_actions_idempotency_idx
  on support.moderation_actions (telegram_chat_id, source_message_id, rule_id, action)
  where source_message_id is not null and rule_id is not null;

create table if not exists support.channel_posts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'cancelled', 'failed', 'dead_letter')),
  content_type text not null,
  content jsonb not null default '{}'::jsonb,
  parse_mode text,
  scheduled_at timestamptz,
  next_attempt_at timestamptz,
  timezone text not null default 'Asia/Shanghai',
  channel_message_id bigint,
  discussion_message_id bigint,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  version integer not null default 1 check (version > 0),
  published_at timestamptz,
  created_by_telegram_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists channel_posts_schedule_idx
  on support.channel_posts (coalesce(next_attempt_at, scheduled_at), created_at)
  where status in ('scheduled', 'failed');

create table if not exists support.admin_api_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  admin_telegram_id bigint not null,
  method text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_api_requests_created_idx
  on support.admin_api_requests (created_at);

create table if not exists support.worker_heartbeats (
  worker_id text primary key,
  worker_type text not null,
  last_seen_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table support.telegram_updates add column if not exists update_type text;
alter table support.telegram_updates add column if not exists payload_redacted_at timestamptz;

comment on table support.support_conversations is
  'DEPRECATED: retained for rollback only; direct admin private-message routing replaces forum conversations.';
comment on table support.conversation_assignments is
  'DEPRECATED: retained for rollback only; claim/unclaim workflow is no longer used.';
comment on table support.support_messages is
  'DEPRECATED: retained for rollback only; new messages use telegram_customer_messages.';
comment on table support.support_agents is
  'DEPRECATED: retained for rollback only; TELEGRAM_ADMIN_IDS controls direct admin routing.';

create or replace function support.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'telegram_customers', 'telegram_customer_messages', 'bot_auto_reply_rules',
    'bot_settings', 'telegram_user_whitelist', 'join_verifications', 'moderation_rules', 'channel_posts',
    'worker_heartbeats'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on support.%I', table_name, table_name);
    execute format(
      'create trigger %I_set_updated_at before update on support.%I for each row execute function support.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

alter table support.telegram_customers enable row level security;
alter table support.telegram_customer_messages enable row level security;
alter table support.telegram_media_group_summaries enable row level security;
alter table support.telegram_admin_message_routes enable row level security;
alter table support.bot_auto_reply_rules enable row level security;
alter table support.bot_settings enable row level security;
alter table support.telegram_user_whitelist enable row level security;
alter table support.join_verifications enable row level security;
alter table support.moderation_rules enable row level security;
alter table support.moderation_actions enable row level security;
alter table support.channel_posts enable row level security;
alter table support.admin_api_requests enable row level security;
alter table support.worker_heartbeats enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema support from anon';
    execute 'revoke all privileges on all tables in schema support from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema support from authenticated';
    execute 'revoke all privileges on all tables in schema support from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema support to service_role';
    execute 'grant all privileges on all tables in schema support to service_role';
    execute 'grant all privileges on all sequences in schema support to service_role';
  end if;
end;
$$;
