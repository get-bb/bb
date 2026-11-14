import { readFileSync } from "node:fs";
import { createConnection, type DbConnection } from "../../src/connection.js";
import {
  GROWTH_FLOOR_MS,
  GROWTH_LIMIT,
  type RegisteredCostCase,
  type SeedsByGroup,
} from "./case.js";
import { QUERY_COST_CASES } from "./cases.js";
import { selectCpuClock } from "./cpu-clock.js";
import type { HistoryFixture } from "../../src/history-fixture.js";

const ATTEMPTS = 3;
const cpuClock = selectCpuClock();
const CONFIRMING_ATTEMPTS = 8;

interface SizedHistory {
  db: DbConnection;
  fixture: HistoryFixture;
  seeds: SeedsByGroup;
}

interface StoredWorld {
  fixture: HistoryFixture;
  seeds: SeedsByGroup;
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

const fileBacked = process.argv.includes("--db");

function openHistory(databasePath: string, fixturePath: string): SizedHistory {
  const world = JSON.parse(readFileSync(fixturePath, "utf8")) as StoredWorld;
  return {
    db: createConnection(
      fileBacked ? databasePath : readFileSync(databasePath),
    ),
    fixture: world.fixture,
    seeds: world.seeds,
  };
}

const small = openHistory(smallPath, smallFixturePath);
const large =
  largePath === smallPath ? small : openHistory(largePath, largeFixturePath);

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function timeOnce(
  index: number,
  costCase: RegisteredCostCase,
  history: SizedHistory,
): number {
  const { db, fixture, seeds } = history;
  db.$client.exec("SAVEPOINT query_cost");
  try {
    costCase.prepare?.(db, fixture, seeds);
    send({ kind: "call", index });
    const started = cpuClock.nowMs();
    costCase.run(db, fixture, seeds);
    return cpuClock.nowMs() - started;
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
  try {
    let smallMs = timeOnce(index, costCase, small);
    let largeMs = timeOnce(index, costCase, large);
    const exceedsGrowth = () =>
      largeMs >= GROWTH_FLOOR_MS && largeMs > smallMs * GROWTH_LIMIT;
    for (
      let attempt = 1;
      largeMs >= GROWTH_FLOOR_MS / 2 &&
      (attempt < ATTEMPTS ||
        (attempt < CONFIRMING_ATTEMPTS && exceedsGrowth()));
      attempt += 1
    ) {
      smallMs = Math.min(smallMs, timeOnce(index, costCase, small));
      largeMs = Math.min(largeMs, timeOnce(index, costCase, large));
    }
    send({ kind: "result", index, smallMs, largeMs });
  } catch (error) {
    send({
      kind: "error",
      index,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
