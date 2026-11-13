import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";

export interface QueryCostCase {
  name: string;
  ceilingMs?: number;
  reason?: string;
  prepare?: (db: DbConnection, fixture: HistoryFixture) => void;
  run: (db: DbConnection, fixture: HistoryFixture) => unknown;
}

export const SMALL_HISTORY_TURNS = 5_000;
export const LARGE_HISTORY_TURNS = 10_000;
export const GROWTH_LIMIT = 3;
export const GROWTH_FLOOR_MS = 2;
export const DEFAULT_CEILING_MS = 250;
export const KILL_AFTER_MS = 5_000;
