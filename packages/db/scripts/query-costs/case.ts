import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import type { QueryPlanAllowlistEntry } from "../../src/query-plan-guard.js";

export type GrowthAxisKey = "history" | "turnSize";

export type DeclaredGrowth = Partial<Readonly<Record<GrowthAxisKey, string>>>;

export interface QueryCostCase<TSeed = undefined> {
  name: string;
  variant?: string;
  ceilingMs?: number;
  reason?: string;
  growsWith?: DeclaredGrowth;
  prepare?: (db: DbConnection, fixture: HistoryFixture, seed: TSeed) => void;
  run: (db: DbConnection, fixture: HistoryFixture, seed: TSeed) => unknown;
}

export interface PluginDatabaseCosts {
  auditedTables: readonly string[];
  allowedFindings: readonly QueryPlanAllowlistEntry[];
}

export interface QueryCostGroup<TSeed> {
  name: string;
  pluginDatabase?: PluginDatabaseCosts;
  seed: (db: DbConnection, fixture: HistoryFixture, scale: number) => TSeed;
  cases: readonly QueryCostCase<TSeed>[];
}

export type SeedsByGroup = Readonly<Record<string, unknown>>;

export interface RegisteredCostCase {
  name: string;
  group: string;
  label: string;
  pluginDatabase?: PluginDatabaseCosts;
  ceilingMs?: number;
  reason?: string;
  growsWith?: DeclaredGrowth;
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
  pluginDatabase?: PluginDatabaseCosts;
  seed: (db: DbConnection, fixture: HistoryFixture, scale: number) => unknown;
  cases: readonly RegisteredCostCase[];
}

export function registerCostGroup<TSeed>(
  group: QueryCostGroup<TSeed>,
): RegisteredCostGroup {
  const seedOf = (seeds: SeedsByGroup) => seeds[group.name] as TSeed;
  return {
    name: group.name,
    ...(group.pluginDatabase === undefined
      ? {}
      : { pluginDatabase: group.pluginDatabase }),
    seed: group.seed,
    cases: group.cases.map((costCase) => {
      const { prepare } = costCase;
      return {
        name: costCase.name,
        group: group.name,
        label:
          costCase.variant === undefined
            ? costCase.name
            : `${costCase.name} (${costCase.variant})`,
        ...(group.pluginDatabase === undefined
          ? {}
          : { pluginDatabase: group.pluginDatabase }),
        ...(costCase.ceilingMs === undefined
          ? {}
          : { ceilingMs: costCase.ceilingMs }),
        ...(costCase.reason === undefined ? {} : { reason: costCase.reason }),
        ...(costCase.growsWith === undefined
          ? {}
          : { growsWith: costCase.growsWith }),
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
export const SMALL_SCALE = 1 / 16;
export const LARGE_SCALE = 1;
export const TURN_AXIS_SEED_SCALE = 0.5;
export const LONG_TURN_STEPS_AT_FULL_SCALE = 1_500;
export const BASELINE_LONG_TURN_STEPS = 100;
export const TURN_AXIS_HISTORY_TURNS = 500;
export const GROWTH_STEP = LARGE_SCALE / SMALL_SCALE;
export const GROWTH_DECLARATION_UNUSED_EXPONENT = 0.125;
export const GROWTH_BOUNDED_EXPONENT = 0.5;
export const GROWTH_WARN_EXPONENT = 1.5;
export const GROWTH_FAIL_EXPONENT = 2;
export const GROWTH_DECLARATION_UNUSED_LIMIT =
  GROWTH_STEP ** GROWTH_DECLARATION_UNUSED_EXPONENT;
export const GROWTH_BOUNDED_LIMIT = GROWTH_STEP ** GROWTH_BOUNDED_EXPONENT;
export const GROWTH_WARN_LIMIT = GROWTH_STEP ** GROWTH_WARN_EXPONENT;
export const GROWTH_FAIL_LIMIT = GROWTH_STEP ** GROWTH_FAIL_EXPONENT;
export const GROWTH_FLOOR_MS = 2;
export const DEFAULT_CEILING_MS = 100;
export const KILL_AFTER_MS = 5_000;

export function scaled(count: number, scale: number): number {
  return Math.max(1, Math.round(count * scale));
}
