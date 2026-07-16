# Repository Guidelines

## Project Structure & Module Organization

This repository contains a static storefront plus a TypeScript Telegram support backend using Supabase/PostgreSQL.

- `index.html` defines the public Telegram-friendly storefront.
- `assets/app.js` contains catalog, selection, sharing, and Supabase logic; styles live in `assets/style.css` and the focused media overrides.
- `admin/index.html`, `admin/admin.js`, and `admin/admin.css` implement the authenticated management interface.
- `config.js` supplies public runtime configuration shared by both pages.
- `apps/bot-backend/` contains the webhook API, asynchronous worker, Telegram adapter, and persistence layer.
- `supabase/migrations/` contains versioned support-system migrations; never run them against production without review.
- `supabase-setup.sql` creates the base schema, storage, and RLS policies. Apply `supabase-categories.sql` and `supabase-multi-images.sql` for the corresponding upgrades.
- `后台配置说明.md` documents deployment and administrator setup.

Backend tests live under `apps/bot-backend/test/`; generated output is written to `dist/` and `dist-test/`.

## Build, Test, and Development Commands

Install the backend toolchain with `npm ci`. Key checks are:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Serve the unchanged static storefront over HTTP rather than opening files directly:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/` for the storefront and `http://localhost:8000/admin/` for administration. Run SQL scripts in the Supabase SQL Editor, in the order listed above. Use `git diff --check` before committing to catch whitespace errors.

## Coding Style & Naming Conventions

Preserve the existing conventions: two-space indentation in HTML and JavaScript, semicolons and double quotes in JavaScript, and compact CSS declarations. Use `camelCase` for JavaScript functions and variables, `UPPER_SNAKE_CASE` for constants, kebab-case for CSS classes, and `snake_case` for Supabase columns. Keep code browser-native; do not introduce a framework or bundler without a clear repository-wide need. Update asset query-string versions in HTML when cached CSS or JavaScript must be invalidated.

## Testing Guidelines

Backend tests use Node's test runner with in-memory persistence and a fake Telegram adapter; they must never call the real Bot API. Run `npm test`. Also smoke-test both public and admin pages at mobile and desktop widths because the legacy static UI has no browser automation yet.

## Commit & Pull Request Guidelines

Recent commits use concise, imperative subjects such as `Refine storefront layout` and `Add managed categories`. Keep each commit focused. Pull requests should explain user-visible behavior, configuration or SQL migration steps, and manual validation performed. Link related issues and include before/after screenshots for visual changes, covering both mobile and desktop when relevant.

## Security & Configuration

Only commit Supabase anon/publishable credentials in `config.js`; never expose a `service_role` key, Bot Token, Webhook Secret, database password, or private token. Real backend secrets belong in ignored `.env` files or deployment secrets. Preserve and review RLS policies whenever schema access changes.
