import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveCurrentDevInstanceConfig,
  toDevProcessEnv,
  type DevInstanceConfig,
} from "@bb/config/runtime";
import { migrateLegacyDevData } from "../lib/legacy-dev-data-migration.js";
import { runScriptProcess } from "../lib/process-helpers.js";

interface PortAvailabilityCheck {
  label: string;
  port: number;
}

interface DevTurboCommand {
  args: string[];
  command: string;
}

const LOOPBACK_HOST = "127.0.0.1";

const commandDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(commandDir, "..", "..");
const repoRoot = resolve(packageRoot, "..", "..");

export function createDevTurboCommand(): DevTurboCommand {
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

function formatConfig(config: DevInstanceConfig): string {
  return [
    `[dev] Instance ${config.instanceId}`,
    `[dev] Data dir ${config.dataDir}`,
    `[dev] App http://localhost:${config.ports.appPort}`,
    `[dev] Server ${config.serverUrl}`,
    `[dev] Host daemon http://127.0.0.1:${config.ports.hostDaemonPort}`,
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

async function assertPortsAvailable(config: DevInstanceConfig): Promise<void> {
  const checks: PortAvailabilityCheck[] = [
    { label: "app", port: config.ports.appPort },
    { label: "server", port: config.ports.serverPort },
    { label: "host-daemon", port: config.ports.hostDaemonPort },
  ];
  await Promise.all(checks.map(checkPortAvailable));
}

async function resolveExistingRepoRoot(): Promise<string> {
  await access(repoRoot);
  return repoRoot;
}

export async function main(): Promise<void> {
  const resolvedRepoRoot = await resolveExistingRepoRoot();
  const config = resolveCurrentDevInstanceConfig(resolvedRepoRoot);
  const migration = await migrateLegacyDevData({
    config,
    output: process.stdout,
  });
  if (migration.skippedReason === "legacy-dev-process-running") {
    throw new Error(
      "[dev] Legacy ~/.bb-dev data was found, but an old dev server or host-daemon is still running. Stop the old dev process and rerun pnpm dev to migrate it.",
    );
  }
  await assertPortsAvailable(config);
  process.stdout.write(`${formatConfig(config)}\n`);

  const turboCommand = createDevTurboCommand();
  process.exitCode = await runScriptProcess({
    args: turboCommand.args,
    command: turboCommand.command,
    cwd: config.repoRoot,
    env: toDevProcessEnv({
      baseEnv: process.env,
      config,
    }),
    stdio: "inherit",
  });
}

if (
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
