import {
  createConnection,
  type CreateConnectionOptions,
  type DbConnection,
} from "../../src/connection.js";

export function openPluginDatabase(
  source: string | Buffer,
  options: CreateConnectionOptions = {},
): DbConnection {
  const db = createConnection(source, options);
  db.$client.pragma("foreign_keys = OFF");
  return db;
}
