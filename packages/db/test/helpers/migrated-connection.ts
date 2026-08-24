import { createConnection, migrate } from "../../src/index.js";
import type { DbConnection } from "../../src/index.js";

let migratedTemplate: Buffer | null = null;

/**
 * A fresh in-memory database with every migration applied, exactly as
 * `createConnection(":memory:")` followed by `migrate(db)` leaves it. The
 * first call migrates for real and keeps the serialized image; every later
 * call opens an independent copy of that image. Replaying the 100+
 * migrations costs ~57ms, which the data suites paid once per test.
 *
 * Suites that exercise `migrate` itself keep calling it directly.
 */
export function createMigratedConnection(): DbConnection {
  if (migratedTemplate === null) {
    const db = createConnection(":memory:");
    migrate(db);
    migratedTemplate = db.$client.serialize();
  }
  return createConnection(migratedTemplate);
}
