import { type OpenConnectDb, openConnectDb } from "@bb/connect-db-pg";
import type { Env } from "./tunnel-do.js";

export function openGateDb(env: Env): OpenConnectDb {
  return openConnectDb(env);
}
