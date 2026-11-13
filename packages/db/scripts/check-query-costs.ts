import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createConnection, type DbConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { createMigratedConnection } from "../src/testing.js";
import {
  DEFAULT_CEILING_MS,
  GROWTH_FLOOR_MS,
  GROWTH_LIMIT,
  HISTORY_TURNS_AT_FULL_SCALE,
  KILL_AFTER_MS,
  LARGE_SCALE,
  SMALL_SCALE,
  scaled,
} from "./query-costs/case.js";
import {
  PARTIAL_RUN,
  QUERY_COST_CASES,
  QUERY_COST_GROUPS,
} from "./query-costs/cases.js";
import { buildHistoryFixture } from "../src/history-fixture.js";
import { listQueryFunctions } from "./query-functions.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUNNER = fileURLToPath(
  new URL("./query-costs/run-cases.ts", import.meta.url),
);
const SMALL_TURNS = scaled(HISTORY_TURNS_AT_FULL_SCALE, SMALL_SCALE);
const LARGE_TURNS = scaled(HISTORY_TURNS_AT_FULL_SCALE, LARGE_SCALE);

type Outcome =
  | { kind: "measured"; smallMs: number; largeMs: number }
  | { kind: "killed" }
  | { kind: "threw"; message: string };

interface HistoryFiles {
  databasePath: string;
  fixturePath: string;
}

type RunnerMessage =
  | { kind: "call"; index: number }
  | { kind: "result"; index: number; smallMs: number; largeMs: number }
  | { kind: "error"; index: number; message: string };

function ceilingOf(index: number): number {
  return QUERY_COST_CASES[index].ceilingMs ?? DEFAULT_CEILING_MS;
}

function runFrom(
  start: number,
  small: HistoryFiles,
  large: HistoryFiles,
  outcomes: Map<number, Outcome>,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        RUNNER,
        small.databasePath,
        small.fixturePath,
        large.databasePath,
        large.fixturePath,
        String(start),
        ...process.argv.slice(2),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let current: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    let killed: number | null = null;
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as RunnerMessage;
      clearTimeout(timer);
      if (message.kind === "call") {
        current = message.index;
        timer = setTimeout(() => {
          killed = message.index;
          outcomes.set(message.index, { kind: "killed" });
          child.kill("SIGKILL");
        }, KILL_AFTER_MS);
        return;
      }
      current = null;
      outcomes.set(
        message.index,
        message.kind === "error"
          ? { kind: "threw", message: message.message }
          : {
              kind: "measured",
              smallMs: message.smallMs,
              largeMs: message.largeMs,
            },
      );
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killed !== null) {
        resolve(killed + 1);
      } else if (code === 0) {
        resolve(null);
      } else {
        const failing =
          current === null
            ? ""
            : ` while running ${QUERY_COST_CASES[current].name}`;
        reject(
          new Error(
            `Query cost runner exited with ${signal ?? code}${failing}`,
          ),
        );
      }
    });
  });
}

function checkCoverage(): string[] {
  const covered = listQueryFunctions(REPO_ROOT);
  const named = new Set(QUERY_COST_CASES.map((costCase) => costCase.name));
  const problems = covered
    .filter((name) => !named.has(name))
    .map((name) => `  missing a case: ${name}`);
  const known = new Set(covered);
  for (const costCase of QUERY_COST_CASES) {
    if (!known.has(costCase.name)) {
      problems.push(`  not an exported query function: ${costCase.name}`);
    }
    if (costCase.ceilingMs !== undefined && costCase.reason === undefined) {
      problems.push(`  custom ceiling without a reason: ${costCase.name}`);
    }
  }
  return problems;
}

function seedWorld(db: DbConnection, scale: number) {
  const fixture = buildHistoryFixture(db, {
    historyTurns: scaled(HISTORY_TURNS_AT_FULL_SCALE, scale),
    neighborThreads: 3,
    neighborTurns: 200,
    providerId: "query-costs",
  });
  const seeds = Object.fromEntries(
    QUERY_COST_GROUPS.map((group) => [
      group.name,
      group.seed(db, fixture, scale),
    ]),
  );
  const eventCount = (
    db.$client.prepare("SELECT count(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
  return { fixture, seeds, eventCount };
}

function buildHistory(directory: string, scale: number): HistoryFiles {
  const started = performance.now();
  const db = createMigratedConnection();
  const { fixture, seeds, eventCount } = seedWorld(db, scale);
  const files = {
    databasePath: join(directory, `world-${scale}.sqlite`),
    fixturePath: join(directory, `world-${scale}.json`),
  };
  writeFileSync(files.databasePath, db.$client.serialize());
  writeFileSync(files.fixturePath, JSON.stringify({ fixture, seeds }));
  db.$client.close();
  console.log(
    `Built a ${scale}x world (${fixture.turns.length}-turn thread, ${eventCount} events) in ${Math.round(performance.now() - started)} ms`,
  );
  return files;
}

function seedRealDatabaseCopy(directory: string, path: string): HistoryFiles {
  const databasePath = resolve(path);
  if (databasePath === resolve(homedir(), ".bb", "bb.db")) {
    throw new Error(
      "--db writes to the database; pass a copy made with VACUUM INTO, never ~/.bb/bb.db",
    );
  }
  const started = performance.now();
  const db = createConnection(databasePath);
  migrate(db);
  const { fixture, seeds, eventCount } = seedWorld(db, LARGE_SCALE);
  db.$client.close();
  const fixturePath = join(directory, "real-world.json");
  writeFileSync(fixturePath, JSON.stringify({ fixture, seeds }));
  console.log(
    `Seeded a ${fixture.turns.length}-turn thread into ${databasePath} (${eventCount} events in total) in ${Math.round(performance.now() - started)} ms`,
  );
  return { databasePath, fixturePath };
}

function realDatabasePath(): string | null {
  const index = process.argv.indexOf("--db");
  if (index < 0) return null;
  const path = process.argv[index + 1];
  if (path === undefined) throw new Error("--db needs a database copy path");
  return path;
}

const REAL_DATABASE = realDatabasePath();

function failureOf(index: number, outcome: Outcome | undefined): string | null {
  if (outcome === undefined) return "not run";
  if (outcome.kind === "killed") return `killed after ${KILL_AFTER_MS} ms`;
  if (outcome.kind === "threw") return `threw: ${outcome.message}`;
  const { smallMs, largeMs } = outcome;
  const growth = largeMs / smallMs;
  const ceiling = ceilingOf(index);
  if (largeMs > ceiling) {
    return `${largeMs.toFixed(1)} ms on ${LARGE_TURNS} turns, over the ${ceiling} ms ceiling`;
  }
  if (
    REAL_DATABASE === null &&
    largeMs >= GROWTH_FLOOR_MS &&
    growth > GROWTH_LIMIT
  ) {
    return `${smallMs.toFixed(1)} ms → ${largeMs.toFixed(1)} ms (${growth.toFixed(1)}x) when the world doubles, over ${GROWTH_LIMIT}x`;
  }
  return null;
}

const coverageProblems = PARTIAL_RUN ? [] : checkCoverage();
const directory = mkdtempSync(join(tmpdir(), "bb-query-costs-"));
let failed = coverageProblems.length > 0;
try {
  const large =
    REAL_DATABASE === null
      ? buildHistory(directory, LARGE_SCALE)
      : seedRealDatabaseCopy(directory, REAL_DATABASE);
  const small =
    REAL_DATABASE === null ? buildHistory(directory, SMALL_SCALE) : large;

  const outcomes = new Map<number, Outcome>();
  let start: number | null = 0;
  while (start !== null && start < QUERY_COST_CASES.length) {
    start = await runFrom(start, small, large, outcomes);
  }

  const measured = QUERY_COST_CASES.flatMap((costCase, index) => {
    const outcome = outcomes.get(index);
    return outcome?.kind === "measured"
      ? [{ name: costCase.name, ...outcome }]
      : [];
  });
  console.log(
    REAL_DATABASE === null
      ? `Slowest query functions (${SMALL_TURNS} → ${LARGE_TURNS} turns):`
      : `Slowest query functions on ${REAL_DATABASE}:`,
  );
  for (const row of measured
    .sort((left, right) => right.largeMs - left.largeMs)
    .slice(0, 10)) {
    console.log(
      REAL_DATABASE === null
        ? `  ${row.smallMs.toFixed(2)} → ${row.largeMs.toFixed(2)} ms (${(row.largeMs / row.smallMs).toFixed(1)}x) ${row.name}`
        : `  ${row.largeMs.toFixed(2)} ms ${row.name}`,
    );
  }

  const failures = QUERY_COST_CASES.flatMap((costCase, index) => {
    const failure = failureOf(index, outcomes.get(index));
    return failure === null ? [] : [`  ${costCase.name}: ${failure}`];
  });
  if (failures.length > 0) {
    failed = true;
    console.error(
      `\nQuery functions whose cost grows faster than thread history, or that are too slow on a long thread:\n${failures.join("\n")}`,
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
if (coverageProblems.length > 0) {
  console.error(
    `\nEvery exported query function in packages/db/src/data needs a case in packages/db/scripts/query-costs/:\n${coverageProblems.join("\n")}`,
  );
}
if (failed) process.exit(1);
console.log(
  `All ${QUERY_COST_CASES.length} query functions grow at most ${GROWTH_LIMIT}x when the world doubles and stay under their ceiling.`,
);
