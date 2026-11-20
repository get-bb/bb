import { readFileSync } from "node:fs";
import { createConnection, type DbConnection } from "../../src/connection.js";
import {
  DEFAULT_CEILING_MS,
  GROWTH_BOUNDED_LIMIT,
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
  pluginDatabases: ReadonlyMap<string, DbConnection>;
  fixture: HistoryFixture;
  seeds: SeedsByGroup;
}

interface StoredWorld {
  fixture: HistoryFixture;
  seeds: SeedsByGroup;
  pluginDatabasePaths: Readonly<Record<string, string>>;
}

const [
  smallPath,
  smallFixturePath,
  largePath,
  largeFixturePath,
  startArg,
  floorArg,
  machineScaleArg,
] = process.argv.slice(2);
if (
  smallPath === undefined ||
  smallFixturePath === undefined ||
  largePath === undefined ||
  largeFixturePath === undefined ||
  startArg === undefined ||
  floorArg === undefined ||
  machineScaleArg === undefined
) {
  throw new Error(
    "Usage: run-cases.ts <small.sqlite> <small.json> <large.sqlite> <large.json> <start> <floorMs> <machineScale>",
  );
}

const fileBacked = process.argv.includes("--db");
const floorMs = Number(floorArg);
const machineScale = Number(machineScaleArg);

function openHistory(databasePath: string, fixturePath: string): SizedHistory {
  const world = JSON.parse(readFileSync(fixturePath, "utf8")) as StoredWorld;
  return {
    db: createConnection(
      fileBacked ? databasePath : readFileSync(databasePath),
    ),
    pluginDatabases: new Map(
      Object.entries(world.pluginDatabasePaths).map(([group, path]) => [
        group,
        createConnection(fileBacked ? path : readFileSync(path)),
      ]),
    ),
    fixture: world.fixture,
    seeds: world.seeds,
  };
}

function databaseFor(
  history: SizedHistory,
  costCase: RegisteredCostCase,
): DbConnection {
  if (costCase.pluginDatabase === undefined) return history.db;
  const pluginDb = history.pluginDatabases.get(costCase.group);
  if (pluginDb === undefined) {
    throw new Error(`No plugin database for ${costCase.group}`);
  }
  return pluginDb;
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
  const { fixture, seeds } = history;
  const db = databaseFor(history, costCase);
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
    const ceilingMs = (costCase.ceilingMs ?? DEFAULT_CEILING_MS) * machineScale;
    const exceedsLimit = () =>
      largeMs > ceilingMs ||
      (largeMs >= floorMs && largeMs > smallMs * GROWTH_BOUNDED_LIMIT);
    for (
      let attempt = 1;
      attempt < ATTEMPTS || (attempt < CONFIRMING_ATTEMPTS && exceedsLimit());
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
