import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, hostname, platform, release, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RETENTION_MS = 7 * 24 * 60 * 60_000;
const BENCHMARK_NOW = 1_800_000_000_000;
const DEFAULT_OUTPUT_CHARS = 36 * 1024;
const DEFAULT_WARMUPS = 2;
const DEFAULT_ITERATIONS = 10;
const DEFAULT_DRAIN_ROWS_PER_TARGET = 1_000;
const DEFAULT_SCAN_LIMIT = 250;

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument at position ${index + 1}`);
    }
    values.set(name.slice(2), value);
  }
  if (!values.has("repo") || !values.has("output")) {
    throw new Error("--repo and --output are required");
  }
  const repo = resolve(values.get("repo"));
  const output = resolve(values.get("output"));
  const load = values.get("load") ?? "idle";
  if (!existsSync(join(repo, "packages/db/src/index.ts"))) {
    throw new Error(`--repo is not a bb checkout: ${repo}`);
  }
  if (load !== "idle" && load !== "cpu") {
    throw new Error("--load must be idle or cpu");
  }
  return {
    drainRowsPerTarget: parsePositiveInteger(
      values.get("drain-rows") ?? String(DEFAULT_DRAIN_ROWS_PER_TARGET),
      "drain-rows",
    ),
    iterations: parsePositiveInteger(
      values.get("iterations") ?? String(DEFAULT_ITERATIONS),
      "iterations",
    ),
    load,
    output,
    outputChars: parsePositiveInteger(
      values.get("output-chars") ?? String(DEFAULT_OUTPUT_CHARS),
      "output-chars",
    ),
    repo,
    scanLimit: parsePositiveInteger(
      values.get("scan-limit") ?? String(DEFAULT_SCAN_LIMIT),
      "scan-limit",
    ),
    warmups: parsePositiveInteger(
      values.get("warmups") ?? String(DEFAULT_WARMUPS),
      "warmups",
    ),
  };
}

function requireFunction(moduleValue, name) {
  const value = moduleValue[name];
  if (typeof value !== "function") {
    throw new Error(`Target checkout does not export ${name}`);
  }
  return value;
}

function requireTargets(moduleValue) {
  const value = moduleValue.RETAINED_EVENT_OUTPUT_TARGETS;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "Target checkout does not export RETAINED_EVENT_OUTPUT_TARGETS",
    );
  }
  return value;
}

async function loadTarget(repo) {
  const dbModule = await import(
    pathToFileURL(join(repo, "packages/db/src/index.ts")).href
  );
  const threadDataModule = await import(
    pathToFileURL(join(repo, "apps/server/src/services/threads/thread-data.ts"))
      .href
  );
  return {
    createConnection: requireFunction(dbModule, "createConnection"),
    createProject: requireFunction(dbModule, "createProject"),
    createThread: requireFunction(dbModule, "createThread"),
    hydrateRetainedEventOutputRows: requireFunction(
      dbModule,
      "hydrateRetainedEventOutputRows",
    ),
    listStoredEventRows: requireFunction(dbModule, "listStoredEventRows"),
    listThreadEventRows: requireFunction(
      threadDataModule,
      "listThreadEventRows",
    ),
    migrate: requireFunction(dbModule, "migrate"),
    migrateNextCompletedEventItemOutput:
      typeof dbModule.migrateNextCompletedEventItemOutput === "function"
        ? dbModule.migrateNextCompletedEventItemOutput
        : null,
    noopNotifier: dbModule.noopNotifier,
    targets: requireTargets(dbModule),
    truncateCompletedEventItemOutputs:
      typeof dbModule.truncateCompletedEventItemOutputs === "function"
        ? dbModule.truncateCompletedEventItemOutputs
        : null,
    upsertHost: requireFunction(dbModule, "upsertHost"),
  };
}

function createOutput(target, index, outputChars) {
  const prefix = `${target.itemKind}:${target.outputPath}:${index}:`;
  const unit = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return (
    prefix +
    unit
      .repeat(Math.ceil(outputChars / unit.length))
      .slice(0, outputChars - prefix.length)
  );
}

function createItem(target, id, output) {
  switch (target.itemKind) {
    case "commandExecution":
      return {
        aggregatedOutput: output,
        approvalStatus: null,
        command: "node benchmark.js",
        cwd: "/tmp/benchmark",
        exitCode: 0,
        id,
        status: "completed",
        type: "commandExecution",
      };
    case "toolCall":
      return {
        id,
        result: output,
        status: "completed",
        tool: "benchmark",
        type: "toolCall",
      };
    case "webFetch":
      return {
        id,
        pattern: null,
        prompt: null,
        resultText: output,
        type: "webFetch",
        url: "https://example.test/benchmark",
      };
    case "webSearch":
      return {
        id,
        queries: ["completed output retention benchmark"],
        resultText: output,
        type: "webSearch",
      };
    default:
      throw new Error(`Unsupported target: ${target.itemKind}`);
  }
}

function checkpoint(db) {
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
}

function databaseSize(db, databasePath) {
  checkpoint(db);
  const pageCount = db.$client.pragma("page_count", { simple: true });
  const pageSize = db.$client.pragma("page_size", { simple: true });
  const freelistPages = db.$client.pragma("freelist_count", { simple: true });
  const eventBytes = db.$client
    .prepare(
      "SELECT COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM events",
    )
    .get().bytes;
  const sidecarTable = db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'retained_event_outputs'",
    )
    .get();
  const sidecar = sidecarTable
    ? db.$client
        .prepare(
          "SELECT COUNT(*) AS rows, COALESCE(SUM(length(CAST(value AS BLOB))), 0) AS bytes FROM retained_event_outputs",
        )
        .get()
    : { bytes: 0, rows: 0 };
  return {
    eventBytes,
    fileBytes: statSync(databasePath).size,
    freelistBytes: freelistPages * pageSize,
    freelistPages,
    logicalBytes: pageCount * pageSize,
    pageCount,
    pageSize,
    sidecarBytes: sidecar.bytes,
    sidecarRows: sidecar.rows,
  };
}

function seedDatabase(api, root, args) {
  const databasePath = join(root, "bb.db");
  const db = api.createConnection(databasePath);
  api.migrate(db);
  const host = api.upsertHost(db, api.noopNotifier, {
    name: "migration-benchmark-host",
    type: "persistent",
  });
  const projectResult = api.createProject(db, api.noopNotifier, {
    name: "Migration benchmark",
    source: {
      hostId: host.id,
      path: "/tmp/migration-benchmark",
      type: "local_path",
    },
  });
  const thread = api.createThread(db, api.noopNotifier, {
    projectId: projectResult.project.id,
    providerId: "benchmark",
    status: "idle",
  });
  const insert = db.$client.prepare(
    "INSERT INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, parent_tool_call_id, data, created_at) VALUES (?, ?, NULL, 'turn', ?, ?, ?, 'item/completed', ?, ?, NULL, ?, ?)",
  );
  const expectedOutputs = new Map();
  let sequence = 0;
  const createdAt =
    args.age === "expired"
      ? BENCHMARK_NOW - RETENTION_MS - 60_000
      : BENCHMARK_NOW - 60_000;
  const insertAll = db.$client.transaction(() => {
    for (const [targetIndex, target] of api.targets.entries()) {
      for (let index = 0; index < args.rowsPerTarget; index += 1) {
        sequence += 1;
        const itemId = `benchmark-${targetIndex}-${String(index).padStart(8, "0")}`;
        const eventId = `evt_${targetIndex}_${String(index).padStart(12, "0")}`;
        const output = createOutput(target, index, args.outputChars);
        insert.run(
          eventId,
          thread.id,
          "turn_migration_benchmark",
          "provider-migration-benchmark",
          sequence,
          itemId,
          target.itemKind,
          JSON.stringify({ item: createItem(target, itemId, output) }),
          createdAt,
        );
        expectedOutputs.set(eventId, {
          output,
          outputPath: target.outputPath,
        });
      }
    }
  });
  insertAll();
  return {
    beforeSize: databaseSize(db, databasePath),
    databasePath,
    db,
    expectedOutputs,
    thread,
  };
}

function instrumentStatements(db) {
  const counters = {
    eligibilityRows: 0,
    scanRows: 0,
    statements: 0,
  };
  const originalPrepare = db.$client.prepare.bind(db.$client);
  Object.defineProperty(db.$client, "prepare", {
    configurable: true,
    value(source) {
      const statement = originalPrepare(source);
      for (const operation of ["all", "get", "run"]) {
        const original = statement[operation].bind(statement);
        statement[operation] = (...params) => {
          counters.statements += 1;
          const result = original(...params);
          const normalized = source.replace(/\s+/gu, " ").trim();
          if (
            operation === "all" &&
            normalized.startsWith("SELECT id, created_at FROM events")
          ) {
            counters.scanRows += result.length;
          }
          if (
            operation === "get" &&
            normalized.startsWith(
              "SELECT id, created_at, data, thread_id FROM events",
            ) &&
            result !== undefined
          ) {
            counters.eligibilityRows += 1;
          }
          return result;
        };
      }
      return statement;
    },
    writable: true,
  });
  return counters;
}

function readCounterSnapshot(counters) {
  return { ...counters };
}

function counterDelta(before, after) {
  return {
    eligibilityRows: after.eligibilityRows - before.eligibilityRows,
    scanRows: after.scanRows - before.scanRows,
    statements: after.statements - before.statements,
  };
}

function migrationResult(mode, result, outputChars) {
  if (mode === "before") {
    const migratedRows = Object.values(result).reduce(
      (sum, value) => sum + value,
      0,
    );
    return {
      action: migratedRows > 0 ? "migrated" : "idle",
      migratedBytes: migratedRows * outputChars,
      migratedRows,
    };
  }
  if (typeof result === "number") {
    return {
      action: result > 0 ? "migrated" : "scanned",
      migratedBytes: result * outputChars,
      migratedRows: result,
    };
  }
  return {
    action: result.action,
    migratedBytes: result.migratedBytes,
    migratedRows: result.migratedRows,
  };
}

async function measureAdvance(args) {
  const countersBefore = readCounterSnapshot(args.counters);
  const timerStartedAt = performance.now();
  const timerDelay = new Promise((resolveTimer) => {
    setTimeout(() => resolveTimer(performance.now() - timerStartedAt), 0);
  });
  const synchronousStartedAt = performance.now();
  const rawResult = args.advance();
  const synchronousMs = performance.now() - synchronousStartedAt;
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const timerDelayMs = await timerDelay;
  const countersAfter = readCounterSnapshot(args.counters);
  return {
    ...counterDelta(countersBefore, countersAfter),
    ...migrationResult(args.mode, rawResult, args.outputChars),
    synchronousMs,
    timerDelayMs,
    yields: 1,
  };
}

function createAdvance(api, mode, db, args) {
  let targetIndex = 0;
  if (mode === "before") {
    return () =>
      api.truncateCompletedEventItemOutputs(db, {
        createdBefore: BENCHMARK_NOW - RETENTION_MS,
        limit: args.scanLimit,
        truncatedAt: BENCHMARK_NOW,
      });
  }
  return () => {
    const target = api.targets[targetIndex % api.targets.length];
    targetIndex += 1;
    return api.migrateNextCompletedEventItemOutput(db, {
      ...target,
      limit: args.scanLimit,
      migratedAt: BENCHMARK_NOW,
    });
  };
}

async function runDrain(api, mode, root, args) {
  const seeded = seedDatabase(api, root, {
    age: "expired",
    outputChars: args.outputChars,
    rowsPerTarget: args.rowsPerTarget,
  });
  const counters = instrumentStatements(seeded.db);
  const advance = createAdvance(api, mode, seeded.db, args);
  const expectedRows = args.rowsPerTarget * api.targets.length;
  const samples = [];
  let migratedBytes = 0;
  let migratedRows = 0;
  const startedAt = performance.now();
  while (migratedRows < expectedRows) {
    const sample = await measureAdvance({
      advance,
      counters,
      mode,
      outputChars: args.outputChars,
    });
    samples.push(sample);
    migratedBytes += sample.migratedBytes;
    migratedRows += sample.migratedRows;
    if (samples.length > expectedRows * 3 + api.targets.length) {
      throw new Error(
        `Migration stopped making progress at ${migratedRows}/${expectedRows}`,
      );
    }
  }
  const wallMs = performance.now() - startedAt;
  const afterSize = databaseSize(seeded.db, seeded.databasePath);
  seeded.db.$client.close();
  return {
    afterSize,
    beforeSize: seeded.beforeSize,
    expectedRows,
    migratedBytes,
    migratedRows,
    samples,
    wallMs,
  };
}

function outputHash(entries) {
  const hash = createHash("sha256");
  for (const [id, output] of [...entries].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(id);
    hash.update("\0");
    hash.update(String(Buffer.byteLength(output)));
    hash.update("\0");
    hash.update(output);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function outputsFromStoredRows(rows, expectedOutputs) {
  const outputs = new Map();
  for (const row of rows) {
    const expected = expectedOutputs.get(row.id);
    if (!expected) {
      continue;
    }
    const data = JSON.parse(row.data);
    outputs.set(row.id, data.item[expected.outputPath]);
  }
  return outputs;
}

function outputsFromEventRows(rows, expectedOutputs) {
  const outputs = new Map();
  for (const row of rows) {
    const expected = expectedOutputs.get(row.id);
    if (!expected) {
      continue;
    }
    outputs.set(row.id, row.data.item[expected.outputPath]);
  }
  return outputs;
}

async function runCorrectness(api, mode, root, args) {
  const seeded = seedDatabase(api, root, {
    age: "retained",
    outputChars: args.outputChars,
    rowsPerTarget: 1,
  });
  const expectedHash = outputHash(
    [...seeded.expectedOutputs].map(([id, value]) => [id, value.output]),
  );
  if (mode === "after") {
    const advance = createAdvance(api, mode, seeded.db, args);
    let migratedRows = 0;
    while (migratedRows < api.targets.length) {
      const result = migrationResult(mode, advance(), args.outputChars);
      migratedRows += result.migratedRows;
    }
  } else {
    createAdvance(api, mode, seeded.db, args)();
  }
  const storedRows = api.listStoredEventRows(seeded.db, {
    threadId: seeded.thread.id,
  });
  const hydratedRows = api.hydrateRetainedEventOutputRows(
    seeded.db,
    storedRows,
    BENCHMARK_NOW,
  );
  const rawEventRows = api.listThreadEventRows(seeded.db, {
    limit: api.targets.length,
    order: "asc",
    threadId: seeded.thread.id,
  });
  const storedHash = outputHash(
    outputsFromStoredRows(storedRows, seeded.expectedOutputs),
  );
  const hydratedHash = outputHash(
    outputsFromStoredRows(hydratedRows, seeded.expectedOutputs),
  );
  const rawEventHash = outputHash(
    outputsFromEventRows(rawEventRows, seeded.expectedOutputs),
  );
  const size = databaseSize(seeded.db, seeded.databasePath);
  seeded.db.$client.close();
  return {
    expectedHash,
    hydratedHash,
    rawEventHash,
    retainedByteIdentical:
      expectedHash === hydratedHash && expectedHash === rawEventHash,
    size,
    storedHash,
  };
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return {
    count: sorted.length,
    max: sorted.at(-1) ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

function summarizeSamples(samples) {
  return {
    migratedBytes: samples.reduce(
      (sum, sample) => sum + sample.migratedBytes,
      0,
    ),
    migratedRows: samples.reduce((sum, sample) => sum + sample.migratedRows, 0),
    scanRows: samples.reduce((sum, sample) => sum + sample.scanRows, 0),
    statements: samples.reduce((sum, sample) => sum + sample.statements, 0),
    synchronousMs: summarize(samples.map((sample) => sample.synchronousMs)),
    ticks: samples.length,
    timerDelayMs: summarize(samples.map((sample) => sample.timerDelayMs)),
    yields: samples.reduce((sum, sample) => sum + sample.yields, 0),
  };
}

async function startCpuLoad() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "let value=1;process.stdout.write('ready\\n');for(;;){for(let index=0;index<10000000;index+=1){value=(Math.imul(value,1664525)+1013904223)|0;}if(value===0){process.stderr.write('');}}",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error("CPU load process did not start")),
      5_000,
    );
    child.once("error", rejectReady);
    child.stdout.once("data", () => {
      clearTimeout(timeout);
      resolveReady();
    });
  });
  return child;
}

async function stopCpuLoad(child) {
  if (!child) {
    return;
  }
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  await exited;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const api = await loadTarget(args.repo);
  const mode =
    api.migrateNextCompletedEventItemOutput === null ? "before" : "after";
  if (mode === "before" && api.truncateCompletedEventItemOutputs === null) {
    throw new Error("Target checkout has neither migration implementation");
  }
  const benchmarkRoot = mkdtempSync(
    join(tmpdir(), "bb-completed-output-migration-"),
  );
  let cpuLoad = null;
  try {
    if (args.load === "cpu") {
      cpuLoad = await startCpuLoad();
    }
    for (let index = 0; index < args.warmups; index += 1) {
      const root = join(benchmarkRoot, `warmup-${index}`);
      mkdirSync(root);
      await runDrain(api, mode, root, {
        outputChars: args.outputChars,
        rowsPerTarget: args.scanLimit,
        scanLimit: args.scanLimit,
      });
      rmSync(root, { recursive: true });
    }
    const occupancyRuns = [];
    const occupancySamples = [];
    for (let index = 0; index < args.iterations; index += 1) {
      const root = join(benchmarkRoot, `iteration-${index}`);
      mkdirSync(root);
      const run = await runDrain(api, mode, root, {
        outputChars: args.outputChars,
        rowsPerTarget: args.scanLimit,
        scanLimit: args.scanLimit,
      });
      occupancyRuns.push({
        migratedBytes: run.migratedBytes,
        migratedRows: run.migratedRows,
        wallMs: run.wallMs,
      });
      occupancySamples.push(...run.samples);
      rmSync(root, { recursive: true });
    }
    const drainRoot = join(benchmarkRoot, "drain");
    mkdirSync(drainRoot);
    const drain = await runDrain(api, mode, drainRoot, {
      outputChars: args.outputChars,
      rowsPerTarget: args.drainRowsPerTarget,
      scanLimit: args.scanLimit,
    });
    const correctnessRoot = join(benchmarkRoot, "correctness");
    mkdirSync(correctnessRoot);
    const correctness = await runCorrectness(api, mode, correctnessRoot, {
      outputChars: args.outputChars,
      scanLimit: args.scanLimit,
    });
    const scriptPath = fileURLToPath(import.meta.url);
    const artifact = {
      branch: basename(
        execFileSync("git", ["-C", args.repo, "branch", "--show-current"], {
          encoding: "utf8",
        }).trim(),
      ),
      commit: execFileSync("git", ["-C", args.repo, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      correctness,
      dataset: {
        drainRowsPerTarget: args.drainRowsPerTarget,
        drainTotalBytes:
          args.drainRowsPerTarget * api.targets.length * args.outputChars,
        drainTotalRows: args.drainRowsPerTarget * api.targets.length,
        itemPaths: api.targets,
        outputChars: args.outputChars,
        scanLimit: args.scanLimit,
      },
      drain: {
        afterSize: drain.afterSize,
        beforeSize: drain.beforeSize,
        migratedBytes: drain.migratedBytes,
        migratedRows: drain.migratedRows,
        samples: drain.samples,
        summary: summarizeSamples(drain.samples),
        wallMs: drain.wallMs,
      },
      environment: {
        arch: arch(),
        cpuLoadProcesses: args.load === "cpu" ? 1 : 0,
        cpuModel: cpus()[0]?.model ?? "unknown",
        hostname: hostname(),
        platform: platform(),
        release: release(),
      },
      harnessSha256: createHash("sha256")
        .update(readFileSync(scriptPath))
        .digest("hex"),
      iterations: args.iterations,
      load: args.load,
      mode,
      node: process.version,
      occupancy: {
        runs: occupancyRuns,
        samples: occupancySamples,
        summary: summarizeSamples(occupancySamples),
        wallMs: summarize(occupancyRuns.map((run) => run.wallMs)),
      },
      repo: args.repo,
      warmups: args.warmups,
    };
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ output: args.output, ...artifact.occupancy.summary, correctness: artifact.correctness.retainedByteIdentical, mode }, null, 2)}\n`,
    );
  } finally {
    await stopCpuLoad(cpuLoad);
    rmSync(benchmarkRoot, { recursive: true });
  }
}

await main();
