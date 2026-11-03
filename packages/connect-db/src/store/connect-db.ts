import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { ConnectDb } from "../availability.js";
import { schema } from "../schema.js";
import type { QueryMethod, SqlBackend } from "./backends.js";
import { type StatementShape, statementShape } from "./sqlite-to-pg.js";

export type MirrorFailureStage = "replay" | "label_claim_sync";

export interface MirrorFailure {
  stage: MirrorFailureStage;
  primary: SqlBackend["kind"];
  secondary: SqlBackend["kind"];
  table: string | null;
  error: string;
}

export interface ConnectDbBackends {
  primary: SqlBackend;
  secondary: SqlBackend | null;
}

export interface ConnectDbOptions {
  backends: ConnectDbBackends | (() => Promise<ConnectDbBackends>);
  waitUntil(promise: Promise<unknown>): void;
  onMirrorFailure?(failure: MirrorFailure): void;
}

export interface ConnectDbHandle {
  db: ConnectDb;
  backends(): Promise<ConnectDbBackends>;
  mirrored(): Promise<void>;
}

const LABEL_SOURCE_TABLES = new Set(["profile", "server", "machine"]);
const LABEL_COLUMNS = ['"subdomain"', '"handle"', '"user_id"'];
const LAST_SEEN_ONLY_UPDATE =
  /^\s*update\s+"(server|machine)"\s+set\s+"last_seen_at"\s*=\s*\?\s+where\b/iu;
const RETURNING_CLAUSE = /\sreturning\s/iu;

export function mirrorSkipped(sql: string, shape: StatementShape): boolean {
  if (shape.kind === "read") return true;
  if (shape.kind === "insert" && shape.table === "ai_request_log") return true;
  return LAST_SEEN_ONLY_UPDATE.test(sql);
}

export function changesLabels(sql: string, shape: StatementShape): boolean {
  if (shape.table === null || !LABEL_SOURCE_TABLES.has(shape.table)) {
    return false;
  }
  if (shape.kind !== "update") return true;
  const setStart = sql.search(/\sset\s/iu);
  if (setStart === -1) return true;
  const rest = sql.slice(setStart);
  const setEnd = rest.search(/\s(where|returning)\s/iu);
  const assignments = setEnd === -1 ? rest : rest.slice(0, setEnd);
  return LABEL_COLUMNS.some((column) => assignments.includes(`${column} =`));
}

function withUserIdReturning(sql: string): {
  sql: string;
  appendedColumn: boolean;
} {
  if (RETURNING_CLAUSE.test(sql)) {
    return { sql: `${sql}, "user_id"`, appendedColumn: true };
  }
  return { sql: `${sql} returning "user_id"`, appendedColumn: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function copyLabelGenerations(
  from: SqlBackend,
  to: SqlBackend,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const { rows } = await from.execute(
    `select "label", "kind", "owner_id", "generation" from "label_claim" where "user_id" in (${placeholders(userIds.length)})`,
    userIds,
    "all",
  );
  for (const [label, kind, ownerId, generation] of rows) {
    await to.execute(
      `update "label_claim" set "generation" = ? where "label" = ? and "kind" = ? and "owner_id" = ? and "generation" <> ?`,
      [generation, label, kind, ownerId, generation],
      "run",
    );
  }
}

export function createConnectDb(options: ConnectDbOptions): ConnectDbHandle {
  const { waitUntil, onMirrorFailure } = options;
  let chain: Promise<void> = Promise.resolve();
  let resolved: Promise<ConnectDbBackends> | null = null;
  const backends = (): Promise<ConnectDbBackends> => {
    if (resolved === null) {
      const source = options.backends;
      resolved =
        typeof source === "function"
          ? source().catch((error: unknown) => {
              resolved = null;
              throw error;
            })
          : Promise.resolve(source);
    }
    return resolved;
  };

  const report = (
    { primary, secondary }: ConnectDbBackends,
    stage: MirrorFailureStage,
    table: string | null,
    error: unknown,
  ) => {
    if (secondary === null) return;
    const failure: MirrorFailure = {
      stage,
      primary: primary.kind,
      secondary: secondary.kind,
      table,
      error: errorMessage(error),
    };
    if (onMirrorFailure) onMirrorFailure(failure);
    else console.error("connect-db mirror failed", failure);
  };

  const enqueue = (job: () => Promise<void>) => {
    chain = chain.then(job);
    waitUntil(chain);
  };

  const mirror = (
    pair: ConnectDbBackends,
    sql: string,
    params: readonly unknown[],
    shape: StatementShape,
    labelUsers: readonly string[] | null,
  ) => {
    const { primary, secondary } = pair;
    if (secondary === null) return;
    enqueue(async () => {
      try {
        await secondary.execute(sql, params, "run");
      } catch (error) {
        report(pair, "replay", shape.table, error);
        return;
      }
      if (labelUsers === null || labelUsers.length === 0) return;
      try {
        await copyLabelGenerations(primary, secondary, labelUsers);
      } catch (error) {
        report(pair, "label_claim_sync", shape.table, error);
      }
    });
  };

  const execute = async (
    sql: string,
    params: unknown[],
    method: QueryMethod,
  ): Promise<{ rows: unknown[][]; changes: number }> => {
    const pair = await backends();
    const { primary, secondary } = pair;
    const shape = statementShape(sql);
    if (secondary === null || mirrorSkipped(sql, shape)) {
      return primary.execute(sql, params, method);
    }
    if (!changesLabels(sql, shape)) {
      const result = await primary.execute(sql, params, method);
      mirror(pair, sql, params, shape, null);
      return result;
    }
    const augmented = withUserIdReturning(sql);
    const result = await primary.execute(augmented.sql, params, method);
    const userIds = new Set<string>();
    const rows = result.rows.map((row) => {
      const userId = row[row.length - 1];
      if (typeof userId === "string") userIds.add(userId);
      return augmented.appendedColumn ? row.slice(0, -1) : row;
    });
    mirror(pair, sql, params, shape, [...userIds]);
    return {
      rows: method === "run" && !augmented.appendedColumn ? [] : rows,
      changes: result.changes,
    };
  };

  const db = drizzle(
    async (sql, params, method) => {
      const result = await execute(sql, params, method);
      if (method === "get") return { rows: result.rows[0] as unknown[] };
      if (method === "run") {
        return { rows: result.rows, meta: { changes: result.changes } };
      }
      return { rows: result.rows };
    },
    { schema },
  );

  return {
    db,
    backends,
    mirrored: () => chain,
  };
}
