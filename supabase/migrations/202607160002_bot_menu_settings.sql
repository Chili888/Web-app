alter table support.bot_settings
  add column if not exists why_us_message text not null default '💎 为什么选择我们？

1️⃣ 真实卖家，长期稳定

本地长期经营，商品信息真实，沟通直接，重视长期合作。

2️⃣ 品质稳定，严格筛选

商品均经过筛选，商品详情、规格、价格及展示状态以实际确认为准。

3️⃣ 响应迅速，沟通方便

商品介绍、购买说明和配送说明清晰，有问题可以直接联系客服。',
  add column if not exists stock_message text not null default '📋 现货咨询

具体商品、规格、价格和库存会随时调整。

您可以直接把以下信息发给我们：

• 想了解的商品
• 需要的数量
• 大概位置
• 希望的时间
• 其他疑问

客服看到后会尽快回复。',
  add column if not exists trade_rules_message text not null default '🤝 交易必看

购买说明：商品信息、规格和价格以客服最终确认为准。

支付说明：付款方式和金额请与客服确认，不要向非官方账号付款。

配送说明：配送范围、时间和费用请在购买前确认。

售后说明：收到商品后如有问题，请及时保留凭证并联系客服。

注意事项：Mini App 仅用于商品展示，不在应用内完成支付。',
  add column if not exists contact_message text not null default '请直接把您的需求、数量、大概位置或疑问顾虑发在下面，我们会尽快回复您：',
  add column if not exists menu_buttons jsonb not null default '[
    {"key":"why_us","label":"💎 为什么选择我们？","visible":true,"position":10},
    {"key":"stock","label":"📋 现货咨询","visible":true,"position":20},
    {"key":"trade_rules","label":"🤝 交易必看","visible":true,"position":30},
    {"key":"contact","label":"🙋 联系客服","visible":true,"position":40},
    {"key":"mini_app","label":"🛍 进入商城","visible":true,"position":50},
    {"key":"channel","label":"📢 关注频道","visible":true,"position":60}
  ]'::jsonb,
  add column if not exists version integer not null default 1 check (version > 0);

update support.bot_settings
set welcome_message = '⚡ 欢迎，{客户名称}！

👑【天津品质天花板】

📍 本地真实卖家｜长期供货｜极速配送

主营靠谱和长期供货，只做品质，只出精品。

👇 请通过下方菜单了解我们：'
where welcome_message in (
  '欢迎联系人工客服，请直接发送您的问题。',
  '欢迎联系人工客服'
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'support.bot_settings'::regclass
      and conname = 'bot_settings_menu_buttons_array'
  ) then
    alter table support.bot_settings
      add constraint bot_settings_menu_buttons_array
      check (jsonb_typeof(menu_buttons) = 'array');
  end if;
end;
$$;

alter table support.telegram_admin_message_routes
  add column if not exists route_type text not null default 'customer_content';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'support.telegram_admin_message_routes'::regclass
      and conname = 'telegram_admin_routes_type_check'
  ) then
    alter table support.telegram_admin_message_routes
      add constraint telegram_admin_routes_type_check
      check (route_type in ('customer_summary', 'customer_content', 'customer_media', 'customer_start'));
  end if;
end;
$$;

alter table support.bot_auto_reply_rules
  add column if not exists version integer not null default 1 check (version > 0);

comment on column support.telegram_admin_message_routes.route_type is
  'Identifies whether the administrator may reply to a customer summary, copied content, media, or start notice.';

do $$
begin
  if to_regclass('support.orders') is not null then
    comment on table support.orders is
      'DEPRECATED/INACTIVE: retained without data deletion; the Mini App is display-only and does not create orders.';
  end if;
  if to_regclass('support.payment_records') is not null then
    comment on table support.payment_records is
      'DEPRECATED/INACTIVE: retained without data deletion; no payment workflow is active.';
  end if;
  if to_regclass('support.order_deliveries') is not null then
    comment on table support.order_deliveries is
      'DEPRECATED/INACTIVE: retained without data deletion; no automatic delivery workflow is active.';
  end if;
end;
$$;
