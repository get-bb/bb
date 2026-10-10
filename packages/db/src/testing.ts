import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "./connection.js";
import type { CreateConnectionOptions, DbConnection } from "./connection.js";
import { migrate } from "./migrate.js";

const TEMPLATE_PATH_ENV = "BB_TEST_MIGRATED_DB_TEMPLATE";

let migratedTemplate: Buffer | null = null;

function buildMigratedTemplate(): Buffer {
  const db = createConnection(":memory:");
  try {
    migrate(db);
    return db.$client.serialize();
  } finally {
    db.$client.close();
  }
}

function getMigratedTemplate(): Buffer {
  if (migratedTemplate === null) {
    const templatePath = process.env[TEMPLATE_PATH_ENV];
    migratedTemplate =
      templatePath === undefined
        ? buildMigratedTemplate()
        : readFileSync(templatePath);
  }

  return migratedTemplate;
}

export function prepareMigratedConnectionTemplate(): void {
  getMigratedTemplate();
}

export function createMigratedConnection(
  options: CreateConnectionOptions = {},
): DbConnection {
  return createConnection(getMigratedTemplate(), options);
}

export function setupMigratedConnectionTemplate(): () => void {
  const templatePath = join(
    tmpdir(),
    `bb-migrated-db-template-${process.pid}.sqlite`,
  );
  writeFileSync(templatePath, buildMigratedTemplate());
  process.env[TEMPLATE_PATH_ENV] = templatePath;
  return () => {
    delete process.env[TEMPLATE_PATH_ENV];
    rmSync(templatePath, { force: true });
  };
}
