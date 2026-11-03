import type { ConnectDb } from "@bb/connect-db";
import {
  type ConnectDbBackends,
  type ConnectDbEnv,
  type ConnectDbMode,
  connectDbBackends,
  createConnectDb,
  resolveConnectDbMode,
} from "@bb/connect-db/store";
import { type PgConnection, connectPg } from "./pg-client.js";

export { connectPg, type PgConnection } from "./pg-client.js";

export type WaitUntil = (promise: Promise<unknown>) => void;

export interface OpenConnectDb {
  db: ConnectDb;
  backends(): Promise<ConnectDbBackends & { mode: ConnectDbMode }>;
  close(): Promise<void>;
}

export function openConnectDb(
  env: ConnectDbEnv,
  waitUntil: WaitUntil,
  fixedMode?: ConnectDbMode,
): OpenConnectDb {
  let pgConnection: PgConnection | null = null;
  const connection = (): PgConnection => {
    if (!env.HYPERDRIVE) {
      throw new Error("connect-db: Postgres mode needs a HYPERDRIVE binding");
    }
    pgConnection ??= connectPg(env.HYPERDRIVE.connectionString);
    return pgConnection;
  };
  let resolved: Promise<ConnectDbBackends & { mode: ConnectDbMode }> | null =
    null;
  const backends = () => {
    resolved ??= (async () => {
      const mode = fixedMode ?? (await resolveConnectDbMode(env));
      return { mode, ...connectDbBackends(env, mode, connection) };
    })().catch((error: unknown) => {
      resolved = null;
      throw error;
    });
    return resolved;
  };
  const handle = createConnectDb({ backends, waitUntil });
  return {
    db: handle.db,
    backends,
    async close() {
      await handle.mirrored();
      await pgConnection?.close();
    },
  };
}
