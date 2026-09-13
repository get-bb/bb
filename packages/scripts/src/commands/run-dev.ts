import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  resolveCurrentDevInstanceConfig,
  toDevProcessEnv,
  type DevInstanceConfig,
} from "@bb/config/runtime";
import { migrateLegacyDevData } from "../lib/legacy-dev-data-migration.js";
import { runScriptProcess } from "../lib/process-helpers.js";
import { repoRoot, runMainIfEntrypoint } from "../lib/script-entry.js";

interface PortAvailabilityCheck {
  label: string;
  port: number;
}

interface DevCommand {
  args: string[];
  command: string;
}

export type DevLaunchMode = "vite" | "worktree";

const LOOPBACK_HOST = "127.0.0.1";

export function createDevTurboCommand(): DevCommand {
  return {
    args: [
      "exec",
      "turbo",
      "run",
      "dev",
      "--filter=@bb/app",
      "--filter=@bb/server",
      "--filter=@bb/host-daemon",
      "--ui",
      "tui",
      "--concurrency",
      "20",
      "--no-update-notifier",
    ],
    command: "pnpm",
  };
}

export function createStartWorktreeCommand(dryRun = false): DevCommand {
  return {
    args: [
      "--conditions=source",
      "--import",
      "tsx",
      resolve(repoRoot, "scripts", "start-bb.mjs"),
      "--worktree-runtime-policy",
      ...(dryRun ? ["--dryrun"] : []),
    ],
    command: process.execPath,
  };
}

export function resolveDevLaunchMode(args: string[]): DevLaunchMode {
  if (args.length === 0) {
    return "vite";
  }
  if (args.length === 1 && args[0] === "--worktree") {
    return "worktree";
  }
  throw new Error(
    `[dev] Unknown arguments: ${args.join(" ")}. Expected no arguments or --worktree.`,
  );
}

export function toDevLaunchProcessEnv(args: {
  baseEnv: NodeJS.ProcessEnv;
  config: DevInstanceConfig;
  mode: DevLaunchMode;
}): NodeJS.ProcessEnv {
  const env = toDevProcessEnv({
    baseEnv: args.baseEnv,
    config: args.config,
  });
  if (args.mode === "vite") {
    return env;
  }

  delete env.BB_DEV_APP_PORT;
  env.BB_TELEMETRY = "false";
  env.NODE_ENV = "production";
  return env;
}

function formatConfig(config: DevInstanceConfig, mode: DevLaunchMode): string {
  const prefix = mode === "worktree" ? "[start:worktree]" : "[dev]";
  const appUrl =
    mode === "worktree"
      ? config.serverUrl
      : `http://localhost:${config.ports.appPort}`;
  return [
    `${prefix} Instance ${config.instanceId}`,
    `${prefix} Data dir ${config.dataDir}`,
    `${prefix} App ${appUrl}`,
    `${prefix} Server ${config.serverUrl}`,
    `${prefix} Host daemon http://127.0.0.1:${config.ports.hostDaemonPort}`,
  ].join("\n");
}

function checkPortAvailable(check: PortAvailabilityCheck): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const server = createServer();
    const rejectWithPortError = (error: Error) => {
      rejectPromise(
        new Error(
          `[dev] ${check.label} port ${check.port} is unavailable: ${error.message}`,
        ),
      );
    };
    server.once("error", rejectWithPortError);
    server.listen(check.port, LOOPBACK_HOST, () => {
      server.removeListener("error", rejectWithPortError);
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  });
}

async function assertPortsAvailable(
  config: DevInstanceConfig,
  mode: DevLaunchMode,
): Promise<void> {
  const checks: PortAvailabilityCheck[] = [
    { label: "server", port: config.ports.serverPort },
    { label: "host-daemon", port: config.ports.hostDaemonPort },
  ];
  if (mode === "vite") {
    checks.unshift({ label: "app", port: config.ports.appPort });
  }
  await Promise.all(checks.map(checkPortAvailable));
}

async function resolveExistingRepoRoot(): Promise<string> {
  await access(repoRoot);
  return repoRoot;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dryrun");
  const mode = resolveDevLaunchMode(args.filter((arg) => arg !== "--dryrun"));
  if (dryRun && mode !== "worktree") {
    throw new Error(
      "--dryrun is supported by pnpm start and pnpm start:worktree.",
    );
  }
  const resolvedRepoRoot = await resolveExistingRepoRoot();
  const config = resolveCurrentDevInstanceConfig(resolvedRepoRoot);
  if (!dryRun) {
    const migration = await migrateLegacyDevData({
      config,
      output: process.stdout,
    });
    if (migration.skippedReason === "legacy-dev-process-running") {
      throw new Error(
        "[dev] Legacy ~/.bb-dev data was found, but an old dev server or host-daemon is still running. Stop the old dev process and rerun pnpm dev to migrate it.",
      );
    }
    await assertPortsAvailable(config, mode);
    process.stdout.write(`${formatConfig(config, mode)}\n`);
  }

  const command =
    mode === "worktree"
      ? createStartWorktreeCommand(dryRun)
      : createDevTurboCommand();
  process.exitCode = await runScriptProcess({
    args: command.args,
    command: command.command,
    cwd: config.repoRoot,
    env: toDevLaunchProcessEnv({
      baseEnv: process.env,
      config,
      mode,
    }),
    stdio: "inherit",
  });
}

runMainIfEntrypoint(import.meta.url, main);
