import { randomBytes } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BbAppManagedConfig,
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { z } from "zod";
import { readJsonFileText } from "./json-file.js";
import { SERVER_MOVED_FILE_NAME, type ServerMovedFile } from "./markers.js";

const MOVED_DAEMON_CONFIG_KEYS: readonly string[] = [
  "serverUrl",
  "serverHeaders",
  "machineCredential",
  "connectMachineId",
];
const managedConfigObjectSchema = z.record(z.string(), z.unknown());
const MOVED_SERVER_PROBE_TIMEOUT_MS = 5_000;

const healthResponseSchema = z.object({
  ok: z.literal(true),
  serverMove: z.object({ state: z.string() }).optional(),
});

export type MovedServerProbeResult =
  | { kind: "running" }
  | { kind: "not-running" }
  | { kind: "unconfirmed"; status: number };

export interface ProbeMovedServerArgs {
  dataDir: string;
  lock: ServerMovedFile;
}

async function isHealthyServer(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(MOVED_SERVER_PROBE_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const health = healthResponseSchema.safeParse(await response.json());
    return health.success && health.data.serverMove?.state !== "pending";
  } catch {
    return false;
  }
}

async function readMovedServerHeaders(
  dataDir: string,
): Promise<Record<string, string> | null> {
  const configPath = formatBbAppConfigPath(dataDir);
  const text = await readJsonFileText(configPath);
  if (text === null) return null;
  const headers = parseManagedConfigText(configPath, text).config.serverHeaders;
  return headers === undefined || Object.keys(headers).length === 0
    ? null
    : headers;
}

export async function probeMovedServer(
  args: ProbeMovedServerArgs,
): Promise<MovedServerProbeResult> {
  const serverUrl = args.lock.serverUrl.replace(/\/+$/u, "");
  const headers =
    args.lock.mode === "connect"
      ? await readMovedServerHeaders(args.dataDir)
      : null;
  if (headers === null) {
    return (await isHealthyServer(serverUrl))
      ? { kind: "running" }
      : { kind: "not-running" };
  }
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/v1/system/version`, {
      headers,
      signal: AbortSignal.timeout(MOVED_SERVER_PROBE_TIMEOUT_MS),
    });
  } catch {
    return { kind: "not-running" };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 200) return { kind: "running" };
  if (response.status === 503) return { kind: "not-running" };
  return { kind: "unconfirmed", status: response.status };
}

async function writeTextAtomically(path: string, text: string): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

interface ParsedManagedConfig {
  raw: Record<string, unknown>;
  config: BbAppManagedConfig;
}

function parseManagedConfigText(
  path: string,
  text: string,
): ParsedManagedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON. Fix it, then unlock again.`, {
      cause: error,
    });
  }
  let config: BbAppManagedConfig;
  try {
    config = parseBbAppManagedConfig(raw);
  } catch (error) {
    const detail =
      error instanceof z.ZodError ? z.prettifyError(error) : String(error);
    throw new Error(
      `${path} is not a valid bb-app config. Fix it, then unlock again.\n${detail}`,
    );
  }
  return { raw: managedConfigObjectSchema.parse(raw), config };
}

export async function unlockServerCopy(dataDir: string): Promise<string[]> {
  const lockPath = join(dataDir, SERVER_MOVED_FILE_NAME);
  const configPath = formatBbAppConfigPath(dataDir);
  const originalText = await readJsonFileText(configPath);
  if (originalText === null) {
    await rm(lockPath, { force: true });
    return [];
  }
  const current = parseManagedConfigText(configPath, originalText).raw;
  const removedConfigKeys = MOVED_DAEMON_CONFIG_KEYS.filter((key) =>
    Object.hasOwn(current, key),
  );
  if (removedConfigKeys.length === 0) {
    await rm(lockPath, { force: true });
    return [];
  }
  const next = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) => !MOVED_DAEMON_CONFIG_KEYS.includes(key),
    ),
  );
  parseBbAppManagedConfig(next);
  await writeTextAtomically(configPath, `${JSON.stringify(next, null, 2)}\n`);
  try {
    await rm(lockPath, { force: true });
  } catch (error) {
    await writeTextAtomically(configPath, originalText);
    throw error;
  }
  return removedConfigKeys;
}
