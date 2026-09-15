import { readFile } from "node:fs/promises";
import {
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { isFileNotFoundError, writeFileAtomically } from "./fs.js";

const MACHINE_CONNECTION_KEYS = [
  "serverUrl",
  "serverHeaders",
  "machineCredential",
  "connectMachineId",
] as const;

const MACHINE_CREDENTIAL_KEYS = [
  "serverHeaders",
  "machineCredential",
  "connectMachineId",
] as const;

export interface RewriteManagedConfigServerArgs {
  dataDir: string;
  serverUrl: string;
  headers: Record<string, string> | null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readManagedConfigObject(
  path: string,
): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  parseBbAppManagedConfig(parsed);
  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid bb-app config at ${path}`);
  }
  return parsed;
}

async function updateManagedConfig(
  dataDir: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const path = formatBbAppConfigPath(dataDir);
  const next = update(await readManagedConfigObject(path));
  parseBbAppManagedConfig(next);
  await writeFileAtomically({
    path,
    content: `${JSON.stringify(next, null, 2)}\n`,
    mode: 0o600,
  });
}

export async function rewriteManagedConfigServer(
  args: RewriteManagedConfigServerArgs,
): Promise<void> {
  await updateManagedConfig(args.dataDir, (current) => {
    const next: Record<string, unknown> = {
      ...current,
      serverUrl: args.serverUrl,
    };
    if (args.headers === null) {
      return next;
    }
    for (const key of MACHINE_CREDENTIAL_KEYS) {
      delete next[key];
    }
    if (Object.keys(args.headers).length > 0) {
      next.serverHeaders = { ...args.headers };
    }
    return next;
  });
}

export async function restoreMachineConnectionConfig(args: {
  dataDir: string;
  backupConfigPath: string;
}): Promise<void> {
  const backup = await readManagedConfigObject(args.backupConfigPath);
  await updateManagedConfig(args.dataDir, (current) => {
    const next: Record<string, unknown> = { ...current };
    for (const key of MACHINE_CONNECTION_KEYS) {
      if (key in backup) {
        next[key] = backup[key];
      } else {
        delete next[key];
      }
    }
    return next;
  });
}

export async function switchConfigToLocalServer(args: {
  dataDir: string;
  serverUrl: string;
}): Promise<void> {
  await updateManagedConfig(args.dataDir, (current) => {
    const next: Record<string, unknown> = {
      ...current,
      serverUrl: args.serverUrl,
    };
    for (const key of MACHINE_CREDENTIAL_KEYS) {
      delete next[key];
    }
    return next;
  });
}
