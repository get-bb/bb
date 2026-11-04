import { connectPg } from "../src/pg-client.js";
import { applyConnectDbMigrations } from "../src/migrate.js";

const url = process.env.CONNECT_DB_PG_MIGRATOR_URL?.trim() ?? "";
if (url === "") {
  throw new Error("CONNECT_DB_PG_MIGRATOR_URL is required");
}
const pg = connectPg(url);
try {
  const applied = await applyConnectDbMigrations(pg);
  console.log(JSON.stringify({ applied }));
} finally {
  await pg.close();
}
