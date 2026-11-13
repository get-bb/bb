import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createMigratedConnection } from "../src/testing.js";
import { DEFAULT_BUDGET_MS } from "./query-costs/case.js";
import { QUERY_COST_CASES } from "./query-costs/cases.js";
import { buildHistoryFixture, HISTORY_TURNS } from "./query-costs/fixture.js";
import { listQueryFunctions } from "./query-functions.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUNNER = fileURLToPath(
  new URL("./query-costs/run-cases.ts", import.meta.url),
);
const COVERED_FILES = [
  "packages/db/src/data/events.ts",
  "packages/db/src/data/queued-thread-messages.ts",
];
const MIN_KILL_AFTER_MS = 5_000;

type Outcome =
  | { kind: "measured"; ms: number }
  | { kind: "killed"; afterMs: number };

function budgetOf(index: number): number {
  return QUERY_COST_CASES[index].budgetMs ?? DEFAULT_BUDGET_MS;
}

function killAfterMs(index: number): number {
  return Math.max(MIN_KILL_AFTER_MS, budgetOf(index) * 20);
}

function runFrom(
  start: number,
  databasePath: string,
  fixturePath: string,
  outcomes: Map<number, Outcome>,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, RUNNER, databasePath, fixturePath, String(start)],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let current: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    let killed: number | null = null;
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as
        | { kind: "start"; index: number }
        | { kind: "result"; index: number; ms: number };
      if (message.kind === "start") {
        current = message.index;
        timer = setTimeout(() => {
          killed = message.index;
          outcomes.set(message.index, {
            kind: "killed",
            afterMs: killAfterMs(message.index),
          });
          child.kill("SIGKILL");
        }, killAfterMs(message.index));
        return;
      }
      clearTimeout(timer);
      current = null;
      outcomes.set(message.index, { kind: "measured", ms: message.ms });
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
    if (costCase.budgetMs !== undefined && costCase.reason === undefined) {
      problems.push(`  custom budget without a reason: ${costCase.name}`);
    }
  }
  return problems;
}

const coverageProblems = checkCoverage();
const directory = mkdtempSync(join(tmpdir(), "bb-query-costs-"));
let failed = coverageProblems.length > 0;
try {
  const buildStarted = performance.now();
  const db = createMigratedConnection();
  const fixture = buildHistoryFixture(db);
  const eventCount = (
    db.$client.prepare("SELECT count(*) AS count FROM events").get() as {
      count: number;
    }
  ).count;
  const databasePath = join(directory, "history.sqlite");
  const fixturePath = join(directory, "fixture.json");
  writeFileSync(databasePath, db.$client.serialize());
  writeFileSync(fixturePath, JSON.stringify(fixture));
  db.$client.close();
  console.log(
    `Built a ${HISTORY_TURNS}-turn thread fixture (${eventCount} events) in ${Math.round(performance.now() - buildStarted)} ms`,
  );

  const outcomes = new Map<number, Outcome>();
  let start: number | null = 0;
  while (start !== null && start < QUERY_COST_CASES.length) {
    start = await runFrom(start, databasePath, fixturePath, outcomes);
  }

  const rows = QUERY_COST_CASES.map((costCase, index) => ({
    costCase,
    budget: budgetOf(index),
    outcome: outcomes.get(index),
  }));
  const overBudget = rows.filter(
    ({ outcome, budget }) =>
      outcome === undefined || outcome.kind === "killed" || outcome.ms > budget,
  );
  const slowest = rows
    .flatMap((row) =>
      row.outcome?.kind === "measured"
        ? [{ name: row.costCase.name, ms: row.outcome.ms, budget: row.budget }]
        : [],
    )
    .sort((left, right) => right.ms - left.ms)
    .slice(0, 10);
  console.log("Slowest query functions:");
  for (const row of slowest) {
    console.log(
      `  ${row.ms.toFixed(2)} ms (budget ${row.budget} ms) ${row.name}`,
    );
  }
  if (overBudget.length > 0) {
    failed = true;
    console.error(
      `\nQuery functions over their time budget on a ${HISTORY_TURNS}-turn thread; their cost grows with thread history:\n${overBudget
        .map(({ costCase, budget, outcome }) =>
          outcome === undefined
            ? `  not run: ${costCase.name}`
            : outcome.kind === "killed"
              ? `  killed after ${outcome.afterMs} ms (budget ${budget} ms): ${costCase.name}`
              : `  ${outcome.ms.toFixed(1)} ms (budget ${budget} ms): ${costCase.name}`,
        )
        .join("\n")}`,
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
if (coverageProblems.length > 0) {
  console.error(
    `\nEvery exported query function in ${COVERED_FILES.join(" and ")} needs a case in packages/db/scripts/query-costs/cases.ts:\n${coverageProblems.join("\n")}`,
  );
}
if (failed) process.exit(1);
console.log(
  `All ${QUERY_COST_CASES.length} query functions are within budget.`,
);
