import {
  createPromptHistoryEntry,
  getThread,
  listPromptHistoryPage,
  listQueuedThreadMessages,
  listStoredProjectPromptHistoryRows,
  listStoredThreadPromptHistoryRows,
  type DbQueryConnection,
  type PromptHistoryPosition,
  type QueuedThreadMessageRow,
  type StoredPromptHistoryEntryRow,
} from "@bb/db";
import {
  pathLooksRuntimeReadable,
  promptInputSchema,
  takeVisiblePromptHistoryEntries,
  type PromptHistoryEntry,
  type PromptHistoryListEntry,
  type PromptHistoryScope,
  type Thread,
  type ThreadTurnInitiator,
  type TurnRequestTarget,
} from "@bb/domain";
import { z } from "zod";
import { toThreadQueuedMessage } from "./threads/thread-queued-messages.js";
import { threadTargetHostId } from "./threads/dispatch-attempt.js";
import type { AppDeps } from "../types.js";

const storedPromptHistoryInputSchema = z.array(promptInputSchema).min(1);

interface PromptHistoryArgs {
  limit: number;
}

interface ProjectPromptHistoryArgs extends PromptHistoryArgs {
  projectId: string;
}

interface ThreadPromptHistoryArgs extends PromptHistoryArgs {
  threadId: string;
}

type PromptHistoryServiceDeps = Pick<AppDeps, "db">;
type PromptHistoryEntryInput = PromptHistoryEntry["input"];
type PromptHistoryScopeThread = Pick<Thread, "parentThreadId">;
type PromptHistoryRecordThread = Pick<
  Thread,
  "id" | "parentThreadId" | "projectId"
>;

interface PromptHistoryRecordDeps {
  db: DbQueryConnection;
}

type InternalPromptHistoryEntryState = "accepted" | "queued";

interface InternalPromptHistoryEntry extends PromptHistoryEntry {
  state: InternalPromptHistoryEntryState;
  threadId: string;
}

type ThreadHostLookup = (threadId: string) => string | null;

interface ResolveAcceptedPromptHistoryScopeArgs {
  initiator: ThreadTurnInitiator;
  target: TurnRequestTarget;
  thread: PromptHistoryScopeThread;
}

interface RecordAcceptedPromptHistoryEntryArgs {
  initiator: ThreadTurnInitiator;
  input: PromptHistoryEntryInput;
  requestSequence: number;
  target: TurnRequestTarget;
  thread: PromptHistoryRecordThread;
}

interface BuildPromptHistoryEntriesArgs<TRow, TEntry> {
  buildEntry: (row: TRow) => TEntry;
  rows: readonly TRow[];
}

function parseStoredPromptHistoryInput(
  row: StoredPromptHistoryEntryRow,
): PromptHistoryEntryInput {
  const input = JSON.parse(row.input);
  return storedPromptHistoryInputSchema.parse(input);
}

function portablePromptHistoryInput(
  input: PromptHistoryEntryInput,
  projectId: string,
  hostId: string | null,
): PromptHistoryEntryInput {
  return input.map((chunk) => {
    if (chunk.type !== "localImage" && chunk.type !== "localFile") return chunk;
    if (!pathLooksRuntimeReadable(chunk.path))
      return { ...chunk, experimental_sourceProjectId: projectId };
    return hostId === null ? chunk : { ...chunk, experimental_hostId: hostId };
  });
}

function threadHostLookup(deps: PromptHistoryServiceDeps): ThreadHostLookup {
  const hosts = new Map<string, string | null>();
  return (threadId) => {
    if (!hosts.has(threadId)) {
      const thread = getThread(deps.db, threadId);
      hosts.set(
        threadId,
        thread === null ? null : threadTargetHostId(deps, thread),
      );
    }
    return hosts.get(threadId) ?? null;
  };
}

function buildAcceptedPromptHistoryEntry(
  row: StoredPromptHistoryEntryRow,
): InternalPromptHistoryEntry {
  return {
    id: row.id,
    createdAt: row.createdAt,
    input: parseStoredPromptHistoryInput(row),
    state: "accepted",
    threadId: row.threadId,
  };
}

function buildQueuedPromptHistoryEntry(
  row: QueuedThreadMessageRow,
): InternalPromptHistoryEntry {
  const queuedMessage = toThreadQueuedMessage(row);
  return {
    id: `queued-message:${queuedMessage.id}`,
    createdAt: queuedMessage.createdAt,
    input: queuedMessage.content,
    state: "queued",
    threadId: row.threadId,
  };
}

function comparePromptHistoryEntries(
  left: InternalPromptHistoryEntry,
  right: InternalPromptHistoryEntry,
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  if (left.state !== right.state) {
    return left.state === "queued" ? -1 : 1;
  }
  return right.id.localeCompare(left.id);
}

function toPromptHistoryEntry(
  entry: InternalPromptHistoryEntry,
  projectId: string,
  hostOf: ThreadHostLookup,
): PromptHistoryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    input: portablePromptHistoryInput(
      entry.input,
      projectId,
      hostOf(entry.threadId),
    ),
  };
}

function buildPromptHistoryEntries<TRow, TEntry>({
  buildEntry,
  rows,
}: BuildPromptHistoryEntriesArgs<TRow, TEntry>): TEntry[] {
  const entries: TEntry[] = [];

  for (const row of rows) {
    try {
      entries.push(buildEntry(row));
    } catch {
      continue;
    }
  }

  return entries;
}

function resolveAcceptedPromptHistoryScope(
  args: ResolveAcceptedPromptHistoryScopeArgs,
): PromptHistoryScope | null {
  if (args.initiator !== "user") {
    return null;
  }

  if (args.target.kind !== "thread-start") {
    return "thread";
  }

  if (args.thread.parentThreadId !== null) {
    return null;
  }

  return "project";
}

function buildVisibleThreadPromptHistory(
  queuedEntries: readonly InternalPromptHistoryEntry[],
  acceptedEntries: readonly InternalPromptHistoryEntry[],
  limit: number,
  projectId: string,
  hostOf: ThreadHostLookup,
): PromptHistoryEntry[] {
  const mergedEntries = [...queuedEntries, ...acceptedEntries].sort(
    comparePromptHistoryEntries,
  );
  return takeVisiblePromptHistoryEntries({
    entries: mergedEntries,
    limit,
  }).map((entry) => toPromptHistoryEntry(entry, projectId, hostOf));
}

export function listProjectPromptHistory(
  deps: PromptHistoryServiceDeps,
  args: ProjectPromptHistoryArgs,
): PromptHistoryEntry[] {
  const acceptedEntries = buildPromptHistoryEntries({
    rows: listStoredProjectPromptHistoryRows(deps.db, {
      projectId: args.projectId,
      limit: args.limit,
    }),
    buildEntry: buildAcceptedPromptHistoryEntry,
  });

  return takeVisiblePromptHistoryEntries({
    entries: acceptedEntries,
    limit: args.limit,
  }).map((entry) =>
    toPromptHistoryEntry(entry, args.projectId, threadHostLookup(deps)),
  );
}

export function listThreadPromptHistory(
  deps: PromptHistoryServiceDeps,
  args: ThreadPromptHistoryArgs,
): PromptHistoryEntry[] {
  const thread = getThread(deps.db, args.threadId);
  if (thread === null) return [];
  const queuedEntries = buildPromptHistoryEntries({
    rows: listQueuedThreadMessages(deps.db, args.threadId),
    buildEntry: buildQueuedPromptHistoryEntry,
  });
  const acceptedEntries = buildPromptHistoryEntries({
    rows: listStoredThreadPromptHistoryRows(deps.db, {
      threadId: args.threadId,
      limit: args.limit,
    }),
    buildEntry: buildAcceptedPromptHistoryEntry,
  });

  return buildVisibleThreadPromptHistory(
    queuedEntries,
    acceptedEntries,
    args.limit,
    thread.projectId,
    () => threadTargetHostId(deps, thread),
  );
}

const promptHistoryCursorSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.string().min(1),
]);

function encodePromptHistoryCursor(position: PromptHistoryPosition): string {
  return Buffer.from(
    JSON.stringify([position.createdAt, position.requestSequence, position.id]),
  ).toString("base64url");
}

export function decodePromptHistoryCursor(
  cursor: string,
): PromptHistoryPosition | null {
  try {
    const [createdAt, requestSequence, id] = promptHistoryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { createdAt, requestSequence, id };
  } catch {
    return null;
  }
}

export function listPromptHistory(
  deps: PromptHistoryServiceDeps,
  args: { before: PromptHistoryPosition | null; limit: number },
): { entries: PromptHistoryListEntry[]; nextCursor: string | null } {
  const rows = listPromptHistoryPage(deps.db, {
    before: args.before,
    limit: args.limit + 1,
  });
  const pageRows = rows.slice(0, args.limit);
  const hostOf = threadHostLookup(deps);
  const entries = buildPromptHistoryEntries({
    rows: pageRows,
    buildEntry: (row): PromptHistoryListEntry => ({
      id: row.id,
      createdAt: row.createdAt,
      input: portablePromptHistoryInput(
        parseStoredPromptHistoryInput(row),
        row.projectId,
        hostOf(row.threadId),
      ),
      projectId: row.projectId,
      threadId: row.threadId,
    }),
  });
  const last = pageRows.at(-1);
  return {
    entries,
    nextCursor:
      rows.length > args.limit && last !== undefined
        ? encodePromptHistoryCursor(last)
        : null,
  };
}

export function recordAcceptedPromptHistoryEntry(
  deps: PromptHistoryRecordDeps,
  args: RecordAcceptedPromptHistoryEntryArgs,
): boolean {
  const input = args.input.filter((item) => item.visibility !== "agent-only");
  if (input.length === 0) {
    return false;
  }
  const scope = resolveAcceptedPromptHistoryScope({
    initiator: args.initiator,
    target: args.target,
    thread: args.thread,
  });
  if (scope === null) {
    return false;
  }

  createPromptHistoryEntry(deps.db, {
    projectId: args.thread.projectId,
    threadId: args.thread.id,
    scope,
    requestSequence: args.requestSequence,
    input,
  });
  return true;
}
