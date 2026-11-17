import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupMigratedConnectionTemplate } from "@bb/db/testing";
import { readProcessIdentity } from "@bb/process-utils";
import {
  killProcessesReferencingPath,
  listOpenFilePids,
  readPositivePidFile,
} from "@bb/test-helpers";
import { isNodeError, removePathWithRetry } from "./helpers/remove-path.js";
import { setupBuiltinHostBuildRecords } from "./helpers/builtin-plugin-fixture.js";

import { setupTestGitRepoTemplate } from "./helpers/seed.js";

const INTEGRATION_TMP_PREFIX = "bb-integration-";
const STALE_TMP_ROOT_AGE_MS = 60 * 60_000;
const PS_START_TIME_RESOLUTION_MS = 1_000;

function signal(pids: Iterable<number>, name: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ESRCH") throw error;
    }
  }
}

async function stopOpenFileHolders(tmpRoot: string): Promise<void> {
  let remaining = await listOpenFilePids(tmpRoot);
  if (remaining.length === 0) return;
  signal(remaining, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stillHolding = new Set(await listOpenFilePids(tmpRoot));
    remaining = remaining.filter((pid) => stillHolding.has(pid));
  }
  signal(remaining, "SIGKILL");
}

async function cleanupTmpRoot(tmpRoot: string): Promise<void> {
  await killProcessesReferencingPath(tmpRoot);
  await stopOpenFileHolders(tmpRoot).catch(() => undefined);
  await removePathWithRetry(tmpRoot);
}

async function hasLiveOwner(tmpRoot: string): Promise<boolean> {
  const pidFilePath = path.join(tmpRoot, "parent.pid");
  const writer = await readPositivePidFile(pidFilePath);
  if (writer === null) return false;
  const recordedAt = (await fs.stat(pidFilePath)).mtimeMs;
  const identity = await readProcessIdentity(writer);
  if (identity === null) return false;
  return (
    identity.startedAt === null ||
    identity.startedAt <= recordedAt + PS_START_TIME_RESOLUTION_MS
  );
}

async function listIntegrationTmpRoots(): Promise<string[]> {
  const entries = await fs.readdir(tmpdir(), { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith(INTEGRATION_TMP_PREFIX),
    )
    .map((entry) => path.join(tmpdir(), entry.name));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const now = Date.now();
  for (const tmpRoot of await listIntegrationTmpRoots()) {
    const metadata = await fs.stat(tmpRoot).catch(() => null);
    if (!metadata || now - metadata.mtimeMs < STALE_TMP_ROOT_AGE_MS) {
      continue;
    }

    if (await hasLiveOwner(tmpRoot)) {
      continue;
    }

    await cleanupTmpRoot(tmpRoot).catch(() => undefined);
  }
  const cleanupDatabaseTemplate = setupMigratedConnectionTemplate();
  let cleanupRepoTemplate: (() => Promise<void>) | undefined;
  try {
    cleanupRepoTemplate = await setupTestGitRepoTemplate();
    const cleanupBuiltinRecords = await setupBuiltinHostBuildRecords();
    return async () => {
      try {
        cleanupDatabaseTemplate();
      } finally {
        try {
          await cleanupBuiltinRecords();
        } finally {
          await cleanupRepoTemplate?.();
        }
      }
    };
  } catch (error) {
    cleanupDatabaseTemplate();
    await cleanupRepoTemplate?.();
    throw error;
  }
}
