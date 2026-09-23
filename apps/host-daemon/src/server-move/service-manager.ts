import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { ServiceDefinition } from "./service-definition.js";

const execFileAsync = promisify(execFile);
const SERVICE_COMMAND_TIMEOUT_MS = 30_000;

export const LAUNCHD_RESTART_SCRIPT = [
  'domain="$1"',
  'plist="$2"',
  "sleep 1",
  'launchctl bootout "$domain" "$plist" >/dev/null 2>&1 || true',
  "attempt=0",
  'while [ "$attempt" -lt 20 ]; do',
  '  if launchctl bootstrap "$domain" "$plist"; then exit 0; fi',
  "  attempt=$((attempt + 1))",
  "  sleep 1",
  "done",
  "exit 1",
].join("\n");

export type ServerMoveCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export interface DetachedSpawnRequest {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export type DetachedProcessSpawner = (
  request: DetachedSpawnRequest,
) => Promise<number>;

export interface RestartServiceArgs {
  definition: ServiceDefinition;
  runCommand: ServerMoveCommandRunner;
  spawnDetached: DetachedProcessSpawner;
  uid: number;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export const defaultServerMoveCommandRunner: ServerMoveCommandRunner = async (
  command,
  args,
) => {
  await execFileAsync(command, [...args], {
    env: process.env,
    timeout: SERVICE_COMMAND_TIMEOUT_MS,
  });
};

export const defaultDetachedProcessSpawner: DetachedProcessSpawner = (
  request,
) => {
  mkdirSync(dirname(request.logPath), { recursive: true });
  const fd = openSync(request.logPath, "a", 0o600);
  try {
    const child = spawn(request.command, request.args, {
      detached: true,
      env: request.env,
      stdio: ["ignore", fd, fd],
    });
    return new Promise<number>((resolveSpawn, rejectSpawn) => {
      child.once("error", rejectSpawn);
      child.once("spawn", () => {
        child.unref();
        if (child.pid === undefined) {
          rejectSpawn(new Error(`${request.command} did not report a pid`));
          return;
        }
        resolveSpawn(child.pid);
      });
    });
  } finally {
    closeSync(fd);
  }
};

function systemdScopeFlag(definition: ServiceDefinition): string {
  return definition.manager === "systemd-system" ? "--system" : "--user";
}

export async function restartService(args: RestartServiceArgs): Promise<void> {
  if (args.definition.manager === "launchd") {
    await args.spawnDetached({
      command: "/bin/sh",
      args: [
        "-c",
        LAUNCHD_RESTART_SCRIPT,
        "bb-server-move-restart",
        `gui/${args.uid}`,
        args.definition.path,
      ],
      env: args.env,
      logPath: args.logPath,
    });
    return;
  }
  const scope = systemdScopeFlag(args.definition);
  await args.runCommand("systemctl", [scope, "daemon-reload"]);
  await args.runCommand("systemctl", [
    scope,
    "restart",
    "--no-block",
    args.definition.unitName,
  ]);
}
