import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createMigratedConnection } from "../src/testing.js";
import {
  DEFAULT_CEILING_MS,
  GROWTH_FLOOR_MS,
  GROWTH_LIMIT,
  KILL_AFTER_MS,
  LARGE_HISTORY_TURNS,
  SMALL_HISTORY_TURNS,
} from "./query-costs/case.js";
import { QUERY_COST_CASES } from "./query-costs/cases.js";
import { buildHistoryFixture } from "./query-costs/fixture.js";
import { listQueryFunctions } from "./query-functions.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUNNER = fileURLToPath(
  new URL("./query-costs/run-cases.ts", import.meta.url),
);
const COVERED_FILES = [
  "packages/db/src/data/events.ts",
  "packages/db/src/data/queued-thread-messages.ts",
];

type Outcome =
  | { kind: "measured"; smallMs: number; largeMs: number }
  | { kind: "killed" };

interface HistoryFiles {
  databasePath: string;
  fixturePath: string;
}

type RunnerMessage =
  | { kind: "call"; index: number }
  | { kind: "result"; index: number; smallMs: number; largeMs: number };

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
      outcomes.set(message.index, {
        kind: "measured",
        smallMs: message.smallMs,
        largeMs: message.largeMs,
      });
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
  const covered = listQueryFunctions(REPO_ROOT).filter((name) =>
    COVERED_FILES.some((file) => name.startsWith(`${file}#`)),
  );
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

function buildHistory(directory: string, turns: number): HistoryFiles {
  const started = performance.now();
  const db = createMigratedConnection();
  const fixture = buildHistoryFixture(db, turns);
  const eventCount = (
    db.$client.prepare("SELECT count(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
  const files = {
    databasePath: join(directory, `history-${turns}.sqlite`),
    fixturePath: join(directory, `history-${turns}.json`),
  };
  writeFileSync(files.databasePath, db.$client.serialize());
  writeFileSync(files.fixturePath, JSON.stringify(fixture));
  db.$client.close();
  console.log(
    `Built a ${turns}-turn thread fixture (${eventCount} events) in ${Math.round(performance.now() - started)} ms`,
  );
  return files;
}

function failureOf(index: number, outcome: Outcome | undefined): string | null {
  if (outcome === undefined) return "not run";
  if (outcome.kind === "killed") return `killed after ${KILL_AFTER_MS} ms`;
  const { smallMs, largeMs } = outcome;
  const growth = largeMs / smallMs;
  const ceiling = ceilingOf(index);
  if (largeMs > ceiling) {
    return `${largeMs.toFixed(1)} ms on ${LARGE_HISTORY_TURNS} turns, over the ${ceiling} ms ceiling`;
  }
  if (largeMs >= GROWTH_FLOOR_MS && growth > GROWTH_LIMIT) {
    return `${smallMs.toFixed(1)} ms → ${largeMs.toFixed(1)} ms (${growth.toFixed(1)}x) when history doubles, over ${GROWTH_LIMIT}x`;
  }
  return null;
}

const coverageProblems = checkCoverage();
const directory = mkdtempSync(join(tmpdir(), "bb-query-costs-"));
let failed = coverageProblems.length > 0;
try {
  const small = buildHistory(directory, SMALL_HISTORY_TURNS);
  const large = buildHistory(directory, LARGE_HISTORY_TURNS);

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
    `Slowest query functions (${SMALL_HISTORY_TURNS} → ${LARGE_HISTORY_TURNS} turns):`,
  );
  for (const row of measured
    .sort((left, right) => right.largeMs - left.largeMs)
    .slice(0, 10)) {
    console.log(
      `  ${row.smallMs.toFixed(2)} → ${row.largeMs.toFixed(2)} ms (${(row.largeMs / row.smallMs).toFixed(1)}x) ${row.name}`,
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
    `\nEvery exported query function in ${COVERED_FILES.join(" and ")} needs a case in packages/db/scripts/query-costs/:\n${coverageProblems.join("\n")}`,
  );
}
if (failed) process.exit(1);
console.log(
  `All ${QUERY_COST_CASES.length} query functions grow at most ${GROWTH_LIMIT}x when history doubles and stay under their ceiling.`,
);
