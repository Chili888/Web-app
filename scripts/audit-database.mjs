import {createDatabasePool} from "./database-options.mjs";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL is required");

const pool = createDatabasePool(connectionString, {max: 1, connectionTimeoutMillis: 10_000});

try {
  const schemas = await pool.query(
    `select schema_name from information_schema.schemata
     where schema_name in ('public', 'support') order by schema_name`
  );
  const tables = await pool.query(
    `select table_schema, table_name from information_schema.tables
     where table_schema in ('public', 'support') and table_type = 'BASE TABLE'
     order by table_schema, table_name`
  );
  const productColumns = await pool.query(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
     order by ordinal_position`
  );
  const migrationTable = await pool.query("select to_regclass('support.schema_migrations')::text as name");
  const migrations = migrationTable.rows[0]?.name
    ? await pool.query("select name from support.schema_migrations order by name")
    : {rows: []};
  process.stdout.write(`${JSON.stringify({
    schemas: schemas.rows.map((row) => row.schema_name),
    tables: tables.rows.map((row) => `${row.table_schema}.${row.table_name}`),
    productColumns: productColumns.rows,
    migrations: migrations.rows.map((row) => row.name)
  }, null, 2)}\n`);
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
  process.stderr.write(`Database audit failed with PostgreSQL error code: ${code}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
