import { type ConnectDb, schema } from "@bb/connect-db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client, QueryConfig } from "pg";
import { connectPg } from "./pg-client.js";

export {
  connectPg,
  type PgConnection,
  type PgQueryResult,
  type PgQueryable,
} from "./pg-client.js";

export interface ConnectDbEnv {
  HYPERDRIVE: { connectionString: string };
}

export interface OpenConnectDb {
  db: ConnectDb;
  close(): Promise<void>;
}

export function openConnectDb(env: ConnectDbEnv): OpenConnectDb {
  const connection = connectPg(env.HYPERDRIVE.connectionString);
  const client = {
    async query(config: QueryConfig, values?: unknown[]) {
      return (await connection.client()).query(config, values);
    },
  };
  return {
    db: drizzle({ client: client as unknown as Client, schema }),
    close: () => connection.close(),
  };
}
