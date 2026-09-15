import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { withFileLock } from "@bb/config/file-lock";
import { mutateManagedJsonFile } from "@bb/config/managed-json-file";
import type { ServerMoveMode } from "@bb/domain";
import {
  SERVER_MOVED_FILE_NAME,
  writeServerMovedFile,
  type ServerMovedFile,
} from "@bb/server-archive";
import {
  parseManagedConfigObject,
  readOptionalText,
  writeTextAtomically,
} from "./managed-files.js";

const CONFIG_LOCK_TIMEOUT_MS = 5_000;
const OLD_SERVER_KEPT_ENTRIES: ReadonlySet<string> = new Set([
  "config.json",
  "env.json",
]);

export interface OldServerDaemonConfigBackup {
  originalText: string | null;
  path: string;
}

export interface WriteOldServerDaemonConfigArgs {
  dataDir: string;
  headers: Record<string, string>;
  serverUrl: string;
}

export interface ServerMovedTargetHost {
  id: string;
  type: "persistent" | "ephemeral";
}

export interface ListServerMovedTargetsArgs {
  connectedHosts: readonly ServerMovedTargetHost[];
  mode: ServerMoveMode;
  sourceServerHostId: string;
  targetHostId: string;
}

export interface OldCopyInventoryEntry {
  path: string;
}

export async function writeOldServerDaemonConfig(
  args: WriteOldServerDaemonConfigArgs,
): Promise<OldServerDaemonConfigBackup> {
  const path = formatBbAppConfigPath(args.dataDir);
  const backup: OldServerDaemonConfigBackup = { originalText: null, path };
  await mutateManagedJsonFile({
    path,
    read: async () => {
      backup.originalText = await readOptionalText(path);
      return parseManagedConfigObject(path, backup.originalText);
    },
    mutate: ({
      machineCredential: _machineCredential,
      serverHeaders: _serverHeaders,
      ...current
    }) => {
      const next: Record<string, unknown> = {
        ...current,
        serverUrl: args.serverUrl,
        ...(Object.keys(args.headers).length > 0
          ? { serverHeaders: args.headers }
          : {}),
      };
      parseBbAppManagedConfig(next);
      return next;
    },
  });
  return backup;
}

export async function restoreOldServerDaemonConfig(
  backup: OldServerDaemonConfigBackup,
): Promise<void> {
  const originalText = backup.originalText;
  await withFileLock({
    path: join(dirname(backup.path), `.${basename(backup.path)}.lock`),
    timeoutMs: CONFIG_LOCK_TIMEOUT_MS,
    work: async () => {
      if (originalText === null) {
        await rm(backup.path, { force: true });
        return;
      }
      parseManagedConfigObject(backup.path, originalText);
      await writeTextAtomically(backup.path, originalText);
    },
  });
}

export function listOldCopyEntries(
  entries: readonly OldCopyInventoryEntry[],
): string[] {
  return [
    ...new Set(
      entries
        .map((entry) => entry.path)
        .filter((path) => !OLD_SERVER_KEPT_ENTRIES.has(path)),
    ),
  ].sort();
}

export async function lockOldServerDataDir(
  dataDir: string,
  file: ServerMovedFile,
): Promise<void> {
  await writeServerMovedFile(dataDir, file);
}

export async function unlockOldServerDataDir(dataDir: string): Promise<void> {
  await rm(join(dataDir, SERVER_MOVED_FILE_NAME), { force: true });
}

export function listServerMovedTargets(
  args: ListServerMovedTargetsArgs,
): string[] {
  if (args.mode === "connect") {
    return args.connectedHosts.some(
      (host) => host.id === args.sourceServerHostId,
    )
      ? [args.sourceServerHostId]
      : [];
  }
  return args.connectedHosts
    .filter(
      (host) => host.type === "persistent" && host.id !== args.targetHostId,
    )
    .map((host) => host.id)
    .sort();
}
