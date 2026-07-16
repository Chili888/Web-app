import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {withoutOuterTransaction} from "../src/cli/migration-sql.js";

describe("migration SQL execution", () => {
  it("removes a migration-owned outer transaction so the runner remains atomic", () => {
    const sql = "begin;\ncreate table example(id bigint);\ncommit;\n";
    assert.equal(withoutOuterTransaction(sql), "create table example(id bigint);");
  });

  it("leaves transaction-free migration SQL unchanged", () => {
    const sql = "create table example(id bigint);\n";
    assert.equal(withoutOuterTransaction(sql), sql);
  });
});
