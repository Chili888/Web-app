import {Buffer} from "node:buffer";

const required = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_IDS",
  "TELEGRAM_MAIN_CHANNEL",
  "TELEGRAM_DISCUSSION_GROUP",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "DATABASE_SSL_CA_BASE64",
  "APP_BASE_URL",
  "STOREFRONT_ORIGIN"
];

const missing = required.filter((name) => !process.env[name]?.trim());
const invalid = [];

validateHttpsUrl("APP_BASE_URL", false);
validateHttpsUrl("STOREFRONT_ORIGIN", true);
validateSupabaseDatabaseUrl();
validateDatabaseSsl();

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

function validateSupabaseDatabaseUrl() {
  const value = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol)
      || !url.hostname.endsWith(".pooler.supabase.com")
      || url.port !== "5432"
      || url.pathname !== "/postgres"
    ) invalid.push("SUPABASE_DATABASE_URL");
  } catch {
    invalid.push("SUPABASE_DATABASE_URL");
  }
}

function validateDatabaseSsl() {
  const mode = process.env.DATABASE_SSL_MODE?.trim().toLowerCase() || "verify-full";
  if (mode !== "verify-full") invalid.push("DATABASE_SSL_MODE");
  const encodedCa = process.env.DATABASE_SSL_CA_BASE64?.trim();
  if (!encodedCa) return;
  const ca = Buffer.from(encodedCa, "base64").toString("utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    invalid.push("DATABASE_SSL_CA_BASE64");
  }
}
