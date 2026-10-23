/// <reference path="./cross-spawn.d.ts" />
import parse from "cross-spawn/lib/parse.js";
import {
  spawn as nodeSpawn,
  fork as nodeFork,
  execFile as nodeExecFile,
  type ChildProcess,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  type ExecFileOptions,
  type ForkOptions,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";
import crossSpawn from "cross-spawn";
import { hostToolchain } from "./host-toolchain.js";

function observe(child: ChildProcess): ChildProcess {
  child.once("error", (error) => hostToolchain.invalidateFailure(error));
  child.once("exit", (code) => hostToolchain.invalidateFailure(code));
  return child;
}

export function spawnHostProcess(
  command: string,
  args?: readonly string[],
  options?: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams;
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessByStdio<Writable, Readable, Readable>;
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioNull>,
): ChildProcessByStdio<null, Readable, null>;
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioNull, StdioNull>,
): ChildProcessByStdio<Writable, null, null>;
export function spawnHostProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess;
export function spawnHostProcess(
  command: string,
  args: readonly string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  const launch = options.shell
    ? { command, args: [...args], env: hostToolchain.environment(options.env) }
    : hostToolchain.command(command, args, options);
  const spawn = options.shell ? nodeSpawn : crossSpawn;
  return observe(
    spawn(launch.command, launch.args, {
      ...options,
      env: launch.env,
      windowsHide: options.windowsHide ?? true,
    }),
  );
}

export function forkHostProcess(
  modulePath: string | URL,
  args: readonly string[] = [],
  options: ForkOptions = {},
): ChildProcess {
  const env = hostToolchain.environment(options.env);
  const execPath =
    options.execPath === undefined || options.execPath === process.execPath
      ? hostToolchain.node({ env, cwd: options.cwd })
      : options.execPath;
  return observe(nodeFork(modulePath, args, { ...options, env, execPath }));
}

export function execHostFileCallback(
  command: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
): ChildProcess {
  const launch = hostToolchain.command(command, args, options);
  const parsed =
    process.platform === "win32" &&
    hostToolchain.resolve(launch.command, {
      env: launch.env,
      cwd: options.cwd,
    }) === null
      ? { command: launch.command, args: launch.args, options }
      : parse(launch.command, launch.args, { ...options, env: launch.env });
  return observe(
    nodeExecFile(
      parsed.command,
      parsed.args,
      {
        ...options,
        ...parsed.options,
        env: launch.env,
        encoding: "utf8",
        windowsHide: options.windowsHide ?? true,
      },
      callback,
    ),
  );
}

export function execHostFile(
  command: string,
  args: readonly string[] = [],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> & { child: ChildProcess } {
  let resolve!: (output: { stdout: string; stderr: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ stdout: string; stderr: string }>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  const child = execHostFileCallback(
    command,
    args,
    options,
    (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    },
  );
  return Object.assign(promise, { child });
}

export function prepareHostPtyCommand(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
): { command: string; args: string[] | string; env: NodeJS.ProcessEnv } {
  const launch = hostToolchain.command(command, args, options);
  const parsed = parse(launch.command, launch.args, {
    cwd: options.cwd,
    env: launch.env,
  });
  return {
    command: parsed.command,
    args: parsed.options.windowsVerbatimArguments
      ? parsed.args.join(" ")
      : parsed.args,
    env: launch.env,
  };
}

export function spawnHostProcessSync(
  command: string,
  args: readonly string[],
  options: import("node:child_process").SpawnSyncOptions,
) {
  const launch = hostToolchain.command(command, args, options);
  const result = crossSpawn.sync(launch.command, launch.args, {
    ...options,
    env: launch.env,
  });
  hostToolchain.invalidateFailure(result.error ?? result.status);
  return result;
}
