import { createConnection, migrate } from "../../src/index.js";
import type { DbConnection } from "../../src/index.js";

let migratedTemplate: Buffer | null = null;

function getMigratedTemplate(): Buffer {
  if (migratedTemplate === null) {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      migratedTemplate = db.$client.serialize();
    } finally {
      db.$client.close();
    }
  }

  return migratedTemplate;
}

/** Build the shared template outside a test's timeout budget. */
export function prepareMigratedConnectionTemplate(): void {
  getMigratedTemplate();
}

/**
 * A fresh in-memory database with every migration applied, exactly as
 * `createConnection(":memory:")` followed by `migrate(db)` leaves it. The
 * first call migrates for real and keeps the serialized image; every later
 * call opens an independent copy of that image. Replaying the 100+
 * migrations costs ~57ms, which the data suites paid once per test.
 *
 * Tests that exercise the initial migration keep calling `migrate` directly.
 * Migration tests may use this only for current-schema setup that they rewind
 * before exercising a later `migrate` boundary.
 */
export function createMigratedConnection(): DbConnection {
  return createConnection(getMigratedTemplate());
}
