import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { count, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadCommandRequestFingerprintSchema,
  type ActorStamp,
  type ClientTurnRequestId,
  type ThreadCommandRequestFingerprint,
  type ThreadCommandAdmissionResult,
  type ThreadCommandKind,
} from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { admitThreadCommand } from "../../src/data/thread-command-admissions.js";
import type { AdmitThreadCommandOutcome } from "../../src/data/thread-command-admissions.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { threadCommandAdmissions } from "../../src/schema.js";

const WORKER_PATH = fileURLToPath(
  new URL("../helpers/thread-command-admission-worker.ts", import.meta.url),
);
const TSX_PATH = resolve(
  fileURLToPath(
    new URL("../../../../node_modules/tsx/dist/esm/index.mjs", import.meta.url),
  ),
);

const FINGERPRINT_A: ThreadCommandRequestFingerprint =
  threadCommandRequestFingerprintSchema.parse(`sha256:${"a".repeat(64)}`);
const FINGERPRINT_B: ThreadCommandRequestFingerprint =
  threadCommandRequestFingerprintSchema.parse(`sha256:${"b".repeat(64)}`);

const ALICE: ActorStamp = {
  principalId: "human:alice",
  principalKind: "human",
  displayName: "Alice",
};

const BOB: ActorStamp = {
  principalId: "human:bob",
  principalKind: "human",
  displayName: "Bob",
};

interface TempDatabasePath {
  cleanup(): void;
  dbPath: string;
}

function setup(): {
  db: DbConnection;
  thread: { id: string };
  project: { id: string };
} {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread, project };
}

function closeConnection(db: DbConnection): void {
  db.$client.close();
}

function createTempDatabasePath(): TempDatabasePath {
  const dir = mkdtempSync(join(tmpdir(), "bb-db-thread-command-admission-"));
  return {
    cleanup(): void {
      rmSync(dir, { force: true, recursive: true });
    },
    dbPath: join(dir, "bb.db"),
  };
}

function requestIdFor(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function startedResult(eventSequence: number): ThreadCommandAdmissionResult {
  return { disposition: "started", eventSequence };
}

function queuedResult(queuedMessageId: string): ThreadCommandAdmissionResult {
  return { disposition: "queued", queuedMessageId };
}

function admitArgs(
  db: DbConnection,
  args: {
    threadId: string;
    requestId: ClientTurnRequestId;
    commandKind?: ThreadCommandKind;
    requestFingerprint?: ThreadCommandRequestFingerprint;
    actor?: ActorStamp;
    nowMs?: number;
    execute?: (admissionSequence: number) => ThreadCommandAdmissionResult;
  },
) {
  const executeImpl =
    args.execute ??
    ((admissionSequence: number) => startedResult(admissionSequence));
  const executeSpy = vi.fn(executeImpl);
  const outcome = admitThreadCommand({
    db,
    threadId: args.threadId,
    requestId: args.requestId,
    commandKind: args.commandKind ?? "message.send",
    requestFingerprint: args.requestFingerprint ?? FINGERPRINT_A,
    actor: args.actor ?? ALICE,
    nowMs: args.nowMs ?? 1_000,
    execute: ({ admissionSequence }) => executeSpy(admissionSequence),
  });
  return { outcome, executeSpy };
}

function countAdmissionRows(db: DbConnection): number {
  return (
    db.select({ value: count() }).from(threadCommandAdmissions).get()?.value ??
    0
  );
}

interface WorkerAdmissionResult {
  ok: boolean;
  outcome?: AdmitThreadCommandOutcome;
  error?: string;
}

function runAdmissionWorker(
  dbPath: string,
  admissionArgs: {
    actor: ActorStamp;
    commandKind: ThreadCommandKind;
    effectLogPath?: string;
    executeEventSequence?: number;
    nowMs: number;
    requestFingerprint: ThreadCommandRequestFingerprint;
    requestId: ClientTurnRequestId;
    threadId: string;
  },
): Promise<WorkerAdmissionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX_PATH, WORKER_PATH], {
      env: {
        ...process.env,
        BB_ADMISSION_WORKER_DATA: JSON.stringify({
          dbPath,
          admissionArgs,
        }),
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdout.trim().length === 0) {
        reject(
          new Error(stderr.trim() || "admission worker produced no output"),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as WorkerAdmissionResult;
        if (code !== 0 && parsed.ok) {
          reject(new Error(`admission worker exited with code ${code}`));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("admitThreadCommand", () => {
  it("persists the first admission with sequence 1 and its typed result", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(1);
      const { outcome } = admitArgs(db, {
        threadId: thread.id,
        requestId,
        execute: () => startedResult(42),
      });

      expect(outcome).toEqual({
        kind: "accepted",
        admission: {
          threadId: thread.id,
          requestId,
          commandKind: "message.send",
          requestFingerprint: FINGERPRINT_A,
          admissionSequence: 1,
          actor: ALICE,
          result: { disposition: "started", eventSequence: 42 },
          createdAt: 1_000,
          completedAt: 1_000,
        },
      });
      expect(countAdmissionRows(db)).toBe(1);
    } finally {
      closeConnection(db);
    }
  });

  it("replays identical admissions without calling execute again", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(2);
      const first = admitArgs(db, {
        threadId: thread.id,
        requestId,
        execute: (admissionSequence) => startedResult(admissionSequence),
      });
      const second = admitArgs(db, {
        threadId: thread.id,
        requestId,
        execute: () => startedResult(99),
      });

      expect(first.outcome.kind).toBe("accepted");
      expect(second.outcome.kind).toBe("replayed");
      if (
        first.outcome.kind === "accepted" &&
        second.outcome.kind === "replayed"
      ) {
        expect(second.outcome.admission).toEqual(first.outcome.admission);
      }
      expect(first.executeSpy).toHaveBeenCalledOnce();
      expect(second.executeSpy).not.toHaveBeenCalled();
      expect(countAdmissionRows(db)).toBe(1);
    } finally {
      closeConnection(db);
    }
  });

  it("conflicts when the fingerprint changes for the same request id", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(3);
      admitArgs(db, { threadId: thread.id, requestId });
      const { outcome, executeSpy } = admitArgs(db, {
        threadId: thread.id,
        requestId,
        requestFingerprint: FINGERPRINT_B,
      });

      expect(outcome.kind).toBe("identity-conflict");
      expect(executeSpy).not.toHaveBeenCalled();
      expect(countAdmissionRows(db)).toBe(1);
    } finally {
      closeConnection(db);
    }
  });

  it("conflicts when the command kind changes for the same request id", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(4);
      admitArgs(db, { threadId: thread.id, requestId });
      const { outcome, executeSpy } = admitArgs(db, {
        threadId: thread.id,
        requestId,
        commandKind: "message.steer",
        execute: () => ({
          disposition: "steered",
          eventSequence: 5,
          expectedTurnId: "turn_1",
        }),
      });

      expect(outcome.kind).toBe("identity-conflict");
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      closeConnection(db);
    }
  });

  it("rolls back a terminal result that does not match the command kind", () => {
    const { db, thread } = setup();
    try {
      expect(() =>
        admitThreadCommand({
          db,
          threadId: thread.id,
          requestId: requestIdFor(40),
          commandKind: "message.send",
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 1_000,
          execute: () => ({
            disposition: "interrupted",
            eventSequence: 5,
            expectedTurnId: "turn_1",
          }),
        }),
      ).toThrow();
      expect(countAdmissionRows(db)).toBe(0);
    } finally {
      closeConnection(db);
    }
  });

  it("enforces command and terminal result consistency in SQLite", () => {
    const { db, thread } = setup();
    try {
      expect(() =>
        db
          .insert(threadCommandAdmissions)
          .values({
            threadId: thread.id,
            requestId: requestIdFor(41),
            commandKind: "message.send",
            requestFingerprint: FINGERPRINT_A,
            admissionSequence: 1,
            actorPrincipalId: ALICE.principalId,
            actorKind: ALICE.principalKind,
            actorDisplayName: ALICE.displayName,
            resultDisposition: "interrupted",
            resultEventSequence: 5,
            resultQueuedMessageId: null,
            resultExpectedTurnId: "turn_1",
            createdAt: 1_000,
            completedAt: 1_000,
          })
          .run(),
      ).toThrow(/thread_command_admissions_result_shape_check/u);
      expect(countAdmissionRows(db)).toBe(0);
    } finally {
      closeConnection(db);
    }
  });

  it("replays when only the display name changes for the same principal", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(5);
      const first = admitArgs(db, { threadId: thread.id, requestId });
      const second = admitArgs(db, {
        threadId: thread.id,
        requestId,
        actor: { ...ALICE, displayName: "Alice Updated" },
      });

      expect(first.outcome.kind).toBe("accepted");
      expect(second.outcome.kind).toBe("replayed");
      if (
        first.outcome.kind === "accepted" &&
        second.outcome.kind === "replayed"
      ) {
        expect(second.outcome.admission.actor.displayName).toBe("Alice");
      }
      expect(second.executeSpy).not.toHaveBeenCalled();
    } finally {
      closeConnection(db);
    }
  });

  it("conflicts when a different principal reuses the request id", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(6);
      admitArgs(db, { threadId: thread.id, requestId });
      const { outcome, executeSpy } = admitArgs(db, {
        threadId: thread.id,
        requestId,
        actor: BOB,
      });

      expect(outcome.kind).toBe("identity-conflict");
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      closeConnection(db);
    }
  });

  it("allocates monotonic sequences within a thread even when timestamps tie", () => {
    const { db, thread } = setup();
    try {
      const first = admitArgs(db, {
        threadId: thread.id,
        requestId: requestIdFor(7),
        nowMs: 5_000,
        execute: () => startedResult(11),
      });
      const second = admitArgs(db, {
        threadId: thread.id,
        requestId: requestIdFor(8),
        nowMs: 5_000,
        execute: () => queuedResult("qmsg_23456789ab"),
      });

      expect(first.outcome.kind).toBe("accepted");
      expect(second.outcome.kind).toBe("accepted");
      if (
        first.outcome.kind === "accepted" &&
        second.outcome.kind === "accepted"
      ) {
        expect(first.outcome.admission.admissionSequence).toBe(1);
        expect(second.outcome.admission.admissionSequence).toBe(2);
        expect(second.outcome.admission.result).toEqual({
          disposition: "queued",
          queuedMessageId: "qmsg_23456789ab",
        });
      }
    } finally {
      closeConnection(db);
    }
  });

  it("starts admission sequences independently per thread", () => {
    const { db, thread, project } = setup();
    try {
      const otherThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const first = admitArgs(db, {
        threadId: thread.id,
        requestId: requestIdFor(9),
      });
      const second = admitArgs(db, {
        threadId: otherThread.id,
        requestId: requestIdFor(10),
      });

      expect(first.outcome.kind).toBe("accepted");
      expect(second.outcome.kind).toBe("accepted");
      if (
        first.outcome.kind === "accepted" &&
        second.outcome.kind === "accepted"
      ) {
        expect(first.outcome.admission.admissionSequence).toBe(1);
        expect(second.outcome.admission.admissionSequence).toBe(1);
      }
    } finally {
      closeConnection(db);
    }
  });

  it("rolls back the ledger row when execute throws", () => {
    const { db, thread } = setup();
    try {
      const requestId = requestIdFor(11);
      expect(() =>
        admitThreadCommand({
          db,
          threadId: thread.id,
          requestId,
          commandKind: "message.send",
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 1_000,
          execute: () => {
            throw new Error("mutation failed");
          },
        }),
      ).toThrow(/mutation failed/u);

      expect(countAdmissionRows(db)).toBe(0);

      const retry = admitArgs(db, {
        threadId: thread.id,
        requestId,
        execute: () => startedResult(3),
      });
      expect(retry.outcome.kind).toBe("accepted");
      if (retry.outcome.kind === "accepted") {
        expect(retry.outcome.admission.admissionSequence).toBe(1);
      }
    } finally {
      closeConnection(db);
    }
  });

  it("replays after closing and reopening a file-backed database", () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const requestId = requestIdFor(12);
      const db = createConnection(tempDatabase.dbPath);
      try {
        migrate(db);
        const host = upsertHost(db, noopNotifier, {
          name: "persist-host",
          type: "persistent",
        });
        const { project } = createProject(db, noopNotifier, {
          name: "persist-project",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/persist",
          },
        });
        const thread = createThread(db, noopNotifier, {
          projectId: project.id,
          providerId: "codex",
        });
        const first = admitArgs(db, {
          threadId: thread.id,
          requestId,
          execute: () => startedResult(88),
        });
        expect(first.outcome.kind).toBe("accepted");
      } finally {
        closeConnection(db);
      }

      const reopenedDb = createConnection(tempDatabase.dbPath);
      try {
        migrate(reopenedDb);
        const rows = reopenedDb.select().from(threadCommandAdmissions).all();
        expect(rows).toHaveLength(1);

        const threadId = rows[0]?.threadId;
        expect(threadId).toBeDefined();
        const replay = admitArgs(reopenedDb, {
          threadId: threadId!,
          requestId,
          execute: () => startedResult(99),
        });
        expect(replay.outcome.kind).toBe("replayed");
        expect(replay.executeSpy).not.toHaveBeenCalled();
      } finally {
        closeConnection(reopenedDb);
      }
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("serializes two-connection races so sequences stay unique and same-id executes once", async () => {
    const tempDatabase = createTempDatabasePath();
    try {
      const effectLogPath = join(
        dirname(tempDatabase.dbPath),
        "admission-effects.log",
      );
      const seedDb = createConnection(tempDatabase.dbPath);
      migrate(seedDb);
      const host = upsertHost(seedDb, noopNotifier, {
        name: "race-host",
        type: "persistent",
      });
      const { project } = createProject(seedDb, noopNotifier, {
        name: "race-project",
        source: {
          type: "local_path",
          hostId: host.id,
          path: "/tmp/race",
        },
      });
      const thread = createThread(seedDb, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      closeConnection(seedDb);

      const sameRequestId = requestIdFor(20);
      const distinctRequestA = requestIdFor(21);
      const distinctRequestB = requestIdFor(22);

      const sameIdWorkers = await Promise.all([
        runAdmissionWorker(tempDatabase.dbPath, {
          threadId: thread.id,
          requestId: sameRequestId,
          commandKind: "message.send",
          effectLogPath,
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 2_000,
          executeEventSequence: 100,
        }),
        runAdmissionWorker(tempDatabase.dbPath, {
          threadId: thread.id,
          requestId: sameRequestId,
          commandKind: "message.send",
          effectLogPath,
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 2_000,
          executeEventSequence: 101,
        }),
      ]);

      expect(sameIdWorkers.every((result) => result.ok)).toBe(true);
      const sameIdOutcomes = sameIdWorkers.map(
        (result) => result.outcome?.kind,
      );
      expect(sameIdOutcomes.sort()).toEqual(["accepted", "replayed"]);
      expect(
        readFileSync(effectLogPath, "utf8").trim().split("\n"),
      ).toHaveLength(1);

      const distinctIdWorkers = await Promise.all([
        runAdmissionWorker(tempDatabase.dbPath, {
          threadId: thread.id,
          requestId: distinctRequestA,
          commandKind: "message.send",
          effectLogPath,
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 3_000,
          executeEventSequence: 200,
        }),
        runAdmissionWorker(tempDatabase.dbPath, {
          threadId: thread.id,
          requestId: distinctRequestB,
          commandKind: "message.send",
          effectLogPath,
          requestFingerprint: FINGERPRINT_A,
          actor: ALICE,
          nowMs: 3_000,
          executeEventSequence: 201,
        }),
      ]);

      expect(distinctIdWorkers.every((result) => result.ok)).toBe(true);
      const distinctSequences = distinctIdWorkers
        .map((result) =>
          result.outcome?.kind === "accepted"
            ? result.outcome.admission.admissionSequence
            : undefined,
        )
        .filter((value): value is number => value !== undefined)
        .sort();
      expect(distinctSequences).toEqual([2, 3]);
      expect(
        readFileSync(effectLogPath, "utf8").trim().split("\n"),
      ).toHaveLength(3);

      const verifyDb = createConnection(tempDatabase.dbPath);
      try {
        migrate(verifyDb);
        const rows = verifyDb
          .select()
          .from(threadCommandAdmissions)
          .where(eq(threadCommandAdmissions.threadId, thread.id))
          .all();
        expect(rows).toHaveLength(3);
        const sequences = rows
          .map((row) => row.admissionSequence)
          .sort((left, right) => left - right);
        expect(sequences).toEqual([1, 2, 3]);
      } finally {
        closeConnection(verifyDb);
      }
    } finally {
      tempDatabase.cleanup();
    }
  }, 30_000);
});
