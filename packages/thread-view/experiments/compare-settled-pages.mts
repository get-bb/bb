import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { decodeSettledItemRecord } from "../src/settled-item.ts";
import { buildThreadTimelineFromEvents } from "../src/build-thread-timeline.ts";
import { compactThreadTimelineSummaryEvents } from "../src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const argumentsList = process.argv.slice(2);
const stress = argumentsList.includes("--stress");
const trials = Number(
  argumentsList.find((arg) => arg.startsWith("--trials="))?.slice(9) ?? 3,
);
if (!Number.isInteger(trials) || trials < 1 || trials > 30)
  throw Error("Invalid trials");
const selectedPath = argumentsList
  .find((arg) => arg.startsWith("--threads="))
  ?.slice(10);
const selectedIds = selectedPath
  ? new Set(JSON.parse(readFileSync(selectedPath, "utf8")))
  : null;
const [baselinePath, priorPath, summaryPath, outputPath, limitArg] =
  argumentsList.filter((arg) => !arg.startsWith("--"));
if (!baselinePath || !priorPath || !summaryPath || !outputPath)
  throw Error(
    "Usage: compare-settled-pages.mts BASELINE PRIOR_COMPACTED SUMMARIES ARTIFACTS [THREAD_LIMIT]",
  );
const output = resolve(outputPath);
mkdirSync(output, { recursive: true, mode: 0o700 });
const runtime = resolve(output, "runtime");
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const dbRequire = createRequire(root + "/packages/db/package.json");
const Database = dbRequire("better-sqlite3");
const { drizzle } = await import(
  dbRequire.resolve("drizzle-orm/better-sqlite3").replace(/\.cjs$/, ".js")
);
const schema = await import(root + "/packages/db/src/schema.ts");
const lib = await import(root + "/packages/db/src/index.ts");
const { decodeStoredEventRowCached } = await import(
  root + "/apps/server/src/services/threads/stored-event-decode-cache.ts"
);

function absolutize(source, original) {
  const require = createRequire(original);
  return source.replace(/from (["'])([^"']+)\1/g, (match, quote, name) => {
    if (name.startsWith("node:")) return match;
    const target = name.startsWith(".")
      ? resolve(dirname(original), name)
      : require.resolve(name);
    return `from ${JSON.stringify(target)}`;
  });
}
const timelineFile = root + "/apps/server/src/services/threads/timeline.ts";
let timelineSource = readFileSync(timelineFile, "utf8");
timelineSource = timelineSource.replace(
  "  buildThreadTimelineFromEvents,",
  "  buildThreadTimelineFromEvents as actualBuildThreadTimelineFromEvents,",
);
timelineSource += `\nlet captured = [];\nfunction buildThreadTimelineFromEvents(args) { const result = actualBuildThreadTimelineFromEvents(args); captured.push({args, result}); return result; }\nexport function capturePage(db, thread, options) { captured = []; const response = buildThreadTimelineWithProfile(db, thread, options); return { ...response, captured }; }\n`;
writeFileSync(
  runtime + "/timeline.mts",
  absolutize(timelineSource, timelineFile),
  { mode: 0o600 },
);
const { capturePage } = await import(
  pathToFileURL(runtime + "/timeline.mts").href
);
const priorCommit = "f312cf6e451969cd4604ed07027b3497d42ca610";
let codec = execFileSync(
  "git",
  ["show", priorCommit + ":packages/db/src/completed-item-history.ts"],
  { cwd: root, encoding: "utf8" },
);
writeFileSync(
  runtime + "/prior-codec.mts",
  absolutize(codec, root + "/packages/db/src/completed-item-history.ts"),
  { mode: 0o600 },
);
let reader = execFileSync(
  "git",
  ["show", priorCommit + ":packages/db/src/data/completed-item-history.ts"],
  { cwd: root, encoding: "utf8" },
);
reader = absolutize(
  reader,
  root + "/packages/db/src/data/completed-item-history.ts",
).replace(
  JSON.stringify(root + "/packages/db/src/completed-item-history.js"),
  '"./prior-codec.mts"',
);
writeFileSync(runtime + "/prior-reader.mts", reader, { mode: 0o600 });
const { expandSelectedCompletedItemRowsForProjection } = await import(
  pathToFileURL(runtime + "/prior-reader.mts").href
);
const priorDataFile = root + "/apps/server/src/services/threads/thread-data.ts";
const priorCacheFile =
  root + "/apps/server/src/services/threads/stored-event-decode-cache.ts";
for (const [path, name] of [
  [priorDataFile, "prior-data.mts"],
  [priorCacheFile, "prior-cache.mts"],
]) {
  let source = execFileSync(
    "git",
    ["show", priorCommit + ":" + path.slice(root.length + 1)],
    { cwd: root, encoding: "utf8" },
  );
  source = absolutize(source, path).replace(
    JSON.stringify(root + "/apps/server/src/services/threads/thread-data.js"),
    '"./prior-data.mts"',
  );
  writeFileSync(runtime + "/" + name, source, { mode: 0o600 });
}
const { decodeStoredEventRowCached: decodePriorCached } = await import(
  pathToFileURL(runtime + "/prior-cache.mts").href
);
const contexts = {};
for (const [name, path] of Object.entries({
  baseline: baselinePath,
  prior: priorPath,
  summary: summaryPath,
})) {
  const native = new Database(resolve(path), {
    readonly: true,
    fileMustExist: true,
  });
  native.pragma("query_only = ON");
  native.pragma("synchronous = NORMAL");
  native.pragma("cache_size = -262144");
  native.pragma("mmap_size = 1073741824");
  contexts[name] = { native, db: drizzle({ client: native, schema }) };
}
Date.now = () => 1789593600000;
const settings = lib.getAppSettings(contexts.baseline.db);
const threads = contexts.baseline.native
  .prepare(
    "select t.id,count(e.id) n from threads t left join events e on e.thread_id=t.id group by t.id order by n desc,t.id",
  )
  .all()
  .filter((thread) => selectedIds === null || selectedIds.has(thread.id))
  .slice(0, limitArg === undefined ? undefined : Number(limitArg));
const paths = [
  "$.item.aggregatedOutput",
  "$.item.result",
  "$.item.resultText",
  "$.message.output",
];
function truncatedData(max) {
  const pairs = paths.flatMap((path) => [
    `case when json_type(data,'${path}')='text' and length(json_extract(data,'${path}'))>${max} then '${path}' else '$.__bb_timeline_truncation_noop__' end`,
    `substr(json_extract(data,'${path}'),1,${max})||char(10)||'…['||printf('%,d',length(json_extract(data,'${path}'))-${max})||' more characters truncated]'`,
  ]);
  return `case when length(data)<=${max} then data else json_replace(data,${pairs.join(",")}) end`;
}
const names = ["baseline", "prior", "summary"];
const queries = {};
for (const name of names)
  queries[name] = contexts[name].native.prepare(
    `select id, sequence, created_at createdAt, thread_id threadId, scope_kind scopeKind, turn_id turnId, provider_thread_id providerThreadId, item_id itemId, item_kind itemKind, parent_tool_call_id parentToolCallId, type, ${truncatedData(stress ? 8000 : 32000)} data, completed_item_history completedItemHistory from events indexed by sqlite_autoindex_events_1 where thread_id=? and id in (select value from json_each(?)) order by sequence`,
  );
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const report = {
  threads: threads.length,
  completedThreads: 0,
  pages: 0,
  projections: 0,
  mismatches: [],
  priorCommit,
  stress,
  trials,
};
writeFileSync(output + "/cases.jsonl", "", { mode: 0o600 });
for (const [threadIndex, { id }] of threads.entries()) {
  const original = contexts.baseline.native
    .prepare(
      "select id,sequence,turn_id turnId,item_id itemId from events where thread_id=? order by sequence",
    )
    .all(id);
  const maps = {};
  for (const name of names) {
    const physical = contexts[name].native
      .prepare(
        "select id,sequence,turn_id turnId,item_id itemId,type from events where thread_id=? order by sequence",
      )
      .all(id);
    const surviving = new Set(physical.map((row) => row.id));
    const owners = new Map();
    for (const row of physical)
      if (row.type === "item/completed" || row.type === "item/summary") {
        const key = JSON.stringify([row.turnId, row.itemId]);
        if (owners.has(key)) owners.set(key, null);
        else owners.set(key, row.id);
      }
    const mapping = new Map();
    for (const row of original) {
      const owner = surviving.has(row.id)
        ? row.id
        : owners.get(JSON.stringify([row.turnId, row.itemId]));
      if (!owner) throw Error(`Unresolved physical owner: ${name} ${row.id}`);
      mapping.set(row.id, owner);
    }
    maps[name] = mapping;
  }
  const thread = lib.getThread(contexts.baseline.db, id);
  const maxSeq = lib.getHighWaterMarks(contexts.baseline.db, [id])[id];
  let page = { kind: "latest", segmentLimit: 20 };
  const seen = new Set();
  for (let pageIndex = 0; pageIndex < 10000; pageIndex++) {
    const options = {
      completedTurnDisplay: stress
        ? "collapse"
        : (settings.providerCompletedTurnDisplay[thread.providerId] ??
          (thread.providerId === "claude-code" ? "flat" : "collapse")),
      includeDiagnosticOperations: settings.showDiagnosticEvents,
      includeNestedRows: stress,
      maxInlineOutputChars: stress ? 8000 : 32000,
      eventBudget: stress ? 10000 : 1500,
      maxSeq,
      page,
    };
    const captured = capturePage(contexts.baseline.db, thread, options);
    for (const [
      projectionIndex,
      { args, result },
    ] of captured.captured.entries()) {
      const logicalIds = new Set(args.events.map((row) => row.meta.id));
      const ids = {};
      for (const name of names)
        ids[name] = JSON.stringify([
          ...new Set([...logicalIds].map((eventId) => maps[name].get(eventId))),
        ]);
      const invoke = (name) => {
        const cpu = process.cpuUsage(),
          start = performance.now();
        let rows = queries[name].all(id, ids[name]);
        if (name === "prior")
          rows = expandSelectedCompletedItemRowsForProjection(
            contexts[name].db,
            rows,
            maxSeq,
          ).filter((row) => logicalIds.has(row.id));
        const events = [],
          settledItems = [],
          settledToolFlushSequences = [];
        for (const row of rows) {
          if (row.type === "item/summary") {
            const record = decodeSettledItemRecord(row.data);
            settledItems.push(record.message);
            settledToolFlushSequences.push(
              ...(record.toolFlushSequences ?? []),
            );
          } else {
            const event = (
              name === "prior" ? decodePriorCached : decodeStoredEventRowCached
            )(contexts[name].db, row);
            events.push({
              event,
              meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
            });
          }
        }
        const response = buildThreadTimelineFromEvents({
          ...args,
          events: compactThreadTimelineSummaryEvents(events),
          settledItems,
          settledToolFlushSequences,
        });
        const elapsedMs = performance.now() - start,
          used = process.cpuUsage(cpu);
        return {
          response,
          elapsedMs,
          cpuMs: (used.user + used.system) / 1000,
          physicalRows: rows.length,
        };
      };
      const samples = { baseline: [], prior: [], summary: [] };
      let matched = true;
      for (let trial = 0; trial <= trials; trial++) {
        const offset = (threadIndex + pageIndex + trial) % 3;
        for (const name of [
          ...names.slice(offset),
          ...names.slice(0, offset),
        ]) {
          const { response, ...sample } = invoke(name);
          if (!isDeepStrictEqual(response, result)) {
            matched = false;
            if (report.mismatches.length < 5)
              writeFileSync(
                output +
                  `/difference-${id}-${pageIndex}-${projectionIndex}-${name}.json`,
                JSON.stringify({ expected: result, actual: response }),
                { mode: 0o600 },
              );
          }
          if (trial > 0) samples[name].push(sample);
        }
      }
      if (!matched) report.mismatches.push({ id, pageIndex, projectionIndex });
      const metrics = Object.fromEntries(
        names.map((name) => [
          name,
          {
            elapsedMs: median(samples[name].map((x) => x.elapsedMs)),
            cpuMs: median(samples[name].map((x) => x.cpuMs)),
            samples: samples[name],
          },
        ]),
      );
      appendFileSync(
        output + "/cases.jsonl",
        JSON.stringify({
          id,
          pageIndex,
          projectionIndex,
          matched,
          logicalRows: logicalIds.size,
          metrics,
        }) + "\n",
      );
      report.projections++;
    }
    report.pages++;
    const cursor = captured.response.timelinePage?.olderCursor;
    if (!cursor) break;
    const key = JSON.stringify(cursor);
    if (seen.has(key)) throw Error("Cursor loop");
    seen.add(key);
    page = { kind: "older", segmentLimit: 20, beforeCursor: cursor };
    if (pageIndex === 9999) throw Error("Pagination unfinished");
  }
  report.completedThreads++;
  writeFileSync(output + "/progress.json", JSON.stringify(report, null, 2));
  if (threadIndex % 20 === 0) console.log(JSON.stringify(report));
}
for (const context of Object.values(contexts)) context.native.close();
writeFileSync(output + "/complete.json", JSON.stringify(report, null, 2));
if (report.mismatches.length) process.exitCode = 1;
