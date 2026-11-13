import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createConnection, type DbConnection } from "../../src/connection.js";
import { GROWTH_FLOOR_MS, type QueryCostCase } from "./case.js";
import { QUERY_COST_CASES } from "./cases.js";
import type { HistoryFixture } from "../../src/history-fixture.js";

const ATTEMPTS = 3;

interface SizedHistory {
  db: DbConnection;
  fixture: HistoryFixture;
}

const [smallPath, smallFixturePath, largePath, largeFixturePath, startArg] =
  process.argv.slice(2);
if (
  smallPath === undefined ||
  smallFixturePath === undefined ||
  largePath === undefined ||
  largeFixturePath === undefined ||
  startArg === undefined
) {
  throw new Error(
    "Usage: run-cases.ts <small.sqlite> <small.json> <large.sqlite> <large.json> <start>",
  );
}

function openHistory(databasePath: string, fixturePath: string): SizedHistory {
  return {
    db: createConnection(readFileSync(databasePath)),
    fixture: JSON.parse(readFileSync(fixturePath, "utf8")) as HistoryFixture,
  };
}

const small = openHistory(smallPath, smallFixturePath);
const large = openHistory(largePath, largeFixturePath);

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function timeOnce(
  index: number,
  costCase: QueryCostCase,
  history: SizedHistory,
): number {
  const { db, fixture } = history;
  db.$client.exec("SAVEPOINT query_cost");
  try {
    costCase.prepare?.(db, fixture);
    send({ kind: "call", index });
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
  let smallMs = timeOnce(index, costCase, small);
  let largeMs = timeOnce(index, costCase, large);
  for (
    let attempt = 1;
    attempt < ATTEMPTS && largeMs >= GROWTH_FLOOR_MS / 2;
    attempt += 1
  ) {
    smallMs = Math.min(smallMs, timeOnce(index, costCase, small));
    largeMs = Math.min(largeMs, timeOnce(index, costCase, large));
  }
  send({ kind: "result", index, smallMs, largeMs });
}
