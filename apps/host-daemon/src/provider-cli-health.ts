import { isAbsolute, join, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { spawnPortableOutputProcess } from "@bb/process-utils";
import semver from "semver";
import { z } from "zod";
import {
  providerCliInstallEventSchema,
  type ProviderCliInstallAction,
  type ProviderCliInstallActionKind,
  type ProviderCliInstallEvent,
  type ProviderCliInstallSource,
  type ProviderCliKey,
  type ProviderCliStatus,
  type ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";

const COMMAND_CHECK_TIMEOUT_MS = 5_000;
const NPM_VIEW_TIMEOUT_MS = 15_000;
const NPM_INSTALL_STATE_TIMEOUT_MS = 5_000;

const npmGlobalListDependencySchema = z
  .object({
    version: z.string().min(1),
  })
  .passthrough();

const npmGlobalListResponseSchema = z
  .object({
    dependencies: z
      .record(z.string(), npmGlobalListDependencySchema)
      .default({}),
  })
  .passthrough();

export interface ProviderCliDefinition {
  key: ProviderCliKey;
  displayName: string;
  executableName: string;
  npmPackageName: string;
  installCommand: ProviderCliInstallCommandDefinition;
  updateCommand: ProviderCliActionCommand;
}

export interface ProviderCliCommandResult {
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
}

export interface RunProviderCliCommandArgs {
  command: string;
  args: readonly string[];
  timeoutMs: number;
}

export interface ProviderCliCommandRunner {
  run(args: RunProviderCliCommandArgs): Promise<ProviderCliCommandResult>;
}

export interface InspectProviderCliArgs {
  definition: ProviderCliDefinition;
  runner: ProviderCliCommandRunner;
  nodePlatform: NodeJS.Platform;
}

export interface GetProviderCliStatusArgs {
  runner?: ProviderCliCommandRunner;
  nodePlatform?: NodeJS.Platform;
}

export interface SpawnProviderCliInstallProcessArgs {
  command: string;
  args: string[];
}

export type ProviderCliInstallProcessErrorListener = (error: Error) => void;
export type ProviderCliInstallProcessCloseListener = (
  exitCode: number | null,
  signal: NodeJS.Signals | null,
) => void;

export interface ProviderCliInstallProcess {
  stdout: Readable;
  stderr: Readable;
  kill(signal: NodeJS.Signals): boolean;
  onError(listener: ProviderCliInstallProcessErrorListener): void;
  onClose(listener: ProviderCliInstallProcessCloseListener): void;
}

export interface ProviderCliInstallProcessSpawner {
  spawn(args: SpawnProviderCliInstallProcessArgs): ProviderCliInstallProcess;
}

export interface StreamProviderCliInstallArgs {
  provider: ProviderCliKey;
  actionKind: ProviderCliInstallActionKind;
  nodePlatform?: NodeJS.Platform;
  installProcessSpawner?: ProviderCliInstallProcessSpawner;
}

interface NeedsProviderCliUpdateArgs {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}

interface ResolveProviderCliInstallSourceArgs {
  installed: boolean;
  executablePath: string | null;
  npmGlobalPrefix: string | null;
  nodePlatform: NodeJS.Platform;
}

interface BuildInstallActionArgs {
  definition: ProviderCliDefinition;
  installed: boolean;
  needsUpdate: boolean;
  nodePlatform: NodeJS.Platform;
}

interface CreateCommandResultArgs {
  command: string;
  commandArgs: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
}

interface ProviderCliActionCommand {
  commandKind: "exec" | "shell";
  displayCommand: string;
  command: string;
  args: readonly string[];
}

type ProviderCliInstallCommandDefinition =
  | Readonly<{
      kind: "npmGlobal";
    }>
  | Readonly<{
      kind: "shell";
      command: string;
    }>;

interface ResolveProviderCliActionCommandArgs {
  definition: ProviderCliDefinition;
  actionKind: ProviderCliInstallActionKind;
  nodePlatform: NodeJS.Platform;
}

interface ProviderCliInstallSlot {
  provider: ProviderCliKey;
  released: boolean;
}

interface ProviderCliInstallStreamState {
  closed: boolean;
  childProcess: ProviderCliInstallProcess | null;
  installSlot: ProviderCliInstallSlot;
}

interface WriteInstallEventArgs {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  state: ProviderCliInstallStreamState;
  event: ProviderCliInstallEvent;
}

interface CloseInstallStreamArgs {
  controller: ReadableStreamDefaultController<Uint8Array>;
  state: ProviderCliInstallStreamState;
}

let activeProviderCliInstallProvider: ProviderCliKey | null = null;

export class ProviderCliInstallInProgressError extends Error {
  readonly provider: ProviderCliKey;

  constructor(provider: ProviderCliKey) {
    super(`Provider CLI install already running for ${provider}`);
    this.name = "ProviderCliInstallInProgressError";
    this.provider = provider;
  }
}

function getProviderCliDefinition(
  provider: ProviderCliKey,
): ProviderCliDefinition {
  switch (provider) {
    case "codex":
      return {
        key: "codex",
        displayName: "Codex",
        executableName: "codex",
        npmPackageName: "@openai/codex",
        installCommand: {
          kind: "npmGlobal",
        },
        updateCommand: {
          commandKind: "exec",
          displayCommand: "codex update",
          command: "codex",
          args: ["update"],
        },
      };
    case "claudeCode":
      return {
        key: "claudeCode",
        displayName: "Claude Code",
        executableName: "claude",
        npmPackageName: "@anthropic-ai/claude-code",
        installCommand: {
          kind: "shell",
          command: "curl -fsSL https://claude.ai/install.sh | bash",
        },
        updateCommand: {
          commandKind: "exec",
          displayCommand: "claude update",
          command: "claude",
          args: ["update"],
        },
      };
  }
}

function npmExecutableName(nodePlatform: NodeJS.Platform): string {
  return nodePlatform === "win32" ? "npm.cmd" : "npm";
}

function formatCommand(command: string, args: readonly string[]): string {
  const parts = [command, ...args];
  return parts
    .map((part) =>
      /^[A-Za-z0-9_./:@+-]+$/u.test(part)
        ? part
        : `'${part.replace(/'/gu, "'\\''")}'`,
    )
    .join(" ");
}

function isSuccessfulCommand(result: ProviderCliCommandResult): boolean {
  return result.errorMessage === null && result.exitCode === 0;
}

function firstOutputLine(text: string): string | null {
  const line = text
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return line ?? null;
}

function extractVersion(text: string): string | null {
  const match =
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/u.exec(
      text,
    );
  const candidate = match?.[1];
  if (!candidate) {
    return null;
  }
  return semver.valid(candidate);
}

function parseNpmGlobalPackageVersion(
  text: string,
  npmPackageName: string,
): string | null {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return null;
  }

  try {
    const parsed = npmGlobalListResponseSchema.safeParse(
      JSON.parse(trimmedText),
    );
    if (!parsed.success) {
      return null;
    }
    return parsed.data.dependencies[npmPackageName]?.version ?? null;
  } catch {
    return null;
  }
}

function needsProviderCliUpdate(args: NeedsProviderCliUpdateArgs): boolean {
  if (!args.installed || !args.currentVersion || !args.latestVersion) {
    return false;
  }
  return semver.gt(args.latestVersion, args.currentVersion);
}

function npmInstallCommandArgs(definition: ProviderCliDefinition): string[] {
  return ["install", "-g", `${definition.npmPackageName}@latest`];
}

function npmInstallActionCommand(
  definition: ProviderCliDefinition,
  nodePlatform: NodeJS.Platform,
): ProviderCliActionCommand {
  const command = npmExecutableName(nodePlatform);
  const args = npmInstallCommandArgs(definition);
  return {
    commandKind: "exec",
    displayCommand: formatCommand(command, args),
    command,
    args,
  };
}

function shellInstallActionCommand(command: string): ProviderCliActionCommand {
  return {
    commandKind: "shell",
    displayCommand: command,
    command: "sh",
    args: ["-c", command],
  };
}

function installActionCommand(
  definition: ProviderCliDefinition,
  nodePlatform: NodeJS.Platform,
): ProviderCliActionCommand {
  switch (definition.installCommand.kind) {
    case "npmGlobal":
      return npmInstallActionCommand(definition, nodePlatform);
    case "shell":
      return shellInstallActionCommand(definition.installCommand.command);
  }
}

function npmGlobalBinDirectory(
  npmGlobalPrefix: string,
  nodePlatform: NodeJS.Platform,
): string {
  return nodePlatform === "win32"
    ? npmGlobalPrefix
    : join(npmGlobalPrefix, "bin");
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function resolveProviderCliInstallSource({
  installed,
  executablePath,
  npmGlobalPrefix,
  nodePlatform,
}: ResolveProviderCliInstallSourceArgs): ProviderCliInstallSource {
  if (!installed) {
    return "notInstalled";
  }
  if (!executablePath || !npmGlobalPrefix) {
    return "external";
  }

  const npmBinDirectory = npmGlobalBinDirectory(npmGlobalPrefix, nodePlatform);
  return isPathInsideDirectory(executablePath, npmBinDirectory)
    ? "npmGlobal"
    : "external";
}

function buildInstallAction({
  definition,
  installed,
  needsUpdate,
  nodePlatform,
}: BuildInstallActionArgs): ProviderCliInstallAction | null {
  if (!installed) {
    const command = installActionCommand(definition, nodePlatform);
    return {
      kind: "install",
      label: "Install",
      commandKind: command.commandKind,
      command: command.displayCommand,
    };
  }
  if (needsUpdate) {
    const command = definition.updateCommand;
    return {
      kind: "update",
      label: "Update",
      commandKind: command.commandKind,
      command: command.displayCommand,
    };
  }
  return null;
}

function resolveProviderCliActionCommand({
  definition,
  actionKind,
  nodePlatform,
}: ResolveProviderCliActionCommandArgs): ProviderCliActionCommand {
  switch (actionKind) {
    case "install":
      return installActionCommand(definition, nodePlatform);
    case "update":
      return definition.updateCommand;
  }
}

function createCommandResult(
  args: CreateCommandResultArgs,
): ProviderCliCommandResult {
  return {
    command: args.command,
    args: args.commandArgs,
    stdout: args.stdout,
    stderr: args.stderr,
    exitCode: args.exitCode,
    signal: args.signal,
    errorMessage: args.errorMessage,
  };
}

export function createSpawnProviderCliCommandRunner(): ProviderCliCommandRunner {
  return {
    run: runProviderCliCommand,
  };
}

export async function runProviderCliCommand(
  args: RunProviderCliCommandArgs,
): Promise<ProviderCliCommandResult> {
  return await new Promise<ProviderCliCommandResult>((resolve) => {
    let child;
    try {
      child = spawnPortableOutputProcess({
        command: args.command,
        args: [...args.args],
        env: process.env,
      });
    } catch (error) {
      resolve(
        createCommandResult({
          command: args.command,
          commandArgs: args.args,
          stdout: "",
          stderr: "",
          exitCode: null,
          signal: null,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    function settle(result: ProviderCliCommandResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, args.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      settle(
        createCommandResult({
          command: args.command,
          commandArgs: args.args,
          stdout,
          stderr,
          exitCode: null,
          signal: null,
          errorMessage: error.message,
        }),
      );
    });

    child.on("close", (exitCode, signal) => {
      settle(
        createCommandResult({
          command: args.command,
          commandArgs: args.args,
          stdout,
          stderr,
          exitCode,
          signal,
          errorMessage: null,
        }),
      );
    });
  });
}

export async function inspectProviderCli({
  definition,
  runner,
  nodePlatform,
}: InspectProviderCliArgs): Promise<ProviderCliStatus> {
  const npmCommand = npmExecutableName(nodePlatform);
  const [
    whichResult,
    versionResult,
    latestResult,
    npmPrefixResult,
    npmListResult,
  ] = await Promise.all([
    runner.run({
      command: "which",
      args: [definition.executableName],
      timeoutMs: COMMAND_CHECK_TIMEOUT_MS,
    }),
    runner.run({
      command: definition.executableName,
      args: ["--version"],
      timeoutMs: COMMAND_CHECK_TIMEOUT_MS,
    }),
    runner.run({
      command: npmCommand,
      args: ["view", definition.npmPackageName, "version"],
      timeoutMs: NPM_VIEW_TIMEOUT_MS,
    }),
    runner.run({
      command: npmCommand,
      args: ["prefix", "-g"],
      timeoutMs: NPM_INSTALL_STATE_TIMEOUT_MS,
    }),
    runner.run({
      command: npmCommand,
      args: ["list", "-g", definition.npmPackageName, "--depth=0", "--json"],
      timeoutMs: NPM_INSTALL_STATE_TIMEOUT_MS,
    }),
  ]);

  const executablePath = isSuccessfulCommand(whichResult)
    ? firstOutputLine(whichResult.stdout)
    : null;
  const installed =
    executablePath !== null || isSuccessfulCommand(versionResult);
  const currentVersion = isSuccessfulCommand(versionResult)
    ? extractVersion(`${versionResult.stdout}\n${versionResult.stderr}`)
    : null;
  const latestVersion = isSuccessfulCommand(latestResult)
    ? extractVersion(`${latestResult.stdout}\n${latestResult.stderr}`)
    : null;
  const npmGlobalPrefix = isSuccessfulCommand(npmPrefixResult)
    ? firstOutputLine(npmPrefixResult.stdout)
    : null;
  const npmGlobalPackageVersion = parseNpmGlobalPackageVersion(
    `${npmListResult.stdout}\n${npmListResult.stderr}`,
    definition.npmPackageName,
  );
  const installSource = resolveProviderCliInstallSource({
    installed,
    executablePath,
    npmGlobalPrefix,
    nodePlatform,
  });
  const needsUpdate = needsProviderCliUpdate({
    installed,
    currentVersion,
    latestVersion,
  });
  const installAction = buildInstallAction({
    definition,
    installed,
    needsUpdate,
    nodePlatform,
  });

  return {
    displayName: definition.displayName,
    executableName: definition.executableName,
    executablePath,
    installed,
    installSource,
    currentVersion,
    latestVersion,
    npmPackageName: definition.npmPackageName,
    npmGlobalPackageVersion,
    installAction,
    needsUpdate,
  };
}

export async function getProviderCliStatus(
  args: GetProviderCliStatusArgs = {},
): Promise<ProviderCliStatusResponse> {
  const runner = args.runner ?? createSpawnProviderCliCommandRunner();
  const nodePlatform = args.nodePlatform ?? process.platform;
  const [codex, claudeCode] = await Promise.all([
    inspectProviderCli({
      definition: getProviderCliDefinition("codex"),
      runner,
      nodePlatform,
    }),
    inspectProviderCli({
      definition: getProviderCliDefinition("claudeCode"),
      runner,
      nodePlatform,
    }),
  ]);

  return {
    codex,
    claudeCode,
  };
}

export function createPortableProviderCliInstallProcessSpawner(): ProviderCliInstallProcessSpawner {
  return {
    spawn(args) {
      const child = spawnPortableOutputProcess({
        command: args.command,
        args: args.args,
        env: process.env,
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        kill(signal) {
          return child.kill(signal);
        },
        onError(listener) {
          child.on("error", listener);
        },
        onClose(listener) {
          child.on("close", listener);
        },
      };
    },
  };
}

function reserveProviderCliInstall(
  provider: ProviderCliKey,
): ProviderCliInstallSlot {
  if (activeProviderCliInstallProvider !== null) {
    throw new ProviderCliInstallInProgressError(
      activeProviderCliInstallProvider,
    );
  }
  activeProviderCliInstallProvider = provider;
  return {
    provider,
    released: false,
  };
}

function releaseProviderCliInstall(slot: ProviderCliInstallSlot): void {
  if (slot.released) {
    return;
  }
  slot.released = true;
  if (activeProviderCliInstallProvider === slot.provider) {
    activeProviderCliInstallProvider = null;
  }
}

function writeInstallEvent({
  controller,
  encoder,
  state,
  event,
}: WriteInstallEventArgs): void {
  if (state.closed) {
    return;
  }

  try {
    const parsedEvent = providerCliInstallEventSchema.parse(event);
    controller.enqueue(encoder.encode(`${JSON.stringify(parsedEvent)}\n`));
  } catch {
    state.closed = true;
    releaseProviderCliInstall(state.installSlot);
    state.childProcess?.kill("SIGTERM");
  }
}

function closeInstallStream({
  controller,
  state,
}: CloseInstallStreamArgs): void {
  if (state.closed) {
    return;
  }
  state.closed = true;
  releaseProviderCliInstall(state.installSlot);
  controller.close();
}

export function streamProviderCliInstall({
  provider,
  actionKind,
  nodePlatform = process.platform,
  installProcessSpawner = createPortableProviderCliInstallProcessSpawner(),
}: StreamProviderCliInstallArgs): ReadableStream<Uint8Array> {
  const definition = getProviderCliDefinition(provider);
  const actionCommand = resolveProviderCliActionCommand({
    definition,
    actionKind,
    nodePlatform,
  });
  const command = actionCommand.command;
  const commandArgs = [...actionCommand.args];
  const displayCommand = actionCommand.displayCommand;
  const installSlot = reserveProviderCliInstall(provider);
  const state: ProviderCliInstallStreamState = {
    closed: false,
    childProcess: null,
    installSlot,
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      writeInstallEvent({
        controller,
        encoder,
        state,
        event: {
          type: "started",
          provider,
          command: displayCommand,
        },
      });

      try {
        state.childProcess = installProcessSpawner.spawn({
          command,
          args: commandArgs,
        });
      } catch (error) {
        writeInstallEvent({
          controller,
          encoder,
          state,
          event: {
            type: "error",
            provider,
            message: error instanceof Error ? error.message : String(error),
          },
        });
        closeInstallStream({ controller, state });
        return;
      }

      const spawned = state.childProcess;
      spawned.stdout.setEncoding("utf8");
      spawned.stdout.on("data", (text: string) => {
        writeInstallEvent({
          controller,
          encoder,
          state,
          event: {
            type: "output",
            provider,
            stream: "stdout",
            text,
          },
        });
      });

      spawned.stderr.setEncoding("utf8");
      spawned.stderr.on("data", (text: string) => {
        writeInstallEvent({
          controller,
          encoder,
          state,
          event: {
            type: "output",
            provider,
            stream: "stderr",
            text,
          },
        });
      });

      spawned.onError((error) => {
        writeInstallEvent({
          controller,
          encoder,
          state,
          event: {
            type: "error",
            provider,
            message: error.message,
          },
        });
        closeInstallStream({ controller, state });
      });

      spawned.onClose((exitCode, signal) => {
        if (state.closed) {
          return;
        }
        writeInstallEvent({
          controller,
          encoder,
          state,
          event: {
            type: "completed",
            provider,
            exitCode,
            signal,
            success: exitCode === 0,
          },
        });
        closeInstallStream({ controller, state });
      });
    },
    cancel() {
      state.closed = true;
      releaseProviderCliInstall(state.installSlot);
      state.childProcess?.kill("SIGTERM");
    },
  });
}
