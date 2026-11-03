import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { connectPg } from "../src/pg-client.js";
import { applyConnectDbPgMigrations } from "../src/migrate.js";

interface TableSpec {
  name: string;
  key: string[];
  booleans?: string[];
  ignore?: string[];
  unmirrored?: boolean;
}

const PRESENCE_COLUMNS = [
  "last_seen_at",
  "next_tunnel_gate",
  "next_tunnel_region",
  "next_tunnel_at",
];

const TABLES: TableSpec[] = [
  { name: "user", key: ["id"], booleans: ["email_verified"] },
  { name: "profile", key: ["user_id"] },
  { name: "server", key: ["id"], ignore: PRESENCE_COLUMNS },
  { name: "machine", key: ["id"], ignore: PRESENCE_COLUMNS },
  { name: "label_claim", key: ["label"] },
  { name: "session", key: ["id"] },
  { name: "account", key: ["id"] },
  { name: "verification", key: ["id"] },
  { name: "connect_code", key: ["code"] },
  { name: "audit_log", key: ["id"] },
  { name: "ai_usage_day", key: ["user_id", "day"] },
  { name: "ai_request_log", key: ["id"], unmirrored: true },
  { name: "oauth_grant", key: ["id"] },
  { name: "oauth_code", key: ["code_hash"] },
  { name: "oauth_refresh_token", key: ["token_hash"] },
];

type Row = Record<string, unknown>;

const LABEL_SOURCE_TABLES = ["profile", "server", "machine"];

const { values: args } = parseArgs({
  options: {
    d1: { type: "string" },
    "wrangler-cwd": { type: "string" },
    "pg-url-file": { type: "string" },
    action: { type: "string", default: "check" },
    from: { type: "string", default: "d1" },
    tables: { type: "string" },
    "include-unmirrored": { type: "boolean", default: false },
  },
});

function required(name: keyof typeof args): string {
  const value = args[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

const d1Name = required("d1");
const wranglerCwd = required("wrangler-cwd");
const pgUrl = readFileSync(required("pg-url-file"), "utf8").trim();
const action = args.action;
if (!["migrate", "check", "backfill", "repair"].includes(action ?? "")) {
  throw new Error("--action must be migrate, check, backfill or repair");
}
const from = args.from === "pg" ? "pg" : "d1";
const selected = args.tables?.split(",") ?? null;
const tables = TABLES.filter(
  (table) =>
    (selected === null || selected.includes(table.name)) &&
    (!table.unmirrored || args["include-unmirrored"] || selected !== null),
);

function wrangler(argv: string[], attempts = 3): string {
  try {
    return execFileSync("pnpm", ["exec", "wrangler", ...argv], {
      cwd: wranglerCwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (attempts <= 1) throw error;
    return wrangler(argv, attempts - 1);
  }
}

function d1Query(sql: string): Row[] {
  const output = wrangler([
    "d1",
    "execute",
    d1Name,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const parsed = JSON.parse(output) as { results: Row[] }[];
  return parsed.flatMap((entry) => entry.results);
}

function d1ExecFile(statements: string[]): void {
  if (statements.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), "connect-db-sync-"));
  const file = join(dir, "repair.sql");
  writeFileSync(file, `${statements.join(";\n")};\n`);
  wrangler(["d1", "execute", d1Name, "--remote", "--yes", "--file", file]);
}

const PAGE = 2_000;

function readD1(table: TableSpec): Row[] {
  const rows: Row[] = [];
  let after = 0;
  for (;;) {
    const page = d1Query(
      `SELECT rowid AS "__rowid", * FROM "${table.name}" WHERE rowid > ${after} ORDER BY rowid LIMIT ${PAGE}`,
    );
    for (const row of page) {
      after = Number(row.__rowid);
      delete row.__rowid;
      rows.push(row);
    }
    if (page.length < PAGE) return rows;
  }
}

const pg = connectPg(pgUrl);

async function readPg(table: TableSpec): Promise<Row[]> {
  const result = await pg.queryArrays(
    `SELECT row_to_json(t)::text FROM "${table.name}" t`,
    [],
  );
  return result.rows.map((row) => JSON.parse(String(row[0])) as Row);
}

function canonical(table: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (table.ignore?.includes(column)) continue;
    if (table.booleans?.includes(column) && value !== null) {
      out[column] = value === true || value === 1 || value === "1" ? 1 : 0;
    } else {
      out[column] = value;
    }
  }
  return out;
}

function keyOf(table: TableSpec, row: Row): string {
  return JSON.stringify(table.key.map((column) => row[column]));
}

interface Diff {
  missing: Row[];
  changed: Row[];
  extra: Row[];
}

function diff(table: TableSpec, source: Row[], target: Row[]): Diff {
  const targetByKey = new Map(target.map((row) => [keyOf(table, row), row]));
  const sourceKeys = new Set<string>();
  const missing: Row[] = [];
  const changed: Row[] = [];
  for (const row of source) {
    const key = keyOf(table, row);
    sourceKeys.add(key);
    const other = targetByKey.get(key);
    if (other === undefined) missing.push(row);
    else if (
      JSON.stringify(canonical(table, row)) !==
      JSON.stringify(canonical(table, other))
    ) {
      changed.push(row);
    }
  }
  const extra = target.filter((row) => !sourceKeys.has(keyOf(table, row)));
  return { missing, changed, extra };
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upsertSql(
  table: TableSpec,
  row: Row,
  dialect: "sqlite" | "pg",
  onConflict: "update" | "nothing",
): { text: string; params: unknown[] } {
  const columns = Object.keys(row);
  const quoted = columns.map((column) => `"${column}"`).join(", ");
  const conflict = table.key.map((column) => `"${column}"`).join(", ");
  const updates = columns
    .filter((column) => !table.key.includes(column))
    .map((column) => `"${column}" = excluded."${column}"`)
    .join(", ");
  const tail =
    onConflict === "nothing" || updates === ""
      ? `ON CONFLICT (${conflict}) DO NOTHING`
      : `ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
  if (dialect === "sqlite") {
    const values = columns.map((column) => sqliteLiteral(row[column]));
    return {
      text: `INSERT INTO "${table.name}" (${quoted}) VALUES (${values.join(", ")}) ${tail}`,
      params: [],
    };
  }
  const values = columns.map((column) => {
    const value = row[column];
    if (table.booleans?.includes(column) && typeof value === "number") {
      return value === 1;
    }
    return value;
  });
  return {
    text: `INSERT INTO "${table.name}" (${quoted}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) ${tail}`,
    params: values,
  };
}

function deleteSql(
  table: TableSpec,
  row: Row,
  dialect: "sqlite" | "pg",
): { text: string; params: unknown[] } {
  if (dialect === "sqlite") {
    const where = table.key
      .map((column) => `"${column}" = ${sqliteLiteral(row[column])}`)
      .join(" AND ");
    return { text: `DELETE FROM "${table.name}" WHERE ${where}`, params: [] };
  }
  const where = table.key
    .map((column, i) => `"${column}" = $${i + 1}`)
    .join(" AND ");
  return {
    text: `DELETE FROM "${table.name}" WHERE ${where}`,
    params: table.key.map((column) => row[column]),
  };
}

async function main(): Promise<void> {
  if (action === "migrate") {
    const applied = await applyConnectDbPgMigrations(pg);
    console.log(JSON.stringify({ applied }));
    return;
  }
  const report: Record<
    string,
    {
      source: number;
      target: number;
      missing: number;
      changed: number;
      extra: number;
    }
  > = {};
  const diffs = new Map<string, Diff>();
  for (const table of tables) {
    const d1Rows = readD1(table);
    const pgRows = await readPg(table);
    const [source, target] =
      from === "d1" ? [d1Rows, pgRows] : [pgRows, d1Rows];
    const result = diff(table, source, target);
    diffs.set(table.name, result);
    report[table.name] = {
      source: source.length,
      target: target.length,
      missing: result.missing.length,
      changed: result.changed.length,
      extra: result.extra.length,
    };
  }
  console.log(`${action} from ${from}`);
  for (const [name, counts] of Object.entries(report)) {
    const drift = counts.missing + counts.changed + counts.extra;
    console.log(
      `${drift === 0 ? "ok   " : "DRIFT"} ${name.padEnd(20)} source=${counts.source} target=${counts.target} missing=${counts.missing} changed=${counts.changed} extra=${counts.extra}`,
    );
  }
  if (action === "check") return;

  const targetDialect = from === "d1" ? "pg" : "sqlite";
  const onConflict = action === "backfill" ? "nothing" : "update";
  const statements: { text: string; params: unknown[] }[] = [];
  if (action === "repair") {
    for (const table of [...tables].reverse()) {
      for (const row of diffs.get(table.name)?.extra ?? []) {
        statements.push(deleteSql(table, row, targetDialect));
      }
    }
  }
  for (const table of tables) {
    const result = diffs.get(table.name);
    if (!result) continue;
    const rows =
      action === "backfill" && table.name !== "label_claim"
        ? result.missing
        : [...result.missing, ...result.changed];
    for (const row of rows) {
      statements.push(
        upsertSql(
          table,
          row,
          targetDialect,
          table.name === "label_claim" ? "update" : onConflict,
        ),
      );
    }
  }
  if (targetDialect === "sqlite") {
    d1ExecFile(statements.map((statement) => statement.text));
  } else {
    await pg.queryArrays("BEGIN", []);
    try {
      for (const table of LABEL_SOURCE_TABLES) {
        await pg.queryArrays(`ALTER TABLE "${table}" DISABLE TRIGGER USER`, []);
      }
      for (const statement of statements) {
        await pg.queryArrays(statement.text, statement.params);
      }
      for (const table of LABEL_SOURCE_TABLES) {
        await pg.queryArrays(`ALTER TABLE "${table}" ENABLE TRIGGER USER`, []);
      }
      await pg.queryArrays("COMMIT", []);
    } catch (error) {
      await pg.queryArrays("ROLLBACK", []).catch(() => undefined);
      throw error;
    }
  }
  console.log(JSON.stringify({ wrote: statements.length }));
}

try {
  await main();
} finally {
  await pg.close();
}
