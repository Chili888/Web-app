export function withoutOuterTransaction(sql: string): string {
  const withoutBegin = sql.replace(/^\s*begin\s*;\s*/iu, "");
  return withoutBegin.replace(/\s*commit\s*;\s*$/iu, "");
}
