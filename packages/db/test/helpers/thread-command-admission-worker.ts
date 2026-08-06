import { appendFileSync } from "node:fs";
import { createConnection } from "../../src/connection.js";
import { admitThreadCommand } from "../../src/data/thread-command-admissions.js";
import type { AdmitThreadCommandOutcome } from "../../src/data/thread-command-admissions.js";
import type {
  ActorStamp,
  ClientTurnRequestId,
  ThreadCommandRequestFingerprint,
  ThreadCommandAdmissionResult,
  ThreadCommandKind,
} from "@bb/domain";
import { migrate } from "../../src/migrate.js";

function startedResult(eventSequence: number): ThreadCommandAdmissionResult {
  return { disposition: "started", eventSequence };
}

interface WorkerData {
  admissionArgs: {
    actor: ActorStamp;
    commandKind: ThreadCommandKind;
    effectLogPath?: string;
    executeEventSequence?: number;
    nowMs: number;
    requestFingerprint: ThreadCommandRequestFingerprint;
    requestId: ClientTurnRequestId;
    threadId: string;
  };
  dbPath: string;
}

function readWorkerData(): WorkerData {
  const raw = process.env.BB_ADMISSION_WORKER_DATA;
  if (raw === undefined || raw.length === 0) {
    throw new Error("Missing BB_ADMISSION_WORKER_DATA");
  }
  return JSON.parse(raw) as WorkerData;
}

const data = readWorkerData();
const db = createConnection(data.dbPath);
migrate(db);

const executeEventSequence = data.admissionArgs.executeEventSequence ?? 1;

try {
  const outcome: AdmitThreadCommandOutcome = admitThreadCommand({
    ...data.admissionArgs,
    db,
    execute: () => {
      if (data.admissionArgs.effectLogPath !== undefined) {
        appendFileSync(data.admissionArgs.effectLogPath, "executed\n", "utf8");
      }
      return startedResult(executeEventSequence);
    },
  });
  process.stdout.write(JSON.stringify({ ok: true, outcome }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  db.$client.close();
}
