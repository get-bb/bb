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
  GROWTH_BOUNDED_EXPONENT,
  GROWTH_BOUNDED_LIMIT,
  GROWTH_DECLARATION_UNUSED_EXPONENT,
  GROWTH_DECLARATION_UNUSED_LIMIT,
  GROWTH_FAIL_EXPONENT,
  GROWTH_FAIL_LIMIT,
  GROWTH_FLOOR_MS,
  GROWTH_STEP,
  GROWTH_WARN_EXPONENT,
  GROWTH_WARN_LIMIT,
  HISTORY_TURNS_AT_FULL_SCALE,
  KILL_AFTER_MS,
  LARGE_SCALE,
  LONG_TURN_STEPS_AT_FULL_SCALE,
  SMALL_SCALE,
  TURN_AXIS_HISTORY_TURNS,
  TURN_AXIS_SEED_SCALE,
  scaled,
  type GrowthAxisKey,
} from "./query-costs/case.js";
import {
  PARTIAL_RUN,
  QUERY_COST_CASES,
  QUERY_COST_GROUPS,
} from "./query-costs/cases.js";
import { buildHistoryFixture } from "../src/history-fixture.js";
import { selectCpuClock } from "./query-costs/cpu-clock.js";
import {
  measureCalibrationMs,
  REFERENCE_CALIBRATION_MS,
} from "./query-costs/calibration.js";

const CALIBRATION_REPEATS = 3;
import {
  listPluginQueryFunctions,
  listQueryFunctions,
} from "./query-functions.js";
import { auditCaseQueryPlans } from "./query-costs/plan-audit.js";

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
  key: GrowthAxisKey;
  name: string;
  growing: string;
  small: WorldSize;
  large: WorldSize;
}

const GROWTH_AXES: readonly GrowthAxis[] = [
  {
    key: "history",
    name: "thread history",
    growing: "turns in a thread and the rows each case group seeds",
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
    key: "turnSize",
    name: "turn size",
    growing: "events in the first, last and open turns",
    small: {
      key: "turn-small",
      historyTurns: TURN_AXIS_HISTORY_TURNS,
      longTurnSteps: scaled(LONG_TURN_STEPS_AT_FULL_SCALE, SMALL_SCALE),
      seedScale: TURN_AXIS_SEED_SCALE,
    },
    large: {
      key: "turn-large",
      historyTurns: TURN_AXIS_HISTORY_TURNS,
      longTurnSteps: scaled(LONG_TURN_STEPS_AT_FULL_SCALE, LARGE_SCALE),
      seedScale: TURN_AXIS_SEED_SCALE,
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

function growthExponent(growth: number): number {
  return Math.log(growth) / Math.log(GROWTH_STEP);
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

function scaledCeilingOf(index: number): number {
  return ceilingOf(index) * machineScale;
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
        String(growthFloorMs),
        String(machineScale),
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
  const covered = [
    ...listQueryFunctions(REPO_ROOT),
    ...listPluginQueryFunctions(REPO_ROOT),
  ];
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
    for (const [axis, reason] of Object.entries(costCase.growsWith ?? {})) {
      if (reason.trim() === "") {
        problems.push(
          `  growsWith.${axis} without a reason: ${costCase.label}`,
        );
      }
    }
  }
  return problems;
}

function seedWorld(
  db: DbConnection,
  pluginDatabases: ReadonlyMap<string, DbConnection>,
  size: WorldSize,
) {
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
      group.seed(
        pluginDatabases.get(group.name) ?? db,
        fixture,
        size.seedScale,
      ),
    ]),
  );
  const eventCount = (
    db.$client.prepare("SELECT count(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
  return { fixture, seeds, eventCount };
}

function openPluginDatabases(
  pathOf: (group: string) => string | null,
): Map<string, DbConnection> {
  return new Map(
    QUERY_COST_GROUPS.filter((group) => group.pluginDatabase).map((group) => [
      group.name,
      createConnection(pathOf(group.name) ?? ":memory:"),
    ]),
  );
}

function buildHistory(directory: string, size: WorldSize): HistoryFiles {
  const started = performance.now();
  const db = createMigratedConnection();
  const pluginDatabases = openPluginDatabases(() => null);
  const { eventCount, fixture, seeds } = seedWorld(db, pluginDatabases, size);
  const files = {
    databasePath: join(directory, `world-${size.key}.sqlite`),
    fixturePath: join(directory, `world-${size.key}.json`),
  };
  const pluginDatabasePaths = Object.fromEntries(
    [...pluginDatabases].map(([group, pluginDb]) => {
      const path = join(directory, `world-${size.key}-${group}.sqlite`);
      writeFileSync(path, pluginDb.$client.serialize());
      pluginDb.$client.close();
      return [group, path];
    }),
  );
  writeFileSync(files.databasePath, db.$client.serialize());
  writeFileSync(
    files.fixturePath,
    JSON.stringify({ fixture, seeds, pluginDatabasePaths }),
  );
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
  const pluginDatabasePath = (group: string) =>
    join(directory, `real-world-${group}.sqlite`);
  const pluginDatabases = openPluginDatabases(pluginDatabasePath);
  const { fixture, seeds, eventCount } = seedWorld(
    db,
    pluginDatabases,
    REAL_DATABASE_WORLD,
  );
  db.$client.close();
  for (const pluginDb of pluginDatabases.values()) pluginDb.$client.close();
  const pluginDatabasePaths = Object.fromEntries(
    [...pluginDatabases.keys()].map((group) => [
      group,
      pluginDatabasePath(group),
    ]),
  );
  const fixturePath = join(directory, "real-world.json");
  writeFileSync(
    fixturePath,
    JSON.stringify({ fixture, seeds, pluginDatabasePaths }),
  );
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
  axis: GrowthAxisKey | null;
  largeWorld: string;
  small: HistoryFiles;
  large: HistoryFiles;
}

interface Finding {
  severity: "fail" | "warn";
  message: string;
}

function findingOf(
  comparison: Comparison,
  index: number,
  outcome: Outcome | undefined,
): Finding | null {
  if (outcome === undefined) return { severity: "fail", message: "not run" };
  if (outcome.kind === "killed") {
    return { severity: "fail", message: `killed after ${KILL_AFTER_MS} ms` };
  }
  if (outcome.kind === "threw") {
    return { severity: "fail", message: `threw: ${outcome.message}` };
  }
  const { smallMs, largeMs } = outcome;
  const growth = largeMs / smallMs;
  if (comparison.axis !== null && largeMs >= growthFloorMs) {
    const measured = `${smallMs.toFixed(1)} ms → ${largeMs.toFixed(1)} ms (${growth.toFixed(1)}x, cost ∝ size^${growthExponent(growth).toFixed(2)}) when the ${comparison.growing} grow ${GROWTH_STEP}x`;
    const declared = QUERY_COST_CASES[index].growsWith?.[comparison.axis];
    if (declared === undefined && growth > GROWTH_BOUNDED_LIMIT) {
      return {
        severity: "fail",
        message: `${measured}, over size^${GROWTH_BOUNDED_EXPONENT}. Bound the query, or declare growsWith.${comparison.axis} with the reason its cost must grow`,
      };
    }
    if (declared !== undefined && growth > GROWTH_WARN_LIMIT) {
      const failing = growth > GROWTH_FAIL_LIMIT;
      return {
        severity: failing ? "fail" : "warn",
        message: `${measured}, over size^${failing ? GROWTH_FAIL_EXPONENT : GROWTH_WARN_EXPONENT}`,
      };
    }
    if (declared !== undefined && growth <= GROWTH_DECLARATION_UNUSED_LIMIT) {
      return {
        severity: "warn",
        message: `${measured}, within size^${GROWTH_DECLARATION_UNUSED_EXPONENT}; remove its growsWith.${comparison.axis} declaration`,
      };
    }
  }
  const ceiling = scaledCeilingOf(index);
  if (largeMs > ceiling) {
    const raised = QUERY_COST_CASES[index].ceilingMs !== undefined;
    return {
      severity: "fail",
      message: `${largeMs.toFixed(1)} ms with ${comparison.largeWorld}, over ${raised ? "its" : "the default"} ${ceilingOf(index)} ms ceiling (${ceiling.toFixed(1)} ms on this machine). Every query runs on the server's main thread, so bound it${raised ? ", or raise ceilingMs with the reason it must take this long" : ", or set ceilingMs with the reason it must take this long"}`,
    };
  }
  return null;
}

function reportWarning(message: string): void {
  console.log(
    process.env.GITHUB_ACTIONS === "true"
      ? `::warning title=Query cost::${message}`
      : `warning: ${message}`,
  );
}

function buildComparisons(directory: string): Comparison[] {
  if (REAL_DATABASE !== null) {
    const world = seedRealDatabaseCopy(directory, REAL_DATABASE);
    return [
      {
        name: REAL_DATABASE,
        growing: "",
        axis: null,
        largeWorld: REAL_DATABASE,
        small: world,
        large: world,
      },
    ];
  }
  return GROWTH_AXES.map((axis) => ({
    name: `${axis.name} (${describeWorld(axis.small)} → ${describeWorld(axis.large)})`,
    growing: axis.growing,
    axis: axis.key,
    largeWorld: describeWorld(axis.large),
    small: buildHistory(directory, axis.small),
    large: buildHistory(directory, axis.large),
  }));
}

const RAISED_CEILING_HEADROOM = 3;
const slowestLargeMs = new Map<number, number>();

function unneededCeilingWarnings(): string[] {
  return QUERY_COST_CASES.flatMap((costCase, index) => {
    const largeMs = slowestLargeMs.get(index);
    if (
      costCase.ceilingMs === undefined ||
      largeMs === undefined ||
      largeMs > (DEFAULT_CEILING_MS * machineScale) / RAISED_CEILING_HEADROOM
    ) {
      return [];
    }
    return [
      `${costCase.label}: at most ${largeMs.toFixed(1)} ms, within a ${RAISED_CEILING_HEADROOM}x margin of the default ${DEFAULT_CEILING_MS} ms ceiling (${(DEFAULT_CEILING_MS * machineScale).toFixed(1)} ms on this machine); remove its ceilingMs`,
    ];
  });
}

async function runComparison(comparison: Comparison): Promise<Finding[]> {
  const outcomes = new Map<number, Outcome>();
  let start: number | null = 0;
  while (start !== null && start < QUERY_COST_CASES.length) {
    start = await runFrom(start, comparison.small, comparison.large, outcomes);
  }
  for (const [index, outcome] of outcomes) {
    if (outcome.kind !== "measured") continue;
    slowestLargeMs.set(
      index,
      Math.max(slowestLargeMs.get(index) ?? 0, outcome.largeMs),
    );
  }
  const measured = QUERY_COST_CASES.flatMap((costCase, index) => {
    const outcome = outcomes.get(index);
    return outcome?.kind === "measured"
      ? [{ name: costCase.label, index, ...outcome }]
      : [];
  });
  if (comparison.axis !== null) {
    const axis = comparison.axis;
    console.log(
      `Undeclared query functions closest to size^${GROWTH_BOUNDED_EXPONENT} (${GROWTH_BOUNDED_LIMIT.toFixed(1)}x), ${comparison.name}:`,
    );
    for (const row of measured
      .filter(
        (row) =>
          row.largeMs >= growthFloorMs &&
          QUERY_COST_CASES[row.index].growsWith?.[axis] === undefined,
      )
      .sort(
        (left, right) =>
          right.largeMs / right.smallMs - left.largeMs / left.smallMs,
      )
      .slice(0, 5)) {
      console.log(
        `  ${(row.largeMs / row.smallMs).toFixed(2)}x ${row.smallMs.toFixed(2)} → ${row.largeMs.toFixed(2)} ms ${row.name}`,
      );
    }
  }
  console.log(`Slowest query functions, ${comparison.name}:`);
  for (const row of measured
    .sort((left, right) => right.largeMs - left.largeMs)
    .slice(0, 10)) {
    console.log(
      comparison.axis !== null
        ? `  ${row.smallMs.toFixed(2)} → ${row.largeMs.toFixed(2)} ms (${(row.largeMs / row.smallMs).toFixed(1)}x) ${row.name}`
        : `  ${row.largeMs.toFixed(2)} ms ${row.name}`,
    );
  }
  return QUERY_COST_CASES.flatMap((costCase, index) => {
    const finding = findingOf(comparison, index, outcomes.get(index));
    return finding === null
      ? []
      : [
          {
            severity: finding.severity,
            message: `${costCase.label}: ${finding.message}`,
          },
        ];
  });
}

const cpuClock = selectCpuClock();
let machineScale = 1;
let growthFloorMs = GROWTH_FLOOR_MS;
console.log(`Timing each call by ${cpuClock.name}`);
const coverageProblems = PARTIAL_RUN ? [] : checkCoverage();
const directory = mkdtempSync(join(tmpdir(), "bb-query-costs-"));
let failed = coverageProblems.length > 0;
try {
  const comparisons = buildComparisons(directory);
  const calibrationMs = Math.min(
    ...Array.from({ length: CALIBRATION_REPEATS }, () =>
      measureCalibrationMs(cpuClock),
    ),
  );
  machineScale = calibrationMs / REFERENCE_CALIBRATION_MS;
  growthFloorMs = GROWTH_FLOOR_MS * machineScale;
  console.log(
    `Calibration workload took ${calibrationMs.toFixed(2)} ms against ${REFERENCE_CALIBRATION_MS} ms on the reference machine, so growth is checked from ${growthFloorMs.toFixed(2)} ms and the default ${DEFAULT_CEILING_MS} ms ceiling is ${(DEFAULT_CEILING_MS * machineScale).toFixed(1)} ms`,
  );
  const planAudit = auditCaseQueryPlans(QUERY_COST_CASES, {
    ...comparisons[0].large,
    fileBacked: REAL_DATABASE !== null,
  });
  if (planAudit.problems.length > 0) {
    failed = true;
    console.error(
      `\nPlugin database queries whose plans scan or weakly index a growing table (forkable plugins cannot load the @bb/db test guard, so the check audits the statements their cases run; bound the query, or add the finding to its group's pluginDatabase.allowedFindings with the case name as its caller and a reason):\n${planAudit.problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
  }
  if (!PARTIAL_RUN) {
    for (const unused of planAudit.unusedAllowedFindings) {
      reportWarning(
        `${unused}: an allowed plugin plan finding that no case reports; remove it`,
      );
    }
  }
  for (const comparison of comparisons) {
    const findings = await runComparison(comparison);
    for (const finding of findings) {
      if (finding.severity === "warn") reportWarning(finding.message);
    }
    const failures = findings.filter((finding) => finding.severity === "fail");
    if (failures.length > 0) {
      failed = true;
      console.error(
        `\nQuery functions whose cost grows without a declared reason, grows quadratically or worse, runs over its ceiling, or that failed to run, ${comparison.name}:\n${failures.map((finding) => `  ${finding.message}`).join("\n")}`,
      );
    }
  }
  if (!PARTIAL_RUN) {
    for (const warning of unneededCeilingWarnings()) reportWarning(warning);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
if (coverageProblems.length > 0) {
  console.error(
    `\nEvery exported query function in packages/db/src/data and in the plugin database modules (PLUGIN_QUERY_MODULES in packages/db/scripts/query-functions.ts) needs a case in packages/db/scripts/query-costs/:\n${coverageProblems.join("\n")}`,
  );
}
if (failed) process.exit(1);
console.log(
  `No query function grows faster than size^${GROWTH_BOUNDED_EXPONENT} (${GROWTH_BOUNDED_LIMIT.toFixed(1)}x) when the thread history or the turn size grows ${GROWTH_STEP}x, unless its case declares that growth, none grows faster than size^${GROWTH_FAIL_EXPONENT} (${GROWTH_FAIL_LIMIT.toFixed(0)}x), and none runs over its ceiling (${DEFAULT_CEILING_MS} ms unless its case raises it with a reason). Declared growth past size^${GROWTH_WARN_EXPONENT} (${GROWTH_WARN_LIMIT.toFixed(0)}x), declarations within size^${GROWTH_DECLARATION_UNUSED_EXPONENT} (${GROWTH_DECLARATION_UNUSED_LIMIT.toFixed(0)}x), and raised ceilings the default would cover are reported as warnings.`,
);
