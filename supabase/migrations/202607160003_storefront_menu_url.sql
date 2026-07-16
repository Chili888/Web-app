with updated_settings as (
  update support.bot_settings
  set mini_app_url = 'https://chili888.github.io/Web-app/',
      updated_at = now(),
      version = version + 1
  where id = true
    and trim(mini_app_url) = ''
  returning version
)
insert into support.audit_logs (
  actor_type,
  action,
  entity_type,
  entity_id,
  after_state,
  metadata
)
select
  'database',
  'bot_settings_storefront_url_initialized',
  'bot_settings',
  'default',
  jsonb_build_object('version', version, 'miniAppUrlConfigured', true),
  jsonb_build_object('migration', '202607160003_storefront_menu_url.sql')
from updated_settings;
