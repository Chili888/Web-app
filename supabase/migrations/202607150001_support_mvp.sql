create schema if not exists support;
revoke all on schema support from public;

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

create table support.telegram_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username text,
  first_name text not null default '',
  last_name text not null default '',
  language_code text,
  is_blocked boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support.support_agents (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username text,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support.support_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_number bigint generated always as identity unique,
  telegram_user_id uuid not null references support.telegram_users(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'assigned', 'closed')),
  assigned_agent_id uuid references support.support_agents(id) on delete set null,
  support_group_id bigint,
  message_thread_id bigint,
  topic_state text not null default 'pending' check (topic_state in ('pending', 'creating', 'ready')),
  topic_creation_locked_at timestamptz,
  profile_card_message_id bigint,
  version integer not null default 1 check (version > 0),
  last_message_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((support_group_id is null) = (message_thread_id is null)),
  check ((message_thread_id is null and topic_state <> 'ready') or (message_thread_id is not null and topic_state = 'ready'))
);

create unique index support_conversations_one_active_user_idx
  on support.support_conversations (telegram_user_id)
  where status in ('open', 'assigned');
create unique index support_conversations_topic_idx
  on support.support_conversations (support_group_id, message_thread_id)
  where message_thread_id is not null;
create index support_conversations_status_updated_idx
  on support.support_conversations (status, updated_at desc);
create index support_conversations_agent_idx
  on support.support_conversations (assigned_agent_id, status)
  where assigned_agent_id is not null;

create table support.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support.support_conversations(id) on delete cascade,
  action text not null check (action in ('claim', 'unclaim', 'transfer')),
  from_agent_id uuid references support.support_agents(id) on delete set null,
  to_agent_id uuid references support.support_agents(id) on delete set null,
  performed_by_agent_id uuid not null references support.support_agents(id) on delete restrict,
  conversation_version integer not null,
  created_at timestamptz not null default now()
);
create index conversation_assignments_conversation_idx
  on support.conversation_assignments (conversation_id, created_at desc);

create table support.telegram_updates (
  id uuid primary key default gen_random_uuid(),
  update_id bigint not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'completed', 'ignored', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index telegram_updates_worker_idx
  on support.telegram_updates (status, next_attempt_at, created_at)
  where status in ('pending', 'retry');

create table support.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support.support_conversations(id) on delete cascade,
  update_id bigint references support.telegram_updates(update_id) on delete set null,
  direction text not null check (direction in ('customer_to_agent', 'agent_to_customer', 'system')),
  message_type text not null check (message_type in ('text', 'photo', 'video', 'voice', 'document', 'animation', 'sticker', 'command', 'system', 'unknown')),
  agent_id uuid references support.support_agents(id) on delete set null,
  source_chat_id bigint not null,
  source_message_id bigint not null,
  target_chat_id bigint,
  target_message_id bigint,
  message_thread_id bigint,
  telegram_file_id text,
  text_content text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed', 'dead_letter')),
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_chat_id, source_message_id)
);
create index support_messages_conversation_idx
  on support.support_messages (conversation_id, created_at);
create index support_messages_delivery_idx
  on support.support_messages (delivery_status, created_at)
  where delivery_status <> 'sent';

create table support.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  action text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'sent', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  telegram_response jsonb,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index telegram_outbox_worker_idx
  on support.telegram_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'retry');

create table support.audit_logs (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('system', 'telegram_user', 'support_agent', 'database')),
  actor_telegram_id bigint,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx
  on support.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx
  on support.audit_logs (actor_telegram_id, created_at desc)
  where actor_telegram_id is not null;
create index audit_logs_command_update_idx
  on support.audit_logs (action, ((metadata ->> 'updateId')))
  where metadata ? 'updateId';

create or replace function support.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'support.audit_logs is append-only';
end;
$$;

create trigger audit_logs_prevent_update_delete
before update or delete on support.audit_logs
for each row execute function support.prevent_audit_log_mutation();

create or replace function support.audit_conversation_transition()
returns trigger
language plpgsql
security definer
set search_path = support, pg_temp
as $$
begin
  if old.status is distinct from new.status
     or old.assigned_agent_id is distinct from new.assigned_agent_id
     or old.message_thread_id is distinct from new.message_thread_id then
    insert into support.audit_logs (
      actor_type,
      action,
      entity_type,
      entity_id,
      before_state,
      after_state
    ) values (
      'database',
      'conversation_transition',
      'support_conversation',
      new.id::text,
      jsonb_build_object(
        'status', old.status,
        'assigned_agent_id', old.assigned_agent_id,
        'message_thread_id', old.message_thread_id,
        'version', old.version
      ),
      jsonb_build_object(
        'status', new.status,
        'assigned_agent_id', new.assigned_agent_id,
        'message_thread_id', new.message_thread_id,
        'version', new.version
      )
    );
  end if;
  return new;
end;
$$;

create trigger support_conversations_audit_transition
after update on support.support_conversations
for each row execute function support.audit_conversation_transition();

create trigger telegram_users_set_updated_at
before update on support.telegram_users
for each row execute function support.set_updated_at();
create trigger support_agents_set_updated_at
before update on support.support_agents
for each row execute function support.set_updated_at();
create trigger support_conversations_set_updated_at
before update on support.support_conversations
for each row execute function support.set_updated_at();
create trigger telegram_updates_set_updated_at
before update on support.telegram_updates
for each row execute function support.set_updated_at();
create trigger support_messages_set_updated_at
before update on support.support_messages
for each row execute function support.set_updated_at();
create trigger telegram_outbox_set_updated_at
before update on support.telegram_outbox
for each row execute function support.set_updated_at();

alter table support.telegram_users enable row level security;
alter table support.support_agents enable row level security;
alter table support.support_conversations enable row level security;
alter table support.conversation_assignments enable row level security;
alter table support.telegram_updates enable row level security;
alter table support.support_messages enable row level security;
alter table support.telegram_outbox enable row level security;
alter table support.audit_logs enable row level security;

-- The support schema is backend-only. No anon/authenticated policies are created.
-- Direct DATABASE_URL connections must use the database owner or a separately provisioned
-- BYPASSRLS backend role. Supabase service_role bypasses RLS and must never reach browser code.
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
