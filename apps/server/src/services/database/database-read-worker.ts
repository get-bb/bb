import { createSqliteExecutionGate } from "./sqlite-execution-state.js";
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import {
  createReadConnection,
  createMaintenanceConnection,
  truncateCompletedEventItemOutputs,
  getLatestStoredConversationOutlineSequence,
  getLatestThreadSequence,
  searchThreadsWithPendingInteractionState,
  type ThreadSearchResultGroup,
} from "@bb/db";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { buildThreadConversationOutline } from "../threads/timeline.js";
import { toThreadListEntryResponses } from "../threads/thread-runtime-display.js";
import { requirePublicThread } from "../lib/entity-lookup.js";
import {
  readRequestSchema,
  readWorkerDataSchema,
  type ReadWorkerMessage,
  type ReadTask,
  type DatabaseTask,
} from "./read-worker-contract.js";

const port = parentPort;
if (port === null)
  throw new Error("A database reader requires a worker thread.");
const configuration = readWorkerDataSchema.parse(workerData);
let sqlMs = 0;
let expiresAt = Infinity;
const gate = createSqliteExecutionGate(
  configuration.executionState,
  (durationMs) => {
    sqlMs += durationMs;
  },
  () => {
    // Interrupt is a no-op between SQL calls. Refuse the next native entry
    // after the request expires, including COMMIT after lengthy JS work.
    if (performance.now() >= expiresAt) throw new Error("deadline");
  },
);
const openConnection =
  configuration.mode === "read"
    ? createReadConnection
    : createMaintenanceConnection;
const db = gate.native(() => openConnection(configuration.databasePath));
gate.protect(db.$client);
db.$client.loadExtension(configuration.extensionPath);
const deadline = db.$client.prepare("SELECT bb_query_deadline(?)");

function search(
  task: Extract<ReadTask, { kind: "search" }>,
): ThreadSearchResponse {
  const result = searchThreadsWithPendingInteractionState(db, task);
  const sessions = new Map(task.daemonSessions);
  const deps = {
    db,
    hub: {
      getDaemonSessionIdForHost: (hostId: string) =>
        sessions.get(hostId) ?? null,
    },
    planCommands: new Map(task.planCommands),
  };
  function group(
    group: ThreadSearchResultGroup,
  ): ThreadSearchResponse["active"] {
    const threads = toThreadListEntryResponses(deps, {
      threads: group.results.map((row) => row.thread),
    });
    return {
      total: group.total,
      results: group.results.map((row, index) => ({
        thread: threads[index]!,
        matches: row.matches,
      })),
    };
  }
  return { active: group(result.active), archived: group(result.archived) };
}

function execute(task: DatabaseTask) {
  if (task.kind === "truncate_outputs") {
    if (configuration.mode !== "maintenance")
      throw new Error("A reader cannot write.");
    return truncateCompletedEventItemOutputs(db, task);
  }
  if (configuration.mode !== "read")
    throw new Error("A maintenance worker cannot serve reads.");
  if (task.kind === "search") return search(task);
  const thread = requirePublicThread(db, task.threadId);
  const maxSeq = getLatestThreadSequence(db, { threadId: thread.id });
  const sequence = getLatestStoredConversationOutlineSequence(db, {
    threadId: thread.id,
  });
  return {
    response: buildThreadConversationOutline(db, thread, {
      maxSeq,
      ...(task.providerDisplayName === null
        ? {}
        : { providerDisplayName: task.providerDisplayName }),
    }),
    cacheKey: JSON.stringify([
      thread.id,
      sequence,
      thread.status,
      thread.title,
      thread.titleFallback,
    ]),
  };
}

port.on("message", (value: unknown) => {
  const request = readRequestSchema.parse(value);
  const started = performance.now();
  expiresAt = started + request.budgetMs;
  sqlMs = 0;
  let message: ReadWorkerMessage;
  try {
    deadline.get(request.budgetMs);
    // One WAL snapshot covers matching, totals, snippets, hydration, and metadata.
    // Explicit statements pass through the cancellation barrier. The library's
    // transaction wrapper uses private native statements that bypass it.
    db.$client.exec(
      configuration.mode === "maintenance" ? "BEGIN IMMEDIATE" : "BEGIN",
    );
    const result = execute(request.task);
    db.$client.exec("COMMIT");
    const executed = performance.now();
    if (executed - started >= request.budgetMs) throw new Error("deadline");
    const json = JSON.stringify(result);
    const serialized = performance.now();
    if (serialized - started >= request.budgetMs) throw new Error("deadline");
    message = {
      kind: "result",
      id: request.id,
      json,
      metrics: {
        sqlMs,
        processingMs: Math.max(0, executed - started - sqlMs),
        serializationMs: serialized - executed,
        workerTotalMs: serialized - started,
        responseBytes: Buffer.byteLength(json),
      },
    };
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : null;
    const status =
      error !== null && typeof error === "object" && "status" in error
        ? error.status
        : null;
    message = {
      kind: "failure",
      id: request.id,
      code:
        code === "SQLITE_INTERRUPT" ||
        performance.now() - started >= request.budgetMs
          ? "timeout"
          : code === "SQLITE_BUSY" || code === "SQLITE_LOCKED"
            ? "busy"
            : status === 404
              ? "not_found"
              : "failed",
    };
  } finally {
    expiresAt = Infinity;
    // Disarm before rollback/close, including interrupted explicit transactions.
    deadline.get(0);
    if (db.$client.inTransaction) db.$client.exec("ROLLBACK");
  }
  port.postMessage(message);
  // Retire failed readers. The parent waits for exit before creating a replacement.
  if (message.kind === "failure") {
    db.$client.close();
    port.close();
  }
});
port.postMessage({ kind: "ready" } satisfies ReadWorkerMessage);
