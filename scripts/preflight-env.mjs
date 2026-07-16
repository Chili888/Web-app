const required = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_IDS",
  "TELEGRAM_MAIN_CHANNEL",
  "TELEGRAM_DISCUSSION_GROUP",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "APP_BASE_URL",
  "STOREFRONT_ORIGINS"
];

const missing = required.filter((name) => !process.env[name]?.trim());
const invalid = [];

validateHttpsUrl("APP_BASE_URL", false);
validateOrigins();
validateInternalDatabaseUrl();

if (missing.length || invalid.length) {
  if (missing.length) process.stderr.write(`Missing environment variables: ${missing.join(", ")}\n`);
  if (invalid.length) process.stderr.write(`Invalid environment variables: ${invalid.join(", ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Production environment preflight passed (values not displayed).\n");
}

function validateHttpsUrl(name, originOnly) {
  const value = process.env[name]?.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (originOnly && url.origin !== value.replace(/\/$/, ""))) invalid.push(name);
  } catch {
    invalid.push(name);
  }
}

function validateInternalDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol)
      || url.hostname !== "db"
      || url.port !== "5432"
      || url.pathname !== `/${process.env.POSTGRES_DB}`
      || decodeURIComponent(url.username) !== process.env.POSTGRES_USER
      || decodeURIComponent(url.password) !== process.env.POSTGRES_PASSWORD
    ) invalid.push("DATABASE_URL");
  } catch {
    invalid.push("DATABASE_URL");
  }
}

function validateOrigins() {
  const origins = process.env.STOREFRONT_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) || [];
  if (!origins.length) return;
  for (const value of origins) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin !== value.replace(/\/$/, "")) invalid.push("STOREFRONT_ORIGINS");
    } catch {
      invalid.push("STOREFRONT_ORIGINS");
    }
  }
}
