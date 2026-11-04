import type { ConnectDb } from "@bb/connect-db";
import { openConnectDb } from "@bb/connect-db-pg";
import type { Env } from "./env.js";

export function connectDbFromEnv(env: Env): ConnectDb {
  return openConnectDb(env).db;
}
