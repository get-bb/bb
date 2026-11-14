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
  BASELINE_LONG_TURN_STEPS,
  DEFAULT_CEILING_MS,
  GROWTH_FLOOR_MS,
  GROWTH_LIMIT,
  HISTORY_TURNS_AT_FULL_SCALE,
  KILL_AFTER_MS,
  LARGE_SCALE,
  LONG_TURN_STEPS_AT_FULL_SCALE,
  SMALL_SCALE,
  TURN_AXIS_HISTORY_TURNS,
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

interface WorldSize {
  key: string;
  historyTurns: number;
  longTurnSteps: number;
  seedScale: number;
}

interface GrowthAxis {
  name: string;
  growing: string;
  small: WorldSize;
  large: WorldSize;
}

const GROWTH_AXES: readonly GrowthAxis[] = [
  {
    name: "thread history",
    growing: "turns in a thread",
    small: {
      key: "history-small",
      historyTurns: scaled(HISTORY_TURNS_AT_FULL_SCALE, SMALL_SCALE),
      longTurnSteps: BASELINE_LONG_TURN_STEPS,
      seedScale: SMALL_SCALE,
    },
    large: {
      key: "history-large",
      historyTurns: scaled(HISTORY_TURNS_AT_FULL_SCALE, LARGE_SCALE),
      longTurnSteps: BASELINE_LONG_TURN_STEPS,
      seedScale: LARGE_SCALE,
    },
  },
  {
    name: "turn size",
    growing: "events in the first, last and open turns",
    small: {
      key: "turn-small",
      historyTurns: TURN_AXIS_HISTORY_TURNS,
      longTurnSteps: scaled(LONG_TURN_STEPS_AT_FULL_SCALE, SMALL_SCALE),
      seedScale: SMALL_SCALE,
    },
    large: {
      key: "turn-large",
      historyTurns: TURN_AXIS_HISTORY_TURNS,
      longTurnSteps: scaled(LONG_TURN_STEPS_AT_FULL_SCALE, LARGE_SCALE),
      seedScale: SMALL_SCALE,
    },
  },
];

const REAL_DATABASE_WORLD: WorldSize = {
  key: "real",
  historyTurns: scaled(HISTORY_TURNS_AT_FULL_SCALE, LARGE_SCALE),
  longTurnSteps: scaled(LONG_TURN_STEPS_AT_FULL_SCALE, LARGE_SCALE),
  seedScale: LARGE_SCALE,
};

function describeWorld(size: WorldSize): string {
  return `${size.historyTurns} turns, ${size.longTurnSteps}-step long turns`;
}

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
            : ` while running ${QUERY_COST_CASES[current].label}`;
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
      problems.push(`  custom ceiling without a reason: ${costCase.label}`);
    }
  }
  return problems;
}

function seedWorld(db: DbConnection, size: WorldSize) {
  const fixture = buildHistoryFixture(db, {
    historyTurns: size.historyTurns,
    longTurnSteps: size.longTurnSteps,
    neighborThreads: 3,
    neighborTurns: 200,
    providerId: "query-costs",
  });
  const seeds = Object.fromEntries(
    QUERY_COST_GROUPS.map((group) => [
      group.name,
      group.seed(db, fixture, size.seedScale),
    ]),
  );
  const eventCount = (
    db.$client.prepare("SELECT count(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
  return { fixture, seeds, eventCount };
}

function buildHistory(directory: string, size: WorldSize): HistoryFiles {
  const started = performance.now();
  const db = createMigratedConnection();
  const { eventCount, fixture, seeds } = seedWorld(db, size);
  const files = {
    databasePath: join(directory, `world-${size.key}.sqlite`),
    fixturePath: join(directory, `world-${size.key}.json`),
  };
  writeFileSync(files.databasePath, db.$client.serialize());
  writeFileSync(files.fixturePath, JSON.stringify({ fixture, seeds }));
  db.$client.close();
  console.log(
    `Built the ${size.key} world (${describeWorld(size)}, ${eventCount} events) in ${Math.round(performance.now() - started)} ms`,
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
  const { fixture, seeds, eventCount } = seedWorld(db, REAL_DATABASE_WORLD);
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

interface Comparison {
  name: string;
  growing: string;
  checksGrowth: boolean;
  largeWorld: string;
  small: HistoryFiles;
  large: HistoryFiles;
}

function failureOf(
  comparison: Comparison,
  index: number,
  outcome: Outcome | undefined,
): string | null {
  if (outcome === undefined) return "not run";
  if (outcome.kind === "killed") return `killed after ${KILL_AFTER_MS} ms`;
  if (outcome.kind === "threw") return `threw: ${outcome.message}`;
  const { smallMs, largeMs } = outcome;
  const growth = largeMs / smallMs;
  const ceiling = ceilingOf(index);
  if (largeMs > ceiling) {
    return `${largeMs.toFixed(1)} ms with ${comparison.largeWorld}, over the ${ceiling} ms ceiling`;
  }
  if (
    comparison.checksGrowth &&
    largeMs >= GROWTH_FLOOR_MS &&
    growth > GROWTH_LIMIT
  ) {
    return `${smallMs.toFixed(1)} ms → ${largeMs.toFixed(1)} ms (${growth.toFixed(1)}x) when the ${comparison.growing} double, over ${GROWTH_LIMIT}x`;
  }
  return null;
}

function buildComparisons(directory: string): Comparison[] {
  if (REAL_DATABASE !== null) {
    const world = seedRealDatabaseCopy(directory, REAL_DATABASE);
    return [
      {
        name: REAL_DATABASE,
        growing: "",
        checksGrowth: false,
        largeWorld: REAL_DATABASE,
        small: world,
        large: world,
      },
    ];
  }
  return GROWTH_AXES.map((axis) => ({
    name: `${axis.name} (${describeWorld(axis.small)} → ${describeWorld(axis.large)})`,
    growing: axis.growing,
    checksGrowth: true,
    largeWorld: describeWorld(axis.large),
    small: buildHistory(directory, axis.small),
    large: buildHistory(directory, axis.large),
  }));
}

async function runComparison(comparison: Comparison): Promise<string[]> {
  const outcomes = new Map<number, Outcome>();
  let start: number | null = 0;
  while (start !== null && start < QUERY_COST_CASES.length) {
    start = await runFrom(start, comparison.small, comparison.large, outcomes);
  }
  const measured = QUERY_COST_CASES.flatMap((costCase, index) => {
    const outcome = outcomes.get(index);
    return outcome?.kind === "measured"
      ? [{ name: costCase.label, ...outcome }]
      : [];
  });
  console.log(`Slowest query functions, ${comparison.name}:`);
  for (const row of measured
    .sort((left, right) => right.largeMs - left.largeMs)
    .slice(0, 10)) {
    console.log(
      comparison.checksGrowth
        ? `  ${row.smallMs.toFixed(2)} → ${row.largeMs.toFixed(2)} ms (${(row.largeMs / row.smallMs).toFixed(1)}x) ${row.name}`
        : `  ${row.largeMs.toFixed(2)} ms ${row.name}`,
    );
  }
  return QUERY_COST_CASES.flatMap((costCase, index) => {
    const failure = failureOf(comparison, index, outcomes.get(index));
    return failure === null ? [] : [`  ${costCase.label}: ${failure}`];
  });
}

const coverageProblems = PARTIAL_RUN ? [] : checkCoverage();
const directory = mkdtempSync(join(tmpdir(), "bb-query-costs-"));
let failed = coverageProblems.length > 0;
try {
  for (const comparison of buildComparisons(directory)) {
    const failures = await runComparison(comparison);
    if (failures.length > 0) {
      failed = true;
      console.error(
        `\nQuery functions whose cost grows faster than ${comparison.growing === "" ? "the data" : `the ${comparison.growing}`}, or that are too slow, ${comparison.name}:\n${failures.join("\n")}`,
      );
    }
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
  `All ${QUERY_COST_CASES.length} query functions grow at most ${GROWTH_LIMIT}x when the thread history or the turn size doubles and stay under their ceiling.`,
);
