import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import type { FetchFn } from "./server-client.js";

const execFileAsync = promisify(execFile);
export const SELF_UPDATE_MIN_INTERVAL_MS = 15 * 60 * 1000;
const ATTEMPT_FILE_NAME = "host-daemon-update-attempt.json";

interface UpdateVersion {
  protocolVersion: number;
  version: string;
}

export type ProtocolSelfUpdateResult = "failed" | "skipped" | "updated";

export interface ProtocolSelfUpdater {
  handleProtocolMismatch(): Promise<ProtocolSelfUpdateResult>;
}

export interface ProtocolSelfUpdateInstaller {
  (tarballPath: string): Promise<void>;
}

interface CreateProtocolSelfUpdaterOptions {
  dataDir: string;
  enabled: boolean;
  logger: HostDaemonLogger;
  serverUrl: string;
  fetchFn?: FetchFn;
  installTarball?: ProtocolSelfUpdateInstaller;
  now?: () => number;
}

function parseUpdateVersion(value: unknown): UpdateVersion {
  if (
    value === null ||
    typeof value !== "object" ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !("protocolVersion" in value) ||
    !Number.isSafeInteger(value.protocolVersion) ||
    Number(value.protocolVersion) <= 0
  ) {
    throw new Error("Server returned an invalid install version response");
  }
  return {
    protocolVersion: Number(value.protocolVersion),
    version: value.version,
  };
}

async function readLastAttempt(path: string): Promise<number | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "attemptedAt" in parsed &&
      typeof parsed.attemptedAt === "number"
    ) {
      return parsed.attemptedAt;
    }
  } catch {
    // A missing or corrupt marker must not permanently disable repairs.
  }
  return null;
}

async function writeAttempt(path: string, attemptedAt: number): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ attemptedAt })}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function defaultInstallTarball(tarballPath: string): Promise<void> {
  await execFileAsync("npm", ["install", "-g", tarballPath]);
}

export function createProtocolSelfUpdater(
  options: CreateProtocolSelfUpdaterOptions,
): ProtocolSelfUpdater {
  const fetchFn = options.fetchFn ?? fetch;
  const installTarball = options.installTarball ?? defaultInstallTarball;
  const now = options.now ?? Date.now;
  const attemptPath = join(options.dataDir, ATTEMPT_FILE_NAME);

  return {
    async handleProtocolMismatch(): Promise<ProtocolSelfUpdateResult> {
      if (!options.enabled) {
        options.logger.error(
          { daemonProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION },
          "Daemon auto-update is disabled; install the server's bb-app package manually.",
        );
        return "skipped";
      }

      try {
        const versionUrl = new URL("/install/version", options.serverUrl);
        const versionResponse = await fetchFn(versionUrl, { method: "GET" });
        if (!versionResponse.ok) {
          throw new Error(
            `Version check failed: ${versionResponse.status} ${versionResponse.statusText}`,
          );
        }
        const server = parseUpdateVersion(await versionResponse.json());
        if (server.protocolVersion <= HOST_DAEMON_PROTOCOL_VERSION) {
          options.logger.error(
            {
              daemonProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
              serverProtocolVersion: server.protocolVersion,
              serverVersion: server.version,
            },
            server.protocolVersion < HOST_DAEMON_PROTOCOL_VERSION
              ? "Server protocol is older than this daemon; refusing to downgrade."
              : "Protocol mismatch did not require an upgrade; refusing to reinstall.",
          );
          return "skipped";
        }

        await mkdir(options.dataDir, { recursive: true });
        const attemptedAt = now();
        const lastAttempt = await readLastAttempt(attemptPath);
        if (
          lastAttempt !== null &&
          attemptedAt - lastAttempt < SELF_UPDATE_MIN_INTERVAL_MS
        ) {
          options.logger.warn(
            { attemptedAt: lastAttempt, minIntervalMs: SELF_UPDATE_MIN_INTERVAL_MS },
            "Daemon self-update is rate-limited; keeping the current daemon running.",
          );
          return "skipped";
        }
        await writeAttempt(attemptPath, attemptedAt);

        const tarballPath = join(
          options.dataDir,
          `bb-app-update-${process.pid}.tgz`,
        );
        try {
          const tarballUrl = new URL("/install/bb-app.tgz", options.serverUrl);
          const response = await fetchFn(tarballUrl, { method: "GET" });
          if (!response.ok) {
            throw new Error(
              `Package download failed: ${response.status} ${response.statusText}`,
            );
          }
          await writeFile(
            tarballPath,
            new Uint8Array(await response.arrayBuffer()),
            { mode: 0o600 },
          );
          await installTarball(tarballPath);
        } finally {
          await rm(tarballPath, { force: true });
        }

        options.logger.info(
          {
            daemonProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
            serverProtocolVersion: server.protocolVersion,
            serverVersion: server.version,
          },
          "Installed the server-matched bb-app package; restarting the daemon.",
        );
        return "updated";
      } catch (error) {
        options.logger.error(
          { err: error },
          "Daemon self-update failed; keeping the current daemon running and retrying normally.",
        );
        return "failed";
      }
    },
  };
}
