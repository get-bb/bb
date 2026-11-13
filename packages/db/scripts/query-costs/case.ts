import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";

export interface QueryCostCase<TSeed = undefined> {
  name: string;
  ceilingMs?: number;
  reason?: string;
  prepare?: (db: DbConnection, fixture: HistoryFixture, seed: TSeed) => void;
  run: (db: DbConnection, fixture: HistoryFixture, seed: TSeed) => unknown;
}

export interface QueryCostGroup<TSeed> {
  name: string;
  seed: (db: DbConnection, fixture: HistoryFixture, scale: number) => TSeed;
  cases: readonly QueryCostCase<TSeed>[];
}

export type SeedsByGroup = Readonly<Record<string, unknown>>;

export interface RegisteredCostCase {
  name: string;
  ceilingMs?: number;
  reason?: string;
  prepare?: (
    db: DbConnection,
    fixture: HistoryFixture,
    seeds: SeedsByGroup,
  ) => void;
  run: (
    db: DbConnection,
    fixture: HistoryFixture,
    seeds: SeedsByGroup,
  ) => unknown;
}

export interface RegisteredCostGroup {
  name: string;
  seed: (db: DbConnection, fixture: HistoryFixture, scale: number) => unknown;
  cases: readonly RegisteredCostCase[];
}

export function registerCostGroup<TSeed>(
  group: QueryCostGroup<TSeed>,
): RegisteredCostGroup {
  const seedOf = (seeds: SeedsByGroup) => seeds[group.name] as TSeed;
  return {
    name: group.name,
    seed: group.seed,
    cases: group.cases.map((costCase) => {
      const { prepare } = costCase;
      return {
        name: costCase.name,
        ...(costCase.ceilingMs === undefined
          ? {}
          : { ceilingMs: costCase.ceilingMs }),
        ...(costCase.reason === undefined ? {} : { reason: costCase.reason }),
        ...(prepare === undefined
          ? {}
          : {
              prepare: (db, fixture, seeds) =>
                prepare(db, fixture, seedOf(seeds)),
            }),
        run: (db, fixture, seeds) => costCase.run(db, fixture, seedOf(seeds)),
      } satisfies RegisteredCostCase;
    }),
  };
}

export const HISTORY_TURNS_AT_FULL_SCALE = 10_000;
export const SMALL_SCALE = 0.5;
export const LARGE_SCALE = 1;
export const GROWTH_LIMIT = 3;
export const GROWTH_FLOOR_MS = 2;
export const DEFAULT_CEILING_MS = 250;
export const KILL_AFTER_MS = 5_000;

export function scaled(count: number, scale: number): number {
  return Math.max(1, Math.round(count * scale));
}
