import { join } from "node:path";
import { resolveCurrentDevInstanceConfig } from "@bb/config/runtime";
import { repoRoot } from "./script-entry.js";

interface TurboBuildCommand {
  args: string[];
  command: string;
}

export function createTurboBuildCommand(filters: string[]): TurboBuildCommand {
  const args = [
    "exec",
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
    command: "pnpm",
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
