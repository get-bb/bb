import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type {
  TerminalSessionCloseReason,
  TerminalSessionStatus,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createTerminalSessionId } from "../ids.js";
import { terminalSessions } from "../schema.js";

type TerminalSessionConnection = DbConnection | DbTransaction;

export type TerminalSessionRow = typeof terminalSessions.$inferSelect;

export interface CreateTerminalSessionInput {
  cols: number;
  daemonSessionId: string | null;
  environmentId: string | null;
  hostId: string;
  initialCwd: string;
  now?: number;
  rows: number;
  status: TerminalSessionStatus;
  threadId: string | null;
  title: string;
}

interface TerminalStatusScope {
  statuses?: readonly TerminalSessionStatus[];
}

export type TerminalSessionScope = TerminalStatusScope &
  (
    | { kind: "all" }
    | { daemonSessionId: string; kind: "daemon"; terminalId?: string }
    | { environmentId: string; kind: "environment" }
    | { hostId: string; kind: "host" }
    | { kind: "terminal"; terminalId: string }
    | { kind: "thread"; terminalId?: string; threadId: string }
    | {
        environmentId: string;
        kind: "threadless-environment";
        terminalId?: string;
      }
  );

export type TerminalSessionSingleScope = TerminalStatusScope &
  (
    | { daemonSessionId: string; kind: "daemon"; terminalId: string }
    | { kind: "terminal"; terminalId: string }
    | { kind: "thread"; terminalId: string; threadId: string }
    | {
        environmentId: string;
        kind: "threadless-environment";
        terminalId: string;
      }
  );

export type TerminalSessionMutation =
  | { kind: "disconnect" }
  | {
      closeReason: TerminalSessionCloseReason;
      exitCode?: number | null;
      kind: "exit";
    }
  | {
      cols: number;
      daemonSessionId: string;
      initialCwd: string;
      kind: "running";
      rows: number;
      title: string;
    }
  | { cols: number; kind: "size"; rows: number }
  | { kind: "title"; title: string }
  | { kind: "user-input" };

export interface ListTerminalSessionsArgs {
  scope: TerminalSessionScope;
  visible: boolean;
}

export interface UpdateTerminalSessionArgs {
  now?: number;
  scope: TerminalSessionSingleScope;
  update: TerminalSessionMutation;
}

export interface UpdateTerminalSessionsArgs {
  now?: number;
  scope: TerminalSessionScope;
  update: TerminalSessionMutation;
}

const NON_TERMINAL_SESSION_STATUSES: TerminalSessionStatus[] = [
  "starting",
  "running",
  "disconnected",
];

function terminalScope(
  scope: TerminalSessionScope,
  ...where: (SQL | undefined)[]
): SQL | undefined {
  let scoped: SQL | undefined;
  switch (scope.kind) {
    case "all":
      break;
    case "daemon":
      scoped = and(
        eq(terminalSessions.daemonSessionId, scope.daemonSessionId),
        scope.terminalId
          ? eq(terminalSessions.id, scope.terminalId)
          : undefined,
      );
      break;
    case "environment":
      scoped = eq(terminalSessions.environmentId, scope.environmentId);
      break;
    case "host":
      scoped = eq(terminalSessions.hostId, scope.hostId);
      break;
    case "terminal":
      scoped = eq(terminalSessions.id, scope.terminalId);
      break;
    case "thread":
      scoped = and(
        eq(terminalSessions.threadId, scope.threadId),
        scope.terminalId
          ? eq(terminalSessions.id, scope.terminalId)
          : undefined,
      );
      break;
    case "threadless-environment":
      scoped = and(
        eq(terminalSessions.environmentId, scope.environmentId),
        isNull(terminalSessions.threadId),
        scope.terminalId
          ? eq(terminalSessions.id, scope.terminalId)
          : undefined,
      );
      break;
  }
  return and(
    scoped,
    scope.statuses
      ? inArray(terminalSessions.status, [...scope.statuses])
      : undefined,
    ...where,
  );
}

function mutationValues(
  update: TerminalSessionMutation,
  now: number,
): Partial<typeof terminalSessions.$inferInsert> {
  switch (update.kind) {
    case "disconnect":
      return { daemonSessionId: null, status: "disconnected", updatedAt: now };
    case "exit":
      return {
        closeReason: update.closeReason,
        daemonSessionId: null,
        ...(update.exitCode === undefined ? {} : { exitCode: update.exitCode }),
        status: "exited",
        updatedAt: now,
      };
    case "running":
      return {
        closeReason: null,
        cols: update.cols,
        daemonSessionId: update.daemonSessionId,
        exitCode: null,
        initialCwd: update.initialCwd,
        rows: update.rows,
        status: "running",
        title: update.title,
        updatedAt: now,
      };
    case "size":
      return { cols: update.cols, rows: update.rows, updatedAt: now };
    case "title":
      return { title: update.title, updatedAt: now };
    case "user-input":
      return { lastUserInputAt: now, updatedAt: now };
  }
}

function mutationWhere(update: TerminalSessionMutation): SQL | undefined {
  return update.kind === "user-input"
    ? isNull(terminalSessions.lastUserInputAt)
    : undefined;
}

export function createTerminalSession(
  db: TerminalSessionConnection,
  input: CreateTerminalSessionInput,
): TerminalSessionRow {
  const now = input.now ?? Date.now();
  return db
    .insert(terminalSessions)
    .values({
      id: createTerminalSessionId(),
      threadId: input.threadId,
      environmentId: input.environmentId,
      hostId: input.hostId,
      daemonSessionId: input.daemonSessionId,
      title: input.title,
      initialCwd: input.initialCwd,
      cols: input.cols,
      rows: input.rows,
      status: input.status,
      exitCode: null,
      closeReason: null,
      createdAt: now,
      updatedAt: now,
      lastUserInputAt: null,
    })
    .returning()
    .get();
}

export function listTerminalSessions(
  db: TerminalSessionConnection,
  args: ListTerminalSessionsArgs,
): TerminalSessionRow[] {
  return db
    .select()
    .from(terminalSessions)
    .where(
      terminalScope(
        args.scope,
        args.visible
          ? inArray(terminalSessions.status, NON_TERMINAL_SESSION_STATUSES)
          : undefined,
      ),
    )
    .orderBy(asc(terminalSessions.createdAt), asc(terminalSessions.id))
    .all();
}

export function getTerminalSession(
  db: TerminalSessionConnection,
  scope: TerminalSessionSingleScope,
): TerminalSessionRow | null {
  return db.select().from(terminalSessions).where(terminalScope(scope)).get() ?? null;
}

export function updateTerminalSession(
  db: TerminalSessionConnection,
  args: UpdateTerminalSessionArgs,
): TerminalSessionRow | null {
  return (
    db
      .update(terminalSessions)
      .set(mutationValues(args.update, args.now ?? Date.now()))
      .where(terminalScope(args.scope, mutationWhere(args.update)))
      .returning()
      .get() ?? null
  );
}

export function updateTerminalSessions(
  db: TerminalSessionConnection,
  args: UpdateTerminalSessionsArgs,
): TerminalSessionRow[] {
  return db
    .update(terminalSessions)
    .set(mutationValues(args.update, args.now ?? Date.now()))
    .where(terminalScope(args.scope, mutationWhere(args.update)))
    .returning()
    .all();
}
