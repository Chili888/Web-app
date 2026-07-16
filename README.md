# TJ Telegram Center

Telegram Mini App 商品前台、商品管理页面和 Telegram 运营后端。后端只使用 Telegram Bot API，采用 Webhook、PostgreSQL 队列、Worker、Outbox、重试和 dead-letter。

正式 Mini App 地址为 `https://bot.cverseintl.cloud/`，管理后台为 `https://bot.cverseintl.cloud/admin/`。GitHub Pages 仅作为临时回滚入口。

## 当前能力

- 保留原有静态商品前台、分类、搜索、多图、推荐、选品清单、分享和客服入口。
- 保留原有 `admin/` 商品与分类管理页面及 Supabase RLS。
- 客户私聊机器人后，资料摘要和原消息直接发送到 `TELEGRAM_ADMIN_IDS`。
- 管理员回复机器人转来的资料或内容消息，即可回复对应客户；路由持久化，重启不丢失。
- 支持文字、图片、视频、语音、音频、文件、动画、贴纸、视频消息、联系人、位置、地点、投票和骰子。
- 支持欢迎语、帮助信息、关键词自动回复和 Mini App/频道/讨论群按钮。
- 讨论群新人关注频道验证，支持实时 `getChatMember`、幂等 callback、超时 kick/ban/mute/none。
- 频道数据库定时任务支持文字、单媒体、媒体组、置顶、并发锁、失败重试和 dead-letter。
- 频道管理 API 和中文后台支持草稿、立即/定时发布、已发布正文/caption 编辑、媒体组完整删除、置顶、取消置顶、条件版本和失败重试。
- 讨论群支持关键词/链接规则、仅记录、逐级警告/禁言/封禁、人工禁言/解禁/移出/封禁/解封，并跳过管理员、自动转发和白名单。
- Webhook Secret、Update 幂等、Outbox、429 `retry_after`、5xx重试、dead-letter、单条手动重试和审计。
- 服务端 Telegram Mini App `initData` HMAC及时效验证器。

不再使用内部客服群、Forum话题、`message_thread_id` 或认领/关闭工单命令。讨论群只用于社区消息和入群验证，绝不接收客户私聊内容。

## 目录

```text
apps/bot-backend/src/       Webhook、Worker、Telegram gateway、Store和安全校验
apps/bot-backend/test/      fake Telegram单测及可选 PostgreSQL集成测试
supabase/migrations/        兼容、非破坏性后端 migration
assets/ admin/              原有静态商城和商品后台
deploy/frontend/            服务器静态前端镜像配置
deploy/1panel/              1Panel/OpenResty同域路由示例
```

## 检查命令

宿主机无需安装 Node.js，可使用 Docker：

```bash
docker build --target build -t tj-telegram-center:check .
docker run --rm tj-telegram-center:check npm run lint
docker run --rm tj-telegram-center:check npm run typecheck
docker run --rm tj-telegram-center:check npm test
```

`npm test` 使用内存 Store和 fake Telegram adapter，不请求真实 Bot API。真实数据库测试使用独立的临时 PostgreSQL，不读取 `.env`，测试结束后删除容器和临时卷：

```bash
docker compose -p tj-telegram-integration -f docker-compose.integration.yml up --build --abort-on-container-exit --exit-code-from integration-test integration-test
docker compose -p tj-telegram-integration -f docker-compose.integration.yml down --volumes --remove-orphans
```

## 配置迁移

复制 `.env.example` 到被忽略的 `.env`。新部署使用：

```text
TELEGRAM_ADMIN_IDS
TELEGRAM_MAIN_CHANNEL
TELEGRAM_DISCUSSION_GROUP
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS
STOREFRONT_ORIGINS
APP_TIMEZONE
JOIN_VERIFY_ENABLED
JOIN_VERIFY_TIMEOUT_SECONDS
JOIN_VERIFY_TIMEOUT_ACTION
AUTO_REPLY_ENABLED
```

`STOREFRONT_ORIGINS` 是逗号分隔的精确来源列表，不能包含路径。正式入口使用 `https://bot.cverseintl.cloud`；回滚窗口期间可同时保留 `https://chili888.github.io`。`STOREFRONT_ORIGIN` 仅作旧版单来源兼容。

`SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 用于后端调用 Supabase Auth 验证现有后台登录会话；它们是公开项目配置，不是 `service_role`。后端随后还会查询 `public.admin_profiles`，因此仅持有普通 Supabase 账号不能调用运营 API。

API、Worker和 migration CLI使用 Compose内部 PostgreSQL，连接目标固定为 `db:5432/postgres`。数据库不映射宿主机或公网端口，数据保存在命名卷 `support-db-data`。`DATABASE_URL` 的账号、密码必须与 `POSTGRES_USER`、`POSTGRES_PASSWORD` 一致；真实值只保存在服务器 `.env`。

`TELEGRAM_AGENT_ALLOWLIST` 仅作为 `TELEGRAM_ADMIN_IDS` 的兼容回退。以下旧变量不再读取：

```text
TELEGRAM_SUPPORT_GROUP_ID
CLOSED_CONVERSATION_POLICY
```

不要把 Bot Token、Webhook Secret、`DATABASE_URL` 或 service role key写入浏览器代码、日志或 Git。

## 数据库

Migration不会自动执行，也不得在未审核时连接生产数据库：

```bash
npm run migrate
```

执行 migration 前先运行只读结构审计；它只读取 schema、表名、商品列和 migration 名称，不读取商品、订单或消息行：

```bash
npm run db:audit
```

`202607150002_telegram_operations.sql` 新增客户、消息路由、自动回复、机器人/入群设置、白名单、入群验证、群治理、频道任务和 Worker心跳表。验证文案、超时时间及动作可通过 `support.bot_settings` 覆盖；环境变量仍是部署级总开关。旧 Forum表不删除，只添加 `DEPRECATED` 注释，便于回滚和后续数据保留期清理。

`202607150003_commerce_foundation.sql` 曾无损扩展 `public.products` 并创建订单相关基础表。最终产品定位已调整为展示型商城：这些表仅为保留数据和回滚而存在，不再由运行时代码或浏览器 API 读写。`202607160002_bot_menu_settings.sql` 会将其标记为 `DEPRECATED/INACTIVE`，不会删除任何行。

`202607160002_bot_menu_settings.sql` 新增可动态编辑的欢迎菜单文案、六个按钮配置、管理员回复路由类型和自动回复规则版本。它只增加列、约束和注释，不删除旧 Forum、商品或历史业务数据。

`202607160001_channel_operations.sql` 新增频道编辑/删除/置顶任务、媒体组 message ID 列表、群治理设置、规则版本和人工成员操作队列。所有表仅供后端数据库角色访问，浏览器角色被显式撤销权限。

项目 migration runner使用 `support.schema_migrations` 和 SHA-256校验。同一 migration不要再通过 Supabase SQL Editor或 `supabase db push` 重复执行。

单条 dead-letter Outbox任务经审核后可手动重试：

```bash
npm run outbox:retry -- PLACEHOLDER_OUTBOX_UUID
```

命令只重置指定 UUID并写入 `audit_logs`，不会批量清理死信。

## 本地运行

```bash
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose up -d api worker
docker compose ps
```

## 生产 Compose

生产环境使用 Compose内部 PostgreSQL和持久卷。先备份 `support-db-data`，再执行只检查变量名和格式、不会输出变量值的预检：

```bash
docker run --rm --env-file .env tj-telegram-center:local npm run deploy:check
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d db
docker compose -f docker-compose.production.yml up -d api worker frontend
docker compose -f docker-compose.production.yml ps
```

本轮服务器托管切换不执行 migration。只有确认 Docker PostgreSQL 的 `support.schema_migrations` 与当前代码兼容、完成备份并单独审核后，才允许人工运行 migration。API仅监听 `127.0.0.1:3000`，静态前端仅监听 `127.0.0.1:8080`，数据库和 Worker不映射端口。

将 [`deploy/1panel/bot.cverseintl.cloud.locations.conf`](deploy/1panel/bot.cverseintl.cloud.locations.conf) 中的 location配置加入现有 1Panel HTTPS网站：`/api/`、`/telegram/webhook` 和 `/health` 转发到 API，其余路径转发到静态前端。修改 OpenResty前先备份网站配置并执行配置检查；不要改 DNS或 Webhook。

服务器前端镜像使用 [`deploy/frontend/config.production.js`](deploy/frontend/config.production.js)，其 `pageUrl` 和 `apiBaseUrl` 均为 `bot.cverseintl.cloud`。Mini App 正式 URL 已切换到该域名。仓库根目录的 `config.js` 保持 GitHub Pages地址，仅用于临时回滚。

回滚时恢复旧 OpenResty配置，使 `/` 重新指向 API或旧入口；再用上一 API/Worker镜像标签重新创建容器。不要执行 `docker compose down -v`，也不要删除 `support-db-data`。

API：

```text
GET  /health
POST /telegram/webhook
GET  /api/admin/bot/settings
PATCH /api/admin/bot/settings
GET  /api/admin/bot/auto-replies
POST /api/admin/bot/auto-replies
PATCH /api/admin/bot/auto-replies/:id
```

管理员频道接口使用 `X-Telegram-Init-Data` 验证 Telegram 身份。所有写请求还必须提供唯一的 `X-Idempotency-Key`：

```text
GET   /api/admin/channel-posts
POST  /api/admin/channel-posts
PATCH /api/admin/channel-posts/:id
POST  /api/admin/channel-posts/:id/cancel
POST  /api/admin/channel-posts/:id/retry
POST  /api/admin/channel-posts/:id/actions
GET   /api/admin/group/moderation-settings
PATCH /api/admin/group/moderation-settings
GET   /api/admin/group/moderation-rules
POST  /api/admin/group/moderation-rules
PATCH /api/admin/group/moderation-rules/:id
POST  /api/admin/group/members/:userId/actions
```

创建正文示例只包含非敏感业务数据：

```json
{
  "contentType": "text",
  "content": {"text": "频道公告", "pin": true},
  "parseMode": "HTML",
  "scheduledAt": "2026-07-16T04:30:00.000Z",
  "timezone": "Asia/Shanghai"
}
```

将 `scheduledAt` 省略会保存草稿；使用 `publishNow: true` 会由 Worker异步立即发布。更新、取消和重试必须提交当前 `expectedVersion`，冲突返回 HTTP 409。

静态 Mini App 是商品展示目录，提供分类、搜索、筛选、多图高清预览、选品清单、分享和联系客服。它不创建订单，不处理购物车支付、支付记录、物流、自动交付或退款。

`/health` 同时检查数据库和 Worker心跳。Worker使用数据库心跳健康检查，不依赖 HTTP端口。

## Telegram 权限

- 客服管理员只需与机器人建立私聊。
- 机器人在主频道需要查询成员及后续发布所需的管理员权限。
- 机器人在讨论群需要读取消息、限制成员、删除消息和封禁成员权限。
- 入群验证要求机器人能在频道执行 `getChatMember`，在讨论群执行 `restrictChatMember`。

Webhook只在 API、Worker、数据库和 HTTPS都通过验收后由人工设置。本仓库不会自动设置或删除线上 Webhook。

## 明确不启用

- 购物车支付、订单、支付记录、物流、自动交付和退款。
- 内部客服群、Forum话题和复杂客服工单状态流。

旧表和历史 migration 为数据保留与回滚而存在；不得据此重新开放浏览器接口。重复消息指纹、刷屏频率检测和完整群治理统计页面仍需后续完善。

## 已知非阻塞项

- Docker PostgreSQL 中保留 8 条历史 `telegram_updates` dead-letter，原因是旧版 `timestamptz < interval` 参数推断错误。不自动重试或清理这些历史记录。
- Supabase 分类批量迁移和商品排序未来可改为 RPC/数据库事务，当前不是生产阻塞项。
- 独立安全优化建议：在 1Panel/OpenResty 中关闭 TLS 1.0/1.1，仅保留 TLS 1.2/1.3；本项不属于应用代码变更。
