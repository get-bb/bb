/// <reference path="./cross-spawn.d.ts" />
import type { ChildProcess, StdioOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import crossSpawn from "cross-spawn";
import parse from "cross-spawn/lib/parse.js";

interface PortableSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
}

export type PortableChildProcess = ChildProcess;

interface PortablePipedSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface PortablePipedChildProcess extends PortableChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

interface PortableOutputChildProcess extends PortableChildProcess {
  stdin: null;
  stdout: Readable;
  stderr: Readable;
}

export function spawnPortableProcess(
  request: PortableSpawnRequest,
): PortableChildProcess {
  return crossSpawn(request.command, request.args, {
    cwd: request.cwd,
    detached: request.detached,
    env: request.env,
    stdio: request.stdio,
    windowsHide: true,
  });
}

export function preparePortablePtyCommand(request: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): { command: string; args: string[] | string } {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/iu.test(request.command)) {
    return { command: request.command, args: request.args };
  }
  const parsed = parse(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
  });
  return {
    command: parsed.command,
    args: parsed.options.windowsVerbatimArguments
      ? parsed.args.join(" ")
      : parsed.args,
  };
}

function assertPortablePipedProcess(
  child: PortableChildProcess,
): asserts child is PortablePipedChildProcess {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Portable child process did not attach piped stdio");
  }
}

function assertPortableOutputProcess(
  child: PortableChildProcess,
): asserts child is PortableOutputChildProcess {
  if (child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Portable child process did not attach output-only stdio");
  }
}

export function spawnPortablePipedProcess(
  request: PortablePipedSpawnRequest,
): PortablePipedChildProcess {
  const child = spawnPortableProcess({
    ...request,
    stdio: ["pipe", "pipe", "pipe"],
  });
  assertPortablePipedProcess(child);
  return child;
}

export function spawnPortableOutputProcess(
  request: PortablePipedSpawnRequest,
): PortableOutputChildProcess {
  const child = spawnPortableProcess({
    ...request,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assertPortableOutputProcess(child);
  return child;
}
