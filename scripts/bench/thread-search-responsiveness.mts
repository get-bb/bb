/** Disposable, origin-only benchmark. This script never opens the live database. */
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import {
  createConnection,
  migrate,
  noopNotifier,
  createProject,
  createThread,
  upsertHost,
} from "../../packages/db/src/index.js";
import { DatabaseReadService } from "../../apps/server/src/services/database/database-read-service.js";
import { toThreadListEntryResponses } from "../../apps/server/src/services/threads/thread-runtime-display.js";
import type {
  ThreadSearchResults,
  SearchThreadsWithPendingInteractionStateArgs,
  DbConnection,
} from "../../packages/db/src/index.js";
const samples = Number(process.argv[2] ?? 1000);
const baselineCommit = process.argv[3] ?? "59a03819a";
if (!Number.isInteger(samples) || samples < 100)
  throw new Error("Use at least 100 samples.");
const legacyPath = new URL(
  `../../packages/db/src/data/.bench-legacy-${randomUUID()}.ts`,
  import.meta.url,
);
const directory = await mkdtemp(join(tmpdir(), "bb-thread-search-bench-"));
const databasePath = join(directory, "benchmark.db");
let server: ReturnType<typeof createServer> | null = null;
let reader: DatabaseReadService | null = null;
let db: DbConnection | null = null;
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p) - 1] ?? 0;
}
function summary(values: number[]) {
  if (values.length === 0)
    return { n: 0, p50: null, p95: null, p99: null, max: null };
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: Math.max(...values),
  };
}
try {
  await writeFile(
    legacyPath,
    execFileSync("git", [
      "show",
      `${baselineCommit}:packages/db/src/data/threads.ts`,
    ]),
  );
  const legacy: {
    searchThreadsWithPendingInteractionState(
      db: DbConnection,
      args: SearchThreadsWithPendingInteractionStateArgs,
    ): ThreadSearchResults;
  } = await import(legacyPath.href);
  const connection = createConnection(databasePath);
  db = connection;
  migrate(connection);
  const host = upsertHost(connection, noopNotifier, {
    name: "synthetic",
    type: "persistent",
  });
  const { project } = createProject(connection, noopNotifier, {
    name: "synthetic",
    source: { type: "local_path", hostId: host.id, path: directory },
  });
  connection.$client.transaction(() => {
    const insert = connection.$client.prepare(
      "INSERT INTO thread_search_segments(id,thread_id,source_kind,source_key,source_seq,text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (let t = 0; t < 300; t++) {
      const thread = createThread(connection, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        title: `Synthetic ${t}`,
      });
      if (t % 5 === 0)
        connection.$client
          .prepare("UPDATE threads SET archived_at=1 WHERE id=?")
          .run(thread.id);
      for (let s = 0; s < 200; s++)
        insert.run(
          `segment-${t}-${s}`,
          thread.id,
          "user_message",
          `key-${s}`,
          s + 1,
          `${s % 2 ? "common code server event worker" : "common query read sqlite heartbeat"} ${"context ".repeat((s % 7) + 1)}${"x".repeat(4096)}`,
          Date.now(),
          Date.now(),
        );
    }
  })();
  connection.$client.pragma("wal_checkpoint(TRUNCATE)");
  connection.$client.loadExtension(
    new URL("../../packages/db/dist/sqlite-query-deadline.so", import.meta.url)
      .pathname,
  );
  const deadline = connection.$client.prepare("SELECT bb_query_deadline(?)");
  const timings: Record<string, number>[] = [];
  reader = new DatabaseReadService({
    databasePath,
    workerEntry: new URL(
      "../../apps/server/dist/database-read-worker.js",
      import.meta.url,
    ),
    extensionPath: new URL(
      "../../apps/server/dist/database-native/sqlite-query-deadline.so",
      import.meta.url,
    ).pathname,
    logger: {
      info(fields) {
        if ("sqlMs" in fields)
          timings.push({
            sqlMs: Number(fields.sqlMs),
            processingMs: Number(fields.processingMs),
            serializationMs: Number(fields.serializationMs),
            queueWaitMs: Number(fields.queueWaitMs),
          });
      },
    },
  });
  const query = "common server query heartbeat";
  const args = { query, limitPerGroup: 20 };
  const readTask = {
    kind: "search" as const,
    ...args,
    daemonSessions: [],
    planCommands: [],
  };
  function before() {
    deadline.get(3000);
    try {
      const result = legacy.searchThreadsWithPendingInteractionState(
        connection,
        args,
      );
      const deps = {
        db: connection,
        hub: { getDaemonSessionIdForHost: () => null },
        planCommands: new Map(),
      };
      const group = (group: ThreadSearchResults["active"]) => {
        const entries = toThreadListEntryResponses(deps, {
          threads: group.results.map((row) => row.thread),
        });
        return {
          total: group.total,
          results: group.results.map((row, index) => ({
            thread: entries[index]!,
            matches: row.matches,
          })),
        };
      };
      return JSON.stringify({
        active: group(result.active),
        archived: group(result.archived),
      });
    } finally {
      deadline.get(0);
    }
  }
  const expected = before();
  const initialStart = performance.now();
  const first = await reader.run(readTask, new AbortController().signal);
  const readerStartupAndFirstSearchMs = performance.now() - initialStart;
  if (first.json !== expected) throw new Error("The search responses differ.");
  let variant: "before" | "after" = "before";
  const activeReader = reader;
  server = createServer(async (request, response) => {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    try {
      const json =
        variant === "before"
          ? before()
          : (await activeReader.run(readTask, new AbortController().signal))
              .json;
      response.setHeader("content-type", "application/json");
      response.end(json);
    } catch {
      response.statusCode = 504;
      response.end("timeout");
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The benchmark listener did not start.");
  const origin = `http://127.0.0.1:${address.port}`;
  const results = [];
  for (const name of ["before", "after"] as const) {
    variant = name;
    const freshConnectionFirstSampleStart = performance.now();
    const firstResponse = await fetch(origin + "/search");
    await firstResponse.text();
    const firstSampleMs = performance.now() - freshConnectionFirstSampleStart;
    for (let i = 0; i < 20; i++) {
      const response = await fetch(origin + "/search");
      await response.text();
    }
    timings.length = 0;
    const searchMs: number[] = [];
    const healthMs: number[] = [];
    const heartbeatGapMs: number[] = [];
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    let previous = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now();
      heartbeatGapMs.push(now - previous);
      previous = now;
    }, 10);
    let timeoutCount = 0;
    const started = performance.now();
    for (let i = 0; i < samples; i++) {
      const searchStart = performance.now();
      const pendingSearch = fetch(origin + "/search").then(async (response) => {
        await response.text();
        if (response.status !== 200) timeoutCount++;
        searchMs.push(performance.now() - searchStart);
      });
      const healthStart = performance.now();
      await fetch(origin + "/health").then(async (response) => {
        await response.text();
        healthMs.push(performance.now() - healthStart);
      });
      await pendingSearch;
      if ((i + 1) % 100 === 0)
        process.stderr.write(`${name}: ${i + 1}/${samples}\n`);
    }
    clearInterval(heartbeat);
    histogram.disable();
    results.push({
      variant: name,
      workload: "four common tokens across separate segments",
      originOnly: true,
      samples,
      firstSampleMs,
      cache: "20 warmups; warm OS cache; no host cache purge",
      timeoutCount,
      timeoutRate: timeoutCount / samples,
      elapsedMs: performance.now() - started,
      search: summary(searchMs),
      unrelatedApi: summary(healthMs),
      heartbeatGap: summary(heartbeatGapMs),
      eventLoop: {
        p99Ms: histogram.percentile(99) / 1e6,
        maxMs: histogram.max / 1e6,
      },
      sql: summary(timings.map((row) => row.sqlMs)),
      processing: summary(timings.map((row) => row.processingMs)),
      serialization: summary(timings.map((row) => row.serializationMs)),
      queue: summary(timings.map((row) => row.queueWaitMs)),
    });
  }
  process.stdout.write(
    JSON.stringify(
      {
        baselineCommit,
        node: process.version,
        threads: 300,
        segments: 60000,
        messagePaddingChars: 4096,
        limitPerGroup: 20,
        beforeCacheKiB: 262144,
        beforeMmapBytes: 1073741824,
        afterCacheKiB: 32768,
        afterMmapBytes: 0,
        readerStartupAndFirstSearchMs,
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (server !== null) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (reader !== null) await reader.close();
  if (db !== null) db.$client.close();
  await rm(legacyPath, { force: true });
  await rm(directory, { recursive: true, force: true });
}
