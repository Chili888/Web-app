import type {PoolConfig} from "pg";

export type DatabaseSslMode = "disable" | "require" | "verify-full";

export function databasePoolConfig(
  connectionString: string,
  overrides: Omit<PoolConfig, "connectionString" | "ssl"> = {},
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  const url = parseDatabaseUrl(connectionString);
  const mode = databaseSslMode(url.hostname, env.DATABASE_SSL_MODE);

  return {
    ...overrides,
    connectionString: url.toString(),
    ssl: sslConfig(mode, env.DATABASE_SSL_CA_BASE64)
  };
}

export function databaseSslMode(hostname: string, configuredMode: string | undefined): DatabaseSslMode {
  const candidate = configuredMode?.trim().toLowerCase();
  if (candidate) {
    if (candidate === "disable" || candidate === "require" || candidate === "verify-full") return candidate;
    throw new Error("DATABASE_SSL_MODE must be disable, require, or verify-full");
  }
  return hostname.endsWith(".supabase.com") ? "verify-full" : "disable";
}

function parseDatabaseUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  // URL SSL parameters can silently replace the explicit node-postgres TLS object.
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(name);
  return url;
}

function sslConfig(mode: DatabaseSslMode, encodedCa: string | undefined): PoolConfig["ssl"] {
  if (mode === "disable") return false;
  if (mode === "require") return {rejectUnauthorized: false};

  const ca = decodeCa(encodedCa);
  return {ca, rejectUnauthorized: true};
}

function decodeCa(encodedCa: string | undefined): string {
  const candidate = encodedCa?.trim();
  if (!candidate) throw new Error("DATABASE_SSL_CA_BASE64 is required when DATABASE_SSL_MODE is verify-full");
  const ca = Buffer.from(candidate, "base64").toString("utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA_BASE64 must contain a base64-encoded PEM certificate");
  }
  return ca;
}
