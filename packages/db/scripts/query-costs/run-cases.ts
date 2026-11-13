import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createConnection } from "../../src/connection.js";
import { DEFAULT_BUDGET_MS, type QueryCostCase } from "./case.js";
import { QUERY_COST_CASES } from "./cases.js";
import type { HistoryFixture } from "./fixture.js";

const RUNS = 3;
const [databasePath, fixturePath, startArg] = process.argv.slice(2);
if (
  databasePath === undefined ||
  fixturePath === undefined ||
  startArg === undefined
) {
  throw new Error("Usage: run-cases.ts <database> <fixture.json> <start>");
}
const db = createConnection(readFileSync(databasePath));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as HistoryFixture;

function timeOnce(costCase: QueryCostCase): number {
  db.$client.exec("SAVEPOINT query_cost");
  try {
    costCase.prepare?.(db, fixture);
    const started = performance.now();
    costCase.run(db, fixture);
    return performance.now() - started;
  } finally {
    db.$client.exec("ROLLBACK TO query_cost");
    db.$client.exec("RELEASE query_cost");
  }
}

for (
  let index = Number(startArg);
  index < QUERY_COST_CASES.length;
  index += 1
) {
  const costCase = QUERY_COST_CASES[index];
  const budget = costCase.budgetMs ?? DEFAULT_BUDGET_MS;
  process.stdout.write(`${JSON.stringify({ kind: "start", index })}\n`);
  let ms = timeOnce(costCase);
  for (let attempt = 1; attempt < RUNS && ms > budget / 4; attempt += 1) {
    ms = Math.min(ms, timeOnce(costCase));
  }
  process.stdout.write(`${JSON.stringify({ kind: "result", index, ms })}\n`);
}
