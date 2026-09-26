import { createRequire } from "node:module";
import {
  appendFileSync,
  readFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  parseStoredThreadEvent,
  threadScope,
  turnScope,
  threadEventTypeSchema,
} from "@bb/domain";
import { buildThreadTimelineFromEvents } from "../src/build-thread-timeline.ts";
import { findSettledItemCandidates } from "../src/settled-item-prototype.ts";
import { decodeSettledItemRecord } from "../src/settled-item.ts";
import type { ThreadEventWithMeta } from "../src/build-event-projection.ts";

const require = createRequire(
  new URL("../../db/package.json", import.meta.url),
);
const Database = require("better-sqlite3");
const argumentsList = process.argv.slice(2);
const verifyCandidatesOnly = argumentsList.includes("--verify-candidates-only");
const benchmarkOnly =
  argumentsList.includes("--benchmark") || verifyCandidatesOnly;
const threadListPath = argumentsList
  .find((arg) => arg.startsWith("--threads="))
  ?.slice("--threads=".length);
const trials = z.coerce
  .number()
  .int()
  .min(1)
  .max(30)
  .parse(
    argumentsList
      .find((arg) => arg.startsWith("--trials="))
      ?.slice("--trials=".length) ?? 3,
  );
const selectedIds = threadListPath
  ? new Set(
      z
        .array(z.string())
        .parse(JSON.parse(readFileSync(threadListPath, "utf8"))),
    )
  : null;
const [inputArg, outputArg, artifactsArg, limitArg] = argumentsList.filter(
  (arg) => !arg.startsWith("--"),
);
const threadLimit =
  limitArg === undefined
    ? undefined
    : z.coerce.number().int().positive().parse(limitArg);
if (!inputArg || !outputArg || !artifactsArg)
  throw new Error(
    "Usage: node --import tsx packages/thread-view/experiments/settled-items.mts SANITIZED_BASELINE NEW_COPY ARTIFACT_DIRECTORY [THREAD_LIMIT] [--benchmark]",
  );
const input = resolve(inputArg),
  output = resolve(outputArg),
  artifacts = resolve(artifactsArg);
if (input === output || (!benchmarkOnly && existsSync(output)))
  throw new Error("Output must be a new disposable file");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const baseline = new Database(input, { readonly: true, fileMustExist: true });
baseline.pragma("query_only = ON");
const tables = z
  .array(z.object({ name: z.string() }))
  .parse(
    baseline.prepare("select name from sqlite_master where type='table'").all(),
  );
let checkedConnectTables = 0;
for (const { name } of tables) {
  const quoted = '"' + name.replaceAll('"', '""') + '"';
  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(baseline.prepare(`pragma table_info(${quoted})`).all());
  if (!columns.some((column) => column.name === "plugin_id")) continue;
  const { n } = z
    .object({ n: z.number() })
    .parse(
      baseline
        .prepare(
          `select count(*) n from ${quoted} where lower(plugin_id) like '%connect%'`,
        )
        .get(),
    );
  if (n)
    throw new Error(
      "Input contains Connect records; use a sanitized research copy",
    );
  checkedConnectTables++;
}
if (checkedConnectTables < 7)
  throw new Error("Expected the full sanitized research schema");
const { n: existingSummaries } = z
  .object({ n: z.number() })
  .parse(
    baseline
      .prepare(
        "select count(*) n from events where completed_item_history is not null",
      )
      .get(),
  );
if (existingSummaries)
  throw new Error("Expected uncompacted research baseline");
if (!benchmarkOnly) {
  writeFileSync(output, "", { flag: "wx", mode: 0o600 });
  await baseline.backup(output, { progress: () => 10000 });
  chmodSync(output, 0o600);
}
const compacted = new Database(output, {
  readonly: benchmarkOnly,
  fileMustExist: true,
});
if (benchmarkOnly) compacted.pragma("query_only = ON");
for (const db of [baseline, compacted]) {
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -262144");
  db.pragma("mmap_size = 1073741824");
  db.pragma("busy_timeout = 5000");
}
const rowSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  createdAt: z.number(),
  threadId: z.string(),
  scopeKind: z.enum(["thread", "turn"]),
  turnId: z.string().nullable(),
  providerThreadId: z.string().nullable(),
  type: threadEventTypeSchema.or(z.literal("item/summary")),
  data: z.string(),
});
type Row = z.infer<typeof rowSchema>;
const query =
  "select id,sequence,created_at createdAt,thread_id threadId,scope_kind scopeKind,turn_id turnId,provider_thread_id providerThreadId,type,data from events where thread_id=? order by sequence";
const baseQuery = baseline.prepare(query),
  compactQuery = compacted.prepare(query);
const threads = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum([
        "active",
        "error",
        "idle",
        "pending",
        "starting",
        "stopping",
      ]),
      n: z.number(),
    }),
  )
  .parse(
    baseline
      .prepare(
        "select t.id,coalesce(t.title,t.title_fallback,'') name,t.status,count(e.id) n from threads t left join events e on e.thread_id=t.id group by t.id order by n desc,t.id",
      )
      .all(),
  )
  .filter((thread) => selectedIds === null || selectedIds.has(thread.id))
  .slice(0, threadLimit);
function split(rows: Row[]) {
  const events: ThreadEventWithMeta[] = [],
    settledItems = [];
  const settledToolFlushSequences: number[] = [];
  for (const row of rows) {
    if (row.type === "item/summary") {
      const { message, toolFlushSequences } = decodeSettledItemRecord(row.data);
      settledToolFlushSequences.push(...(toolFlushSequences ?? []));
      if (
        message.threadId !== row.threadId ||
        message.sourceSeqStart < row.sequence ||
        message.scope.kind !== row.scopeKind ||
        (message.scope.kind === "turn" && message.scope.turnId !== row.turnId)
      )
        throw new Error("Summary scope or position mismatch");
      settledItems.push(message);
    } else {
      const data = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(row.data));
      if (row.scopeKind === "turn" && row.turnId === null)
        throw new Error("Missing turn ID");
      events.push({
        event: parseStoredThreadEvent({
          type: row.type,
          data,
          threadId: row.threadId,
          providerThreadId: row.providerThreadId,
          scope:
            row.scopeKind === "turn" && row.turnId !== null
              ? turnScope(row.turnId)
              : threadScope(),
        }),
        meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
      });
    }
  }
  return { events, settledItems, settledToolFlushSequences };
}
const modes = [
  { completedTurnDisplay: "flat", includeNestedRows: true },
  { completedTurnDisplay: "collapse", includeNestedRows: false },
  { completedTurnDisplay: "collapse", includeNestedRows: true },
] as const;
const remove = compacted.prepare(
  "delete from events where id=? and thread_id=?",
);
const move = compacted.prepare(
  "update events set sequence=?,data=?,type='item/summary' where id=? and thread_id=?",
);
const apply = compacted.transaction(
  (
    threadId: string,
    candidates: ReturnType<typeof findSettledItemCandidates>,
  ) => {
    for (const candidate of candidates) {
      for (const id of candidate.removedIds)
        if (remove.run(id, threadId).changes !== 1)
          throw new Error("Missing deletion");
      if (
        candidate.data !== null &&
        move.run(
          candidate.sequence,
          candidate.data,
          candidate.ownerId,
          threadId,
        ).changes !== 1
      )
        throw new Error("Missing completion");
    }
  },
);
Date.now = () => 1789593600000;
const mismatches: string[] = [];
const summary = {
  totalThreads: threads.length,
  benchmarkTrials: benchmarkOnly && !verifyCandidatesOnly ? trials : 0,
  checkedThreads: 0,
  checkedViews: 0,
  originalRows: 0,
  removedRows: 0,
  summaries: 0,
  summaryPayloadBytes: 0,
  checkedConnectTables,
  mismatches,
};
writeFileSync(artifacts + "/cases.jsonl", "", { mode: 0o600 });
for (const thread of threads) {
  const baseRows = z.array(rowSchema).parse(baseQuery.all(thread.id));
  const decoded = split(baseRows);
  const candidates = findSettledItemCandidates(decoded.events, {
    threadName: thread.name,
    threadStatus: thread.status,
  });
  if (!benchmarkOnly) apply(thread.id, candidates);
  const afterRows = z.array(rowSchema).parse(compactQuery.all(thread.id));
  const compactDecoded = split(afterRows);
  if (benchmarkOnly) {
    const summaries = new Map(
      afterRows
        .filter((row) => row.type === "item/summary")
        .map((row) => [row.id, row]),
    );
    if (
      summaries.size !==
      candidates.filter((candidate) => candidate.data !== null).length
    )
      throw new Error("Candidate count mismatch for " + thread.id);
    const afterById = new Map(afterRows.map((row) => [row.id, row]));
    const beforeById = new Map(baseRows.map((row) => [row.id, row]));
    if (
      baseRows.length - afterRows.length !==
      candidates.reduce(
        (sum, candidate) => sum + candidate.removedIds.length,
        0,
      )
    )
      throw new Error("Deletion count mismatch for " + thread.id);
    for (const candidate of candidates) {
      if (candidate.removedIds.some((id) => afterById.has(id)))
        throw new Error("Expected deletion still present");
      if (candidate.data === null) {
        if (
          !isDeepStrictEqual(
            afterById.get(candidate.ownerId),
            beforeById.get(candidate.ownerId),
          )
        )
          throw new Error("Empty completion changed");
        continue;
      }
      const actual = summaries.get(candidate.ownerId);
      if (
        !actual ||
        actual.sequence !== candidate.sequence ||
        actual.data !== candidate.data
      )
        throw new Error(
          "Stored summary differs from current writer for " + thread.id,
        );
    }
  }
  const baseArgs = {
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    },
    contextWindowEvents: decoded.events,
  };
  let matched = true;
  const timings = [];
  for (const mode of verifyCandidatesOnly ? [] : modes) {
    const options = {
      ...mode,
      threadStatus: thread.status,
      threadName: thread.name,
      workspaceRoot: null,
      includeDiagnosticOperations: false,
      isLatestPage: true,
    };
    const start = performance.now();
    const before = buildThreadTimelineFromEvents({
      ...baseArgs,
      ...decoded,
      options,
    });
    const middle = performance.now();
    const after = buildThreadTimelineFromEvents({
      ...baseArgs,
      ...compactDecoded,
      options,
    });
    const end = performance.now();
    const samples = { baseline: [], settled: [] };
    if (
      benchmarkOnly &&
      mode.completedTurnDisplay === "collapse" &&
      !mode.includeNestedRows
    ) {
      for (let trial = 0; trial < trials; trial++) {
        const order =
          (trial + summary.checkedThreads) % 2
            ? ["settled", "baseline"]
            : ["baseline", "settled"];
        for (const name of order) {
          const cpu = process.cpuUsage();
          const readStart = performance.now();
          const rows = z
            .array(rowSchema)
            .parse(
              (name === "baseline" ? baseQuery : compactQuery).all(thread.id),
            );
          const source = split(rows);
          const response = buildThreadTimelineFromEvents({
            ...baseArgs,
            ...source,
            contextWindowEvents: source.events,
            options,
          });
          const elapsedMs = performance.now() - readStart;
          const used = process.cpuUsage(cpu);
          samples[name].push({
            elapsedMs,
            cpuMs: (used.user + used.system) / 1000,
          });
          if (!isDeepStrictEqual(before, response))
            throw new Error("Repeated response mismatch for " + thread.id);
        }
      }
    }
    timings.push({
      ...mode,
      beforeMs: middle - start,
      afterMs: end - middle,
      samples,
    });
    if (!isDeepStrictEqual(before, after)) {
      matched = false;
      if (summary.mismatches.length < 5)
        writeFileSync(
          artifacts +
            "/difference-" +
            thread.id +
            "-" +
            summary.checkedViews +
            ".json",
          JSON.stringify({ before, after }),
          { mode: 0o600 },
        );
    }
    summary.checkedViews++;
  }
  if (!matched) summary.mismatches.push(thread.id);
  summary.originalRows += baseRows.length;
  summary.removedRows += baseRows.length - afterRows.length;
  summary.summaries += compactDecoded.settledItems.length;
  summary.summaryPayloadBytes += afterRows.reduce(
    (n, row) =>
      n + (row.type === "item/summary" ? Buffer.byteLength(row.data) : 0),
    0,
  );
  summary.checkedThreads++;
  appendFileSync(
    artifacts + "/cases.jsonl",
    JSON.stringify({
      id: thread.id,
      matched,
      beforeRows: baseRows.length,
      afterRows: afterRows.length,
      summaries: compactDecoded.settledItems.length,
      timings,
    }) + "\n",
  );
  writeFileSync(artifacts + "/progress.json", JSON.stringify(summary, null, 2));
  if (summary.checkedThreads % 20 === 0 || !matched)
    console.log(JSON.stringify(summary));
}
if (!benchmarkOnly) compacted.pragma("wal_checkpoint(TRUNCATE)");
const bytes = (db: typeof baseline) =>
  db.prepare("select sum(pgsize) n from dbstat").get().n;
writeFileSync(
  artifacts + "/complete.json",
  JSON.stringify(
    {
      ...summary,
      baselineAllocatedBytes: bytes(baseline),
      compactedAllocatedBytes: bytes(compacted),
      output,
    },
    null,
    2,
  ),
);
baseline.close();
compacted.close();
if (summary.mismatches.length) process.exitCode = 1;
