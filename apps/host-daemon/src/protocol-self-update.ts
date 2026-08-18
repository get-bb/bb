import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import type { FetchFn } from "./server-client.js";
import { usesSecureInternalFetchTransport } from "./server-client.js";

const execFileAsync = promisify(execFile);
export const SELF_UPDATE_INITIAL_RETRY_DELAY_MS = 5_000;
export const SELF_UPDATE_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const ATTEMPT_FILE_NAME = "host-daemon-update-attempt.json";

interface UpdateVersion {
  protocolVersion: number;
  version: string;
}

interface UpdateAttempt {
  attemptedAt: number;
  attemptCount: number;
  protocolVersion: number;
}

export type ProtocolSelfUpdateResult = "failed" | "skipped" | "updated";

export interface ProtocolSelfUpdater {
  handleProtocolMismatch(options?: {
    force?: boolean;
  }): Promise<ProtocolSelfUpdateResult>;
}

export interface ProtocolSelfUpdateInstaller {
  (tarballPath: string): Promise<void>;
}

interface SelfUpdateProcessRunner {
  (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ): Promise<void>;
}

interface CreateProtocolSelfUpdaterOptions {
  dataDir: string;
  enabled: boolean;
  logger: HostDaemonLogger;
  serverUrl: string;
  fetchFn?: FetchFn;
  installTarball?: ProtocolSelfUpdateInstaller;
  runProcess?: SelfUpdateProcessRunner;
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

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    SELF_UPDATE_INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    SELF_UPDATE_MAX_RETRY_DELAY_MS,
  );
}

async function readLastAttempt(path: string): Promise<UpdateAttempt | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "attemptedAt" in parsed &&
      typeof parsed.attemptedAt === "number" &&
      "attemptCount" in parsed &&
      typeof parsed.attemptCount === "number" &&
      Number.isSafeInteger(parsed.attemptCount) &&
      parsed.attemptCount > 0 &&
      "protocolVersion" in parsed &&
      typeof parsed.protocolVersion === "number" &&
      Number.isSafeInteger(parsed.protocolVersion) &&
      parsed.protocolVersion > 0
    ) {
      return {
        attemptedAt: parsed.attemptedAt,
        attemptCount: parsed.attemptCount,
        protocolVersion: parsed.protocolVersion,
      };
    }
  } catch {
    // A missing or corrupt marker must not permanently disable repairs.
  }
  return null;
}

async function writeAttempt(
  path: string,
  attempt: UpdateAttempt,
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(attempt)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

const defaultRunProcess: SelfUpdateProcessRunner = async (
  command,
  args,
  options,
) => {
  await execFileAsync(command, args, options);
};

// bb-app depends on native add-ons whose binaries are fetched or built by npm
// lifecycle scripts. npm >= 12 blocks dependency install scripts for global
// installs unless they are named in --allow-scripts; the installed package's
// own package.json#allowScripts is not consulted for `npm install -g`.
// npm 10 ignores the unknown flag; npm 11 accepts it.
const BB_APP_ALLOW_SCRIPTS_ARG =
  "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher";

async function defaultInstallTarball(
  tarballPath: string,
  runProcess: SelfUpdateProcessRunner,
): Promise<void> {
  const executableDirectory = dirname(process.execPath);
  const inheritedPath = process.env.PATH;
  const path = inheritedPath
    ? `${executableDirectory}${delimiter}${inheritedPath}`
    : executableDirectory;
  // Installer-managed services keep bb-app under their enrollment data dir.
  // Legacy/manual daemons omit this and retain their existing global behavior.
  const rawConfiguredPrefix = process.env.BB_APP_NPM_PREFIX?.trim();
  const configuredPrefix =
    rawConfiguredPrefix === "" ? undefined : rawConfiguredPrefix;
  if (configuredPrefix !== undefined && !isAbsolute(configuredPrefix)) {
    throw new Error("BB_APP_NPM_PREFIX must be an absolute path");
  }
  const prefixArgs =
    configuredPrefix === undefined ? [] : ["--prefix", configuredPrefix];
  await runProcess(
    "npm",
    ["install", "-g", BB_APP_ALLOW_SCRIPTS_ARG, ...prefixArgs, tarballPath],
    {
      env: { ...process.env, PATH: path },
    },
  );
}

export function createProtocolSelfUpdater(
  options: CreateProtocolSelfUpdaterOptions,
): ProtocolSelfUpdater {
  const fetchFn = options.fetchFn ?? fetch;
  const installTarball =
    options.installTarball ??
    ((tarballPath) =>
      defaultInstallTarball(
        tarballPath,
        options.runProcess ?? defaultRunProcess,
      ));
  const now = options.now ?? Date.now;
  const attemptPath = join(options.dataDir, ATTEMPT_FILE_NAME);

  return {
    async handleProtocolMismatch(
      handleOptions: { force?: boolean } = {},
    ): Promise<ProtocolSelfUpdateResult> {
      if (!options.enabled) {
        options.logger.error(
          { daemonProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION },
          "Daemon auto-update is disabled; install the server's bb-app package manually.",
        );
        return "skipped";
      }
      if (!usesSecureInternalFetchTransport(options.serverUrl)) {
        options.logger.error(
          { serverUrl: options.serverUrl },
          "Refusing daemon auto-update over insecure transport; install the server's bb-app package manually. Keeping the current daemon running and retrying normally.",
        );
        return "failed";
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
        const previousAttempt =
          lastAttempt?.protocolVersion === server.protocolVersion
            ? lastAttempt
            : null;
        const delayMs =
          previousAttempt === null
            ? 0
            : retryDelayMs(previousAttempt.attemptCount);
        const retryAt =
          previousAttempt === null
            ? attemptedAt
            : previousAttempt.attemptedAt + delayMs;
        if (!handleOptions.force && attemptedAt < retryAt) {
          options.logger.warn(
            {
              attemptCount: previousAttempt?.attemptCount ?? 0,
              retryAt,
              retryDelayMs: delayMs,
              serverProtocolVersion: server.protocolVersion,
            },
            "Daemon self-update is backing off; keeping the current daemon running.",
          );
          return "skipped";
        }
        await writeAttempt(attemptPath, {
          attemptedAt,
          attemptCount:
            handleOptions.force || previousAttempt === null
              ? 1
              : previousAttempt.attemptCount + 1,
          protocolVersion: server.protocolVersion,
        });

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
