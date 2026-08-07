import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCurrentDevInstanceConfig } from "@bb/config/runtime";

interface TurboBuildCommand {
  args: string[];
  command: string;
}

const libDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(libDir, "..", "..");
const repoRoot = resolve(packageRoot, "..", "..");

export function createTurboBuildCommand(filters: string[]): TurboBuildCommand {
  const args = [
    "x",
    "turbo",
    "run",
    "build",
    "--no-daemon",
    "--no-update-notifier",
    "--ui",
    "stream",
    "--output-logs",
    "errors-only",
  ];

  for (const filter of filters) {
    args.push("--filter", filter);
  }

  return {
    args,
    command: "bun",
  };
}

export function resolveDevDataDir(): string {
  return resolveCurrentDevInstanceConfig(repoRoot).dataDir;
}

export function resolveDevHostDaemonPort(): number {
  return resolveCurrentDevInstanceConfig(repoRoot).ports.hostDaemonPort;
}

export function resolveSupervisorPidPath(serviceName: string): string {
  return join(resolveDevDataDir(), "dev-supervisors", `${serviceName}.pid`);
}
