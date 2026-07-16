do $$
begin
  if to_regclass('public.products') is not null then
    execute $ddl$alter table public.products
      add column if not exists price_minor bigint check (price_minor is null or price_minor >= 0),
      add column if not exists currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
      add column if not exists inventory_count integer check (inventory_count is null or inventory_count >= 0),
      add column if not exists unlimited_inventory boolean not null default true,
      add column if not exists sales_count bigint not null default 0 check (sales_count >= 0),
      add column if not exists product_type text not null default 'physical'
        check (product_type in ('physical', 'digital')),
      add column if not exists purchase_instructions text not null default '',
      add column if not exists after_sales_instructions text not null default '',
      add column if not exists deleted_at timestamptz$ddl$;

    execute 'create index if not exists products_storefront_idx
      on public.products (is_active, deleted_at, sort_order, id)';
    execute 'create index if not exists products_inventory_idx
      on public.products (inventory_count, id)
      where is_active = true and deleted_at is null and unlimited_inventory = false';
    execute 'drop policy if exists "public can view active products" on public.products';
    execute 'create policy "public can view active products"
      on public.products for select to anon, authenticated
      using ((is_active = true and deleted_at is null) or public.is_admin())';
  end if;
end;
$$;

create table if not exists support.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  telegram_user_id bigint not null,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'underpaid', 'overpaid', 'expired', 'refunded', 'manual_review')),
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'processing', 'delivered', 'failed', 'manual_review')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  customer_note text not null default '',
  admin_note text not null default '',
  version integer not null default 1 check (version > 0),
  paid_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id, idempotency_key)
);
create index if not exists orders_customer_created_idx
  on support.orders (telegram_user_id, created_at desc);
create index if not exists orders_admin_search_idx
  on support.orders (status, payment_status, delivery_status, created_at desc);

create table if not exists support.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references support.orders(id) on delete restrict,
  product_id bigint not null,
  product_name text not null,
  product_type text not null check (product_type in ('physical', 'digital')),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  total_minor bigint not null check (total_minor >= 0),
  product_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on support.order_items (order_id, created_at);
create index if not exists order_items_product_idx on support.order_items (product_id, created_at desc);

create table if not exists support.payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references support.orders(id) on delete restrict,
  provider text not null default 'manual',
  provider_transaction_id text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null
    check (status in ('pending', 'paid', 'underpaid', 'overpaid', 'expired', 'refunded', 'failed', 'manual_review')),
  paid_at timestamptz,
  raw_reference jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_records_provider_transaction_idx
  on support.payment_records (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists payment_records_order_idx on support.payment_records (order_id, created_at desc);

create table if not exists support.digital_inventory (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null,
  status text not null default 'available'
    check (status in ('available', 'reserved', 'delivered', 'disabled')),
  content_ciphertext bytea not null,
  content_nonce bytea not null,
  key_version integer not null default 1 check (key_version > 0),
  reserved_order_item_id uuid references support.order_items(id) on delete restrict,
  reserved_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists digital_inventory_available_idx
  on support.digital_inventory (product_id, created_at)
  where status = 'available';

create table if not exists support.order_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references support.orders(id) on delete restrict,
  order_item_id uuid not null references support.order_items(id) on delete restrict,
  inventory_id uuid references support.digital_inventory(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id)
);
create index if not exists order_deliveries_queue_idx
  on support.order_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'failed');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'orders', 'payment_records', 'digital_inventory', 'order_deliveries'
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

alter table support.orders enable row level security;
alter table support.order_items enable row level security;
alter table support.payment_records enable row level security;
alter table support.digital_inventory enable row level security;
alter table support.order_deliveries enable row level security;

revoke all privileges on support.orders from public;
revoke all privileges on support.order_items from public;
revoke all privileges on support.payment_records from public;
revoke all privileges on support.digital_inventory from public;
revoke all privileges on support.order_deliveries from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all privileges on support.orders, support.order_items, support.payment_records,
      support.digital_inventory, support.order_deliveries from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all privileges on support.orders, support.order_items, support.payment_records,
      support.digital_inventory, support.order_deliveries from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all privileges on support.orders, support.order_items, support.payment_records,
      support.digital_inventory, support.order_deliveries to service_role';
  end if;
end;
$$;

comment on column support.digital_inventory.content_ciphertext is
  'Encrypted delivery content only. Plaintext delivery secrets must never be stored in public.products.';
