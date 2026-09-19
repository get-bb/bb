import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import {
  resolveCurrentDevInstanceConfig,
  toDevProcessEnv,
  type DevInstanceConfig,
} from "@bb/config/runtime";
import { runScriptProcess } from "../lib/process-helpers.js";
import { repoRoot, runMainIfEntrypoint } from "../lib/script-entry.js";

interface PortAvailabilityCheck {
  label: string;
  port: number;
}

interface DesktopCommand {
  args: string[];
  command: string;
  cwd: string;
}

export type DesktopLaunchMode = "prod" | "worktree";

const LOOPBACK_HOST = "127.0.0.1";

export function resolveDesktopPackageTask(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "package";
  if (platform === "linux") return "package:linux";
  throw new Error(
    `[desktop] Packaging is supported on macOS and Linux, not ${platform}.`,
  );
}

export function createDesktopPackageCommand(
  platform: NodeJS.Platform,
): DesktopCommand {
  return {
    args: [
      "exec",
      "turbo",
      "run",
      resolveDesktopPackageTask(platform),
      "--filter=@bb/desktop",
      "--output-logs=new-only",
    ],
    command: "pnpm",
    cwd: repoRoot,
  };
}

export function createDesktopRunCommand(): DesktopCommand {
  return {
    args: [
      resolve(repoRoot, "apps", "desktop", "scripts", "run-packaged-app.mjs"),
    ],
    command: process.execPath,
    cwd: join(repoRoot, "apps", "desktop"),
  };
}

export function resolveDesktopLaunchMode(args: string[]): DesktopLaunchMode {
  if (args.length === 0) {
    return "prod";
  }
  if (args.length === 1 && args[0] === "--worktree") {
    return "worktree";
  }
  throw new Error(
    `[desktop] Unknown arguments: ${args.join(" ")}. Expected no arguments or --worktree.`,
  );
}

export function resolveDesktopUserDataDir(
  baseEnv: NodeJS.ProcessEnv,
  config: DevInstanceConfig,
): string {
  const rawUserDataDir = baseEnv.BB_DESKTOP_USER_DATA_DIR?.trim();
  if (rawUserDataDir === undefined || rawUserDataDir.length === 0) {
    return join(config.dataDir, "desktop");
  }
  return resolve(rawUserDataDir);
}

export function toDesktopLaunchProcessEnv(args: {
  baseEnv: NodeJS.ProcessEnv;
  config: DevInstanceConfig;
  mode: DesktopLaunchMode;
}): NodeJS.ProcessEnv {
  if (args.mode === "prod") {
    return {
      ...args.baseEnv,
      BB_DESKTOP_OPEN_DEVTOOLS: args.baseEnv.BB_DESKTOP_OPEN_DEVTOOLS ?? "0",
      NODE_ENV: "production",
    };
  }

  const env = toDevProcessEnv({
    baseEnv: args.baseEnv,
    config: args.config,
  });
  delete env.BB_DEV_APP_PORT;
  env.BB_DESKTOP_OPEN_DEVTOOLS = args.baseEnv.BB_DESKTOP_OPEN_DEVTOOLS ?? "0";
  env.BB_DESKTOP_USER_DATA_DIR = resolveDesktopUserDataDir(
    args.baseEnv,
    args.config,
  );
  env.BB_TELEMETRY = "false";
  env.NODE_ENV = "production";
  return env;
}

function formatConfig(
  config: DevInstanceConfig,
  mode: DesktopLaunchMode,
  desktopUserDataDir: string | undefined,
): string {
  const prefix = mode === "worktree" ? "[desktop:worktree]" : "[desktop]";
  if (mode === "prod") {
    return `${prefix} Packaged desktop app with its installed data directory and ports`;
  }
  if (desktopUserDataDir === undefined) {
    throw new Error("[desktop:worktree] Electron user data directory is missing");
  }
  return [
    `${prefix} Instance ${config.instanceId}`,
    `${prefix} Data dir ${config.dataDir}`,
    `${prefix} Electron user data ${desktopUserDataDir}`,
    `${prefix} Server ${config.serverUrl}`,
    `${prefix} Host daemon http://${LOOPBACK_HOST}:${config.ports.hostDaemonPort}`,
  ].join("\n");
}

function checkPortAvailable(check: PortAvailabilityCheck): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const server = createServer();
    const rejectWithPortError = (error: Error) => {
      rejectPromise(
        new Error(
          `[desktop:worktree] ${check.label} port ${check.port} is unavailable: ${error.message}`,
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

async function assertWorktreePortsAvailable(
  config: DevInstanceConfig,
): Promise<void> {
  await Promise.all(
    [
      { label: "server", port: config.ports.serverPort },
      { label: "host-daemon", port: config.ports.hostDaemonPort },
    ].map(checkPortAvailable),
  );
}

async function resolveExistingRepoRoot(): Promise<string> {
  await access(repoRoot);
  return repoRoot;
}

async function main(): Promise<void> {
  const mode = resolveDesktopLaunchMode(process.argv.slice(2));
  const resolvedRepoRoot = await resolveExistingRepoRoot();
  const config = resolveCurrentDevInstanceConfig(resolvedRepoRoot);
  if (mode === "worktree") {
    await assertWorktreePortsAvailable(config);
  }

  const env = toDesktopLaunchProcessEnv({
    baseEnv: process.env,
    config,
    mode,
  });
  process.stdout.write(
    `${formatConfig(config, mode, env.BB_DESKTOP_USER_DATA_DIR)}\n`,
  );
  const packageCommand = createDesktopPackageCommand(process.platform);
  const packageExitCode = await runScriptProcess({
    args: packageCommand.args,
    command: packageCommand.command,
    cwd: packageCommand.cwd,
    env,
    stdio: "inherit",
  });
  if (packageExitCode !== 0) {
    process.exitCode = packageExitCode;
    return;
  }

  const runCommand = createDesktopRunCommand();
  process.exitCode = await runScriptProcess({
    args: runCommand.args,
    command: runCommand.command,
    cwd: runCommand.cwd,
    env,
    stdio: "inherit",
  });
}

runMainIfEntrypoint(import.meta.url, main);
