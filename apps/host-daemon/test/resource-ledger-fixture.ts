import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResourceLedger } from "../src/resource-ledger.js";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createTestResourceLedger(
  directory = mkdtempSync(path.join(os.tmpdir(), "bb-resource-ledger-")),
): ResourceLedger {
  return new ResourceLedger({
    directory,
    instanceId: randomUUID(),
    logger: silentLogger,
  });
}
