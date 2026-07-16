import {Buffer} from "node:buffer";
import pg from "pg";

export function createDatabasePool(connectionString, overrides = {}, env = process.env) {
  const url = parseDatabaseUrl(connectionString);
  const configuredMode = env.DATABASE_SSL_MODE?.trim().toLowerCase();
  const mode = configuredMode || (url.hostname.endsWith(".supabase.com") ? "verify-full" : "disable");
  if (!["disable", "require", "verify-full"].includes(mode)) {
    throw new Error("DATABASE_SSL_MODE must be disable, require, or verify-full");
  }

  let ssl = false;
  if (mode === "require") ssl = {rejectUnauthorized: false};
  if (mode === "verify-full") {
    const encodedCa = env.DATABASE_SSL_CA_BASE64?.trim();
    if (!encodedCa) throw new Error("DATABASE_SSL_CA_BASE64 is required when DATABASE_SSL_MODE is verify-full");
    const ca = Buffer.from(encodedCa, "base64").toString("utf8");
    if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
      throw new Error("DATABASE_SSL_CA_BASE64 must contain a base64-encoded PEM certificate");
    }
    ssl = {ca, rejectUnauthorized: true};
  }

  return new pg.Pool({...overrides, connectionString: url.toString(), ssl});
}

function parseDatabaseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(name);
  return url;
}
