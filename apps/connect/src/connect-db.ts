import { type OpenConnectDb, openConnectDb } from "@bb/connect-db-pg";
import type { Env } from "./tunnel-do.js";

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function openGateDb(env: Env, ctx: WaitUntilContext): OpenConnectDb {
  return openConnectDb(env, (promise) => ctx.waitUntil(promise));
}
