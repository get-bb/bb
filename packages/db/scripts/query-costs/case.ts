import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "./fixture.js";

export interface QueryCostCase {
  name: string;
  budgetMs?: number;
  reason?: string;
  prepare?: (db: DbConnection, fixture: HistoryFixture) => void;
  run: (db: DbConnection, fixture: HistoryFixture) => unknown;
}

export const DEFAULT_BUDGET_MS = 25;
