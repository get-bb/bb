import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  execPortableFile,
  terminateWindowsProcessTrees,
  type ProcessStopResult,
} from "@bb/process-utils";

export interface GitBashRuntime {
  bashPath: string;
  env: NodeJS.ProcessEnv;
}

export interface FindGitBashProcessGroupArgs extends GitBashRuntime {
  child: ChildProcess;
}

export interface StopGitBashProcessGroupArgs extends GitBashRuntime {
  child: ChildProcess;
  processGroup: Promise<number | null>;
}

const FIND_PROCESS_GROUP_SCRIPT =
  'for d in /proc/[0-9]*; do { read -r w <"$d/winpid"; } 2>/dev/null || continue; [ "$w" = "$1" ] || continue; { read -r g <"$d/pgid"; } 2>/dev/null || exit 1; echo "$g"; exit 0; done; exit 1';
const LIST_PROCESS_GROUP_SCRIPT =
  'for d in /proc/[0-9]*; do { read -r g <"$d/pgid"; } 2>/dev/null || continue; [ "$g" = "$1" ] || continue; { read -r w <"$d/winpid"; } 2>/dev/null && echo "$w"; done; exit 0';
const HELPER_TIMEOUT_MS = 5_000;
const FIND_ATTEMPTS = 10;
const FIND_RETRY_DELAY_MS = 100;
const STOP_ATTEMPTS = 10;
const STOP_RETRY_DELAY_MS = 100;
const ROOT_EXIT_TIMEOUT_MS = 1_000;

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function parseProcessIds(output: string): number[] {
  return output
    .split(/\r?\n/u)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

async function runGitBashHelper(
  runtime: GitBashRuntime,
  script: string,
  argument: number,
): Promise<number[] | null> {
  try {
    const result = await execPortableFile(
      runtime.bashPath,
      ["-c", script, "bb", String(argument)],
      {
        cwd: process.cwd(),
        env: runtime.env,
        maxBuffer: 1024 * 1024,
        timeout: HELPER_TIMEOUT_MS,
      },
    );
    return parseProcessIds(result.stdout);
  } catch {
    return null;
  }
}

export async function findGitBashProcessGroup(
  args: FindGitBashProcessGroupArgs,
): Promise<number | null> {
  const { child } = args;
  if (child.pid === undefined) {
    return null;
  }
  for (let attempt = 0; attempt < FIND_ATTEMPTS; attempt += 1) {
    if (hasExited(child)) {
      return null;
    }
    const found = await runGitBashHelper(
      args,
      FIND_PROCESS_GROUP_SCRIPT,
      child.pid,
    );
    const processGroup = found?.[0];
    if (processGroup !== undefined) {
      return processGroup;
    }
    await delay(FIND_RETRY_DELAY_MS);
  }
  return null;
}

function waitForExit(child: ChildProcess): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, ROOT_EXIT_TIMEOUT_MS);
    child.once("exit", onExit);
  });
}

export async function stopGitBashProcessGroup(
  args: StopGitBashProcessGroupArgs,
): Promise<ProcessStopResult> {
  const { child } = args;
  const processGroup = await args.processGroup.catch(() => null);
  if (processGroup === null) {
    if (child.pid !== undefined && !hasExited(child)) {
      await terminateWindowsProcessTrees([child.pid]);
    }
    await waitForExit(child);
    return { treeTermination: "unverified" };
  }

  let groupGone = false;
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    const members = await runGitBashHelper(
      args,
      LIST_PROCESS_GROUP_SCRIPT,
      processGroup,
    );
    if (members === null) {
      break;
    }
    if (members.length === 0) {
      groupGone = true;
      break;
    }
    await terminateWindowsProcessTrees(members);
    await delay(STOP_RETRY_DELAY_MS);
  }
  if (child.pid !== undefined && !hasExited(child)) {
    await terminateWindowsProcessTrees([child.pid]);
  }
  const rootExited = await waitForExit(child);
  return {
    treeTermination: groupGone && rootExited ? "confirmed" : "unverified",
  };
}
