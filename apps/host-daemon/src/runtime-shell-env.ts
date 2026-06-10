import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import { assignIfDefined } from "@bb/config/objects";

interface ResolveLocalBbExecutableDirectoryOptions {
  cliExecutablePath?: string;
}

export interface PrepareRuntimeShellEnvOptions {
  appsRootPath: string;
  bbExecutableDirectory: string;
  hostDaemonPort?: number;
  serverUrl: string;
  inheritedPath?: string;
}

function getDefaultCliExecutablePath(): string {
  return fileURLToPath(new URL("../../cli/bin/bb", import.meta.url));
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function resolveCliEntryPath(cliExecutablePath: string): Promise<string> {
  const cliEntryPath = resolve(cliExecutablePath);

  try {
    const stats = await fs.stat(cliEntryPath);
    if (!stats.isFile()) {
      throw new Error(`Resolved bb CLI entry is not a file: ${cliEntryPath}`);
    }
    if (process.platform !== "win32") {
      try {
        await fs.access(cliEntryPath, fsConstants.X_OK);
      } catch (error) {
        if (getErrorCode(error) === "EACCES") {
          throw new Error(
            `Resolved bb CLI entry is not executable: ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
          );
        }
        throw error;
      }
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error(
        `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
      );
    }
    throw error;
  }

  return cliEntryPath;
}

function prependPath(
  executableDirectoryPath: string,
  inheritedPath?: string,
): string {
  return inheritedPath
    ? `${executableDirectoryPath}${delimiter}${inheritedPath}`
    : executableDirectoryPath;
}

export async function resolveLocalBbExecutableDirectory(
  options: ResolveLocalBbExecutableDirectoryOptions = {},
): Promise<string> {
  const resolvedCliExecutablePath =
    options.cliExecutablePath ?? getDefaultCliExecutablePath();
  const cliEntryPath = await resolveCliEntryPath(resolvedCliExecutablePath);

  return dirname(cliEntryPath);
}

export interface PrepareWorkflowAgentShellEnvOptions {
  appsRootPath: string;
  /** Directory the failing `bb` shim is materialized into (created if needed). */
  shimDirectoryPath: string;
  inheritedPath?: string;
}

/** What a workflow agent sees on stderr when it tries to run bb. */
export const WORKFLOW_AGENT_BB_SHIM_MESSAGE =
  "bb is not available inside workflow agent sessions (workflows cannot spawn threads or nested workflow runs)";

/**
 * Write the failing `bb` shim into the shim directory: a POSIX sh script plus
 * a `bb.cmd` for Windows shells (which resolve PATHEXT names, never the
 * extensionless script). Idempotent — rewritten on every daemon start so the
 * message stays current.
 */
async function materializeBbShim(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
  const posixShimPath = join(directoryPath, "bb");
  await fs.writeFile(
    posixShimPath,
    `#!/bin/sh\necho "${WORKFLOW_AGENT_BB_SHIM_MESSAGE}" >&2\nexit 1\n`,
  );
  await fs.chmod(posixShimPath, 0o755);
  await fs.writeFile(
    join(directoryPath, "bb.cmd"),
    `@echo off\r\necho ${WORKFLOW_AGENT_BB_SHIM_MESSAGE} 1>&2\r\nexit /b 1\r\n`,
  );
}

/**
 * Restricted base shell env for `sessionKind: "workflowAgent"` sessions (the
 * no-nesting enforcement, plan §6): no `BB_SERVER_URL` / `BB_HOST_DAEMON_PORT`
 * (the bb CLI fails fast without a server URL), and `bb` resolves to a
 * daemon-materialized shim that exits nonzero with a clear message. The shim
 * directory is prepended to the otherwise-intact inherited PATH — it shadows
 * every real bb (built CLI dir, dev shell, global install) without dropping
 * any toolchain directory, which stripping bb-containing directories would do
 * whenever a foreign `bb` (e.g. Babashka) shares a directory with node/git.
 * `BB_APPS_ROOT` is kept — harmless and useful. The per-thread vars
 * (`BB_ENVIRONMENT_ID`, `BB_PROJECT_ID`, `BB_THREAD_STORAGE`) are added by
 * the agent runtime, which also omits `BB_THREAD_ID` for workflow agents.
 */
export async function prepareWorkflowAgentShellEnv(
  options: PrepareWorkflowAgentShellEnvOptions,
): Promise<NonNullable<AgentRuntimeOptions["workflowAgentShellEnv"]>> {
  await materializeBbShim(options.shimDirectoryPath);
  return {
    PATH: prependPath(
      options.shimDirectoryPath,
      options.inheritedPath ?? process.env.PATH,
    ),
    BB_APPS_ROOT: options.appsRootPath,
  };
}

export function prepareRuntimeShellEnv(
  options: PrepareRuntimeShellEnvOptions,
): NonNullable<AgentRuntimeOptions["shellEnv"]> {
  const shellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]> = {
    PATH: prependPath(
      options.bbExecutableDirectory,
      options.inheritedPath ?? process.env.PATH,
    ),
    BB_APPS_ROOT: options.appsRootPath,
    BB_SERVER_URL: options.serverUrl,
  };
  assignIfDefined({
    key: "BB_HOST_DAEMON_PORT",
    target: shellEnv,
    value:
      options.hostDaemonPort === undefined
        ? undefined
        : String(options.hostDaemonPort),
  });

  return shellEnv;
}
