import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {databasePoolConfig, databaseSslMode} from "../src/database.js";

const TEST_CA = Buffer.from(
  "-----BEGIN CERTIFICATE-----\ntest-certificate\n-----END CERTIFICATE-----\n"
).toString("base64");

describe("PostgreSQL TLS configuration", () => {
  it("defaults Supabase connections to verify-full", () => {
    assert.equal(databaseSslMode("aws-0-ap-southeast-2.pooler.supabase.com", undefined), "verify-full");
  });

  it("rejects a Supabase connection without its CA certificate", () => {
    assert.throws(
      () => databasePoolConfig("postgresql://user:password@project.pooler.supabase.com:5432/postgres", {}, {}),
      /DATABASE_SSL_CA_BASE64/
    );
  });

  it("uses certificate verification and removes URL SSL overrides", () => {
    const config = databasePoolConfig(
      "postgresql://user:password@project.pooler.supabase.com:5432/postgres?sslmode=require",
      {max: 2},
      {DATABASE_SSL_CA_BASE64: TEST_CA}
    );
    assert.equal(config.max, 2);
    assert.equal(String(config.connectionString).includes("sslmode"), false);
    assert.deepEqual(config.ssl, {
      ca: "-----BEGIN CERTIFICATE-----\ntest-certificate\n-----END CERTIFICATE-----\n",
      rejectUnauthorized: true
    });
  });

  it("keeps local PostgreSQL connections unencrypted by default", () => {
    const config = databasePoolConfig("postgresql://user:password@db:5432/postgres", {}, {});
    assert.equal(config.ssl, false);
  });
});
