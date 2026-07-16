begin;

alter table support.channel_posts
  add column if not exists is_pinned boolean not null default false,
  add column if not exists channel_message_ids bigint[] not null default '{}'::bigint[],
  add column if not exists deleted_at timestamptz;

update support.channel_posts
set channel_message_ids = array[channel_message_id]
where channel_message_id is not null and cardinality(channel_message_ids) = 0;

alter table support.moderation_rules drop constraint if exists moderation_rules_mode_check;
alter table support.moderation_rules
  add constraint moderation_rules_mode_check check (mode in ('log', 'delete', 'mute', 'ban'));
alter table support.moderation_rules add column if not exists version integer not null default 1;

create table if not exists support.group_moderation_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  violation_window_seconds integer not null default 86400 check (violation_window_seconds between 60 and 2592000),
  mute_after_violations integer not null default 2 check (mute_after_violations > 0),
  ban_after_violations integer not null default 4 check (ban_after_violations > 0),
  mute_duration_seconds integer not null default 900 check (mute_duration_seconds between 30 and 2592000),
  warning_message text not null default '请遵守群规，继续违规将被禁言或封禁。',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ban_after_violations >= mute_after_violations)
);
insert into support.group_moderation_settings (singleton) values (true) on conflict do nothing;

create table if not exists support.channel_operations (
  id uuid primary key default gen_random_uuid(),
  channel_post_id uuid not null references support.channel_posts(id),
  idempotency_key text not null unique,
  action text not null check (action in ('edit_text', 'edit_caption', 'delete', 'pin', 'unpin')),
  payload jsonb not null default '{}'::jsonb,
  channel_message_ids bigint[] not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_by_telegram_id bigint not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support.group_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  action text not null check (action in ('mute', 'unmute', 'ban', 'unban', 'kick')),
  telegram_chat_ref text not null,
  telegram_user_id bigint not null,
  until_at timestamptz,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_by_telegram_id bigint not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_operations_active_post_idx
  on support.channel_operations (channel_post_id)
  where status in ('pending', 'processing', 'failed');
create index if not exists channel_operations_queue_idx
  on support.channel_operations (next_attempt_at, created_at)
  where status in ('pending', 'failed');
create index if not exists group_operations_queue_idx
  on support.group_operations (next_attempt_at, created_at)
  where status in ('pending', 'failed');

drop trigger if exists set_updated_at on support.channel_operations;
create trigger set_updated_at before update on support.channel_operations
for each row execute function support.set_updated_at();

drop trigger if exists set_updated_at on support.group_operations;
create trigger set_updated_at before update on support.group_operations
for each row execute function support.set_updated_at();

drop trigger if exists set_updated_at on support.group_moderation_settings;
create trigger set_updated_at before update on support.group_moderation_settings
for each row execute function support.set_updated_at();

alter table support.channel_operations enable row level security;
alter table support.group_operations enable row level security;
alter table support.group_moderation_settings enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table support.channel_operations from anon';
    execute 'revoke all on table support.group_operations from anon';
    execute 'revoke all on table support.group_moderation_settings from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table support.channel_operations from authenticated';
    execute 'revoke all on table support.group_operations from authenticated';
    execute 'revoke all on table support.group_moderation_settings from authenticated';
  end if;
end;
$$;

comment on table support.channel_operations is
  'Durable Bot API operations for editing, deleting, pinning, and unpinning published channel posts.';

commit;
