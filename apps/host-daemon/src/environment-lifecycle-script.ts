import { StringDecoder } from "node:string_decoder";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
  DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
} from "@bb/domain";
import { operationEnvironment } from "./operation-environment.js";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import {
  isProcessGroupAlive,
  killProcessGroup,
  spawnPortableOutputProcess,
  supportsProcessGroups,
} from "@bb/process-utils";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { WorkspaceError } from "bb-environment-provider-host/git";
import { createTerminalOutputLineReader } from "bb-environment-provider-host/terminal-output";
import {
  createProvisionCancelledError,
  emitOutput,
  emitStep,
  throwIfProvisionAborted,
  type ProgressCallback,
} from "bb-environment-provider-host/transcript";

export interface RunSetupScriptArgs {
  workspacePath: string;
  timeoutMs: number;
  shellPath?: string;
  env?: NodeJS.ProcessEnv;
  contributedEnv?: readonly HostDaemonContributedEnvEntry[];
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

type RunTeardownScriptArgs = RunSetupScriptArgs;

interface LifecycleScriptCommand {
  command: string;
  args: string[];
  text: string;
}

interface BuildLifecycleScriptCommandArgs {
  kind: "setup" | "teardown";
  scriptName: string;
  platform: NodeJS.Platform;
  scriptPath: string;
}

interface RunLifecycleScriptArgs extends RunSetupScriptArgs {
  kind: "setup" | "teardown";
  scriptName: string;
}

export function buildLifecycleScriptCommand(
  args: BuildLifecycleScriptCommandArgs,
): LifecycleScriptCommand {
  if (args.platform === "win32") {
    throw new WorkspaceError(
      "setup_script_failed",
      `POSIX shell ${args.kind} scripts are not supported on Windows: ${args.scriptName}`,
    );
  }

  return {
    command: "env",
    args: ["bash", args.scriptPath],
    text: `env bash ${args.scriptName}`,
  };
}

async function resolveLifecycleScriptPath(
  workspacePath: string,
  scriptName: string,
): Promise<string | null> {
  const scriptPath = path.join(workspacePath, scriptName);
  try {
    await fs.access(scriptPath);
  } catch {
    return null;
  }
  return scriptPath;
}

async function runLifecycleScript(
  args: RunLifecycleScriptArgs,
): Promise<{ ran: boolean }> {
  throwIfProvisionAborted(args.signal);
  const scriptPath = await resolveLifecycleScriptPath(
    args.workspacePath,
    args.scriptName,
  );
  if (!scriptPath) {
    return { ran: false };
  }

  throwIfProvisionAborted(args.signal);
  const command = buildLifecycleScriptCommand({
    kind: args.kind,
    scriptName: args.scriptName,
    platform: process.platform,
    scriptPath,
  });
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: `${args.kind}-started`,
    text: `Running ${args.scriptName}`,
    status: "started",
    startedAt,
  });

  const { timeoutMs } = args;
  const env = operationEnvironment(
    args.contributedEnv ?? [],
    {
      ...(args.env ?? process.env),
      ...(args.shellPath !== undefined ? { PATH: args.shellPath } : {}),
    },
    true,
  );
  const child = spawnPortableOutputProcess({
    command: command.command,
    args: command.args,
    cwd: args.workspacePath,
    detached: supportsProcessGroups(),
    env,
  });

  const outputLineReader = createTerminalOutputLineReader();
  let outputIndex = 0;
  let abortRequested = false;
  let timedOut = false;

  const emitScriptOutputLines = (lines: string[]): void => {
    for (const line of lines) {
      outputIndex += 1;
      emitOutput(args.onProgress, `${args.kind}-output-${outputIndex}`, line);
    }
  };

  const readers = [child.stdout, child.stderr].map((stream) => {
    const decoder = new StringDecoder("utf8");
    const emit = (text: string) => {
      emitScriptOutputLines(outputLineReader.push(text));
    };
    stream.on("data", (chunk: Buffer) => emit(decoder.write(chunk)));
    return () => emit(decoder.end());
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    killProcessGroup({ child, signal: "SIGKILL" });
  }, timeoutMs);
  const abortLifecycleScript = () => {
    if (abortRequested) {
      return;
    }
    abortRequested = true;
    killProcessGroup({ child, signal: "SIGKILL" });
  };
  args.signal?.addEventListener("abort", abortLifecycleScript, {
    once: true,
  });
  if (args.signal?.aborted) {
    abortLifecycleScript();
  }

  try {
    const result = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });

    if (abortRequested || timedOut)
      while (isProcessGroupAlive(child)) await delay(25);

    for (const flush of readers) flush();
    emitScriptOutputLines(outputLineReader.flush());
    const durationMs = Date.now() - startedAt;
    if (abortRequested || args.signal?.aborted) {
      emitStep({
        onProgress: args.onProgress,
        key: `${args.kind}-cancelled`,
        text: `${args.scriptName} cancelled`,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw createProvisionCancelledError(args.signal?.reason);
    }

    const failScript = (detail: string): never => {
      emitStep({
        onProgress: args.onProgress,
        key: `${args.kind}-failed`,
        text: `${args.scriptName} failed`,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `${args.kind === "setup" ? "Setup" : "Teardown"} script ${detail}: ${scriptPath}`,
      );
    };

    if (timedOut) {
      failScript(`timed out after ${timeoutMs}ms`);
    }

    if (result.signal) {
      failScript(`exited via signal ${result.signal}`);
    }

    if ((result.exitCode ?? 0) !== 0) {
      failScript(`failed with exit code ${result.exitCode}`);
    }

    emitStep({
      onProgress: args.onProgress,
      key: `${args.kind}-completed`,
      text: `${args.scriptName} finished`,
      status: "completed",
      startedAt,
      metadata: { durationMs },
    });
    return { ran: true };
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abortLifecycleScript);
  }
}

export function runSetupScript(
  args: RunSetupScriptArgs,
): Promise<{ ran: boolean }> {
  return runLifecycleScript({
    ...args,
    kind: "setup",
    scriptName: DEFAULT_ENV_SETUP_SCRIPT_NAME,
  });
}

export async function runTeardownScript(
  args: RunTeardownScriptArgs,
): Promise<{ ran: boolean }> {
  const startedAt = Date.now();
  let failureReported = false;
  const onProgress: ProgressCallback = (entry) => {
    if (entry.type === "step" && entry.key === "teardown-failed") {
      failureReported = true;
    }
    args.onProgress?.(entry);
  };
  try {
    return await runLifecycleScript({
      ...args,
      onProgress,
      kind: "teardown",
      scriptName: DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
    });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    if (!failureReported) {
      emitStep({
        onProgress: args.onProgress,
        key: "teardown-failed",
        text: `${DEFAULT_ENV_TEARDOWN_SCRIPT_NAME} failed`,
        status: "failed",
        startedAt,
        metadata: { durationMs: Date.now() - startedAt },
      });
    }
    emitOutput(
      args.onProgress,
      "teardown-error",
      error instanceof Error ? error.message : String(error),
    );
    return { ran: true };
  }
}
