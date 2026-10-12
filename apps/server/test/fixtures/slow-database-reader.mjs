import { createSqliteExecutionGate } from "../../src/services/database/sqlite-execution-state.ts";
// Real synchronous SQLite operations. This fixture never mocks the database.
import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const gate = createSqliteExecutionGate(workerData.executionState);
const db = gate.native(
  () =>
    new Database(workerData.databasePath, {
      readonly: true,
      fileMustExist: true,
      timeout: 10,
    }),
);
gate.protect(db);
db.loadExtension(workerData.extensionPath);
const deadline = db.prepare("SELECT bb_query_deadline(?)");
const slow = db.prepare(
  "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n < 100000000) SELECT sum(n) FROM x",
);
parentPort.on("message", (request) => {
  const start = performance.now();
  if (request.task.query === "crash") process.exit(19);
  if (request.task.query === "malformed") {
    parentPort.postMessage({ kind: "invalid" });
    return;
  }
  let message;
  try {
    deadline.get(request.budgetMs);
    db.exec("BEGIN");
    const rows = db.prepare("SELECT id,title FROM threads ORDER BY id").all();
    let snapshotRows = null;
    if (request.task.query === "snapshot") {
      writeFileSync(workerData.databasePath + ".reader-ready", "ready");
      db.prepare(
        "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<500000) SELECT sum(n) FROM x",
      ).get();
      snapshotRows = db
        .prepare("SELECT id,title FROM threads ORDER BY id")
        .all();
    }
    if (request.task.query === "slow" || request.task.query === "hold") {
      writeFileSync(workerData.databasePath + ".reader-ready", "ready");
      slow.get();
    }
    if (request.task.query === "write")
      db.prepare("UPDATE threads SET title='forbidden'").run();
    db.exec("COMMIT");
    const json =
      request.task.query === "snapshot"
        ? JSON.stringify({ before: rows, after: snapshotRows })
        : request.task.query === "rows"
          ? JSON.stringify({ rows })
          : JSON.stringify({
              active: { total: 0, results: [] },
              archived: { total: 0, results: [] },
            });
    message = {
      kind: "result",
      id: request.id,
      json,
      metrics: {
        sqlMs: performance.now() - start,
        processingMs: 0,
        serializationMs: 0,
        workerTotalMs: performance.now() - start,
        responseBytes: Buffer.byteLength(json),
      },
    };
  } catch (error) {
    message = {
      kind: "failure",
      id: request.id,
      code: error.code === "SQLITE_INTERRUPT" ? "timeout" : "failed",
    };
  } finally {
    deadline.get(0);
    if (db.inTransaction) db.exec("ROLLBACK");
  }
  parentPort.postMessage(message);
  if (message.kind === "failure") {
    db.close();
    parentPort.close();
  }
});
parentPort.postMessage({ kind: "ready" });
