import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";
import type { TerminalSessionCloseReason } from "@bb/domain";
import type { HostDaemonDaemonWsMessage } from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import type { HostDaemonServerTerminalMessage } from "../server-connection-support.js";
import type { HostDaemonLogger } from "../logger.js";
import { RuntimeManager } from "../runtime-manager.js";
import { runtimeErrorLogFields } from "../error-utils.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const DEFAULT_SCROLLBACK_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SCROLLBACK_MAX_CHUNKS = 10_000;
const MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const NODE_PTY_NATIVE_DIRS: readonly string[] = [
  path.join("build", "Release"),
  path.join("build", "Debug"),
  path.join("prebuilds", `${process.platform}-${process.arch}`),
];
const NODE_PTY_NATIVE_RELATIVE_ROOTS: readonly string[] = ["..", "."];
const NODE_PTY_SPAWN_HELPER_MISSING_MESSAGE =
  "no node-pty spawn-helper found at known paths";
const requireForNodePty = createRequire(import.meta.url);
let nodePtySpawnHelperChecked = false;

export interface TerminalPtyDisposable {
  dispose(): void;
}

export interface TerminalPtyExit {
  exitCode: number;
}

export interface TerminalPtyProcess {
  kill(signal?: string): void;
  onData(listener: (data: string) => void): TerminalPtyDisposable;
  onExit(listener: (event: TerminalPtyExit) => void): TerminalPtyDisposable;
  resize(cols: number, rows: number): void;
  write(data: Buffer | string): void;
}

export interface SpawnTerminalPtyArgs {
  args: string[];
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  file: string;
  logger: HostDaemonLogger;
  rows: number;
}

export interface TerminalPtyAdapter {
  spawn(args: SpawnTerminalPtyArgs): TerminalPtyProcess;
}

export type ResolveTerminalShell = () => Promise<string>;
type TerminalOpenMessage = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.open" }
>;
type TerminalAttachMessage = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.attach" }
>;

export interface TerminalManagerOptions {
  dataDir?: string;
  logger: HostDaemonLogger;
  platform?: NodeJS.Platform;
  ptyAdapter?: TerminalPtyAdapter;
  resolveShell?: ResolveTerminalShell;
  runtimeManager: RuntimeManager;
  scrollbackMaxBytes?: number;
  scrollbackMaxChunks?: number;
  sendMessage: (message: HostDaemonDaemonWsMessage) => boolean;
}

interface ScrollbackEntry {
  byteLength: number;
  chunk: Extract<
    HostDaemonDaemonWsMessage,
    { type: "terminal.output" }
  >["chunk"];
}

interface TerminalSession {
  closeReason: TerminalSessionCloseReason | null;
  cols: number;
  disposables: TerminalPtyDisposable[];
  environmentId: string;
  nextSeq: number;
  pty: TerminalPtyProcess;
  rows: number;
  scrollback: ScrollbackEntry[];
  scrollbackBytes: number;
  terminalId: string;
}

interface SendTerminalErrorArgs {
  code: string;
  message: string;
  requestId: string;
  terminalId: string;
}

interface CloseTerminalArgs {
  reason: TerminalSessionCloseReason;
  terminalId: string;
}

interface CloseEnvironmentTerminalsArgs {
  environmentId: string;
  reason: TerminalSessionCloseReason;
}

interface ShutdownTerminalArgs {
  reason: TerminalSessionCloseReason;
  terminalId: string;
}

interface BuildTerminalEnvArgs {
  environmentId: string;
  projectId: string;
  shellEnv: NodeJS.ProcessEnv;
  terminalId: string;
  threadId: string;
  threadStoragePath: string;
}

interface ResizeTerminalArgs {
  cols: number;
  rows: number;
  terminalId: string;
}

interface FinishTerminalSessionArgs {
  closeReason: TerminalSessionCloseReason;
  exitCode: number | null;
  session: TerminalSession;
}

type TerminalOperation = () => Promise<void> | void;

interface RunTerminalOperationArgs {
  operation: TerminalOperation;
  terminalId: string;
}

interface RunTerminalOperationAfterPreviousArgs {
  operation: TerminalOperation;
  previousOperation: Promise<void> | undefined;
}

interface TerminalOperationCompletion {
  promise: Promise<void>;
  resolve: () => void;
}

export const nodePtyAdapter: TerminalPtyAdapter = {
  spawn(args) {
    ensureNodePtySpawnHelperExecutable(args.logger);
    const pty = spawnPty(args.file, args.args, {
      cols: args.cols,
      cwd: args.cwd,
      env: args.env,
      name: "xterm-256color",
      rows: args.rows,
    });
    return {
      kill: (signal) => pty.kill(signal),
      onData: (listener) => pty.onData(listener),
      onExit: (listener) =>
        pty.onExit((event) =>
          listener({
            exitCode: event.exitCode,
          }),
        ),
      resize: (cols, rows) => pty.resize(cols, rows),
      write: (data) => pty.write(data),
    };
  },
};

interface ResolveNodePtySpawnHelperPathArgs {
  packageDirectory: string;
}

interface EnsureNodePtySpawnHelperExecutableInPackageArgs {
  logger: HostDaemonLogger;
  packageDirectory: string;
}

type NodePtySpawnHelperPathList = string[];

export function resolveNodePtySpawnHelperCandidatePaths(
  args: ResolveNodePtySpawnHelperPathArgs,
): NodePtySpawnHelperPathList {
  const helperPaths: string[] = [];
  for (const nativeDir of NODE_PTY_NATIVE_DIRS) {
    for (const relativeRoot of NODE_PTY_NATIVE_RELATIVE_ROOTS) {
      const nativeModuleDir = path.resolve(
        args.packageDirectory,
        "lib",
        relativeRoot,
        nativeDir,
      );
      helperPaths.push(path.join(nativeModuleDir, "spawn-helper"));
    }
  }

  return helperPaths;
}

export function resolveNodePtySpawnHelperPaths(
  args: ResolveNodePtySpawnHelperPathArgs,
): NodePtySpawnHelperPathList {
  return resolveNodePtySpawnHelperCandidatePaths(args).filter((helperPath) =>
    existsSync(helperPath),
  );
}

function pathIsExecutableSync(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function ensureNodePtySpawnHelpersExecutableInPackage(
  args: EnsureNodePtySpawnHelperExecutableInPackageArgs,
): void {
  const helperPaths = resolveNodePtySpawnHelperPaths({
    packageDirectory: args.packageDirectory,
  });
  if (helperPaths.length === 0) {
    args.logger.warn({
      component: "terminal-manager",
      msg: NODE_PTY_SPAWN_HELPER_MISSING_MESSAGE,
      searched: resolveNodePtySpawnHelperCandidatePaths({
        packageDirectory: args.packageDirectory,
      }),
    });
    return;
  }

  for (const helperPath of helperPaths) {
    if (!pathIsExecutableSync(helperPath)) {
      chmodSync(helperPath, 0o755);
    }
    if (!pathIsExecutableSync(helperPath)) {
      throw new Error(`node-pty spawn-helper is not executable: ${helperPath}`);
    }
  }
}

export function ensureNodePtySpawnHelperExecutable(
  logger: HostDaemonLogger,
): void {
  if (nodePtySpawnHelperChecked || process.platform !== "darwin") {
    return;
  }
  nodePtySpawnHelperChecked = true;

  const packageJsonPath = requireForNodePty.resolve("node-pty/package.json");
  ensureNodePtySpawnHelpersExecutableInPackage({
    logger,
    packageDirectory: path.dirname(packageJsonPath),
  });
}

async function pathIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

export async function resolveDefaultTerminalShell(): Promise<string> {
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ].filter(isNonEmptyString);

  for (const candidate of candidates) {
    if (await pathIsExecutable(candidate)) {
      return candidate;
    }
  }

  return "/bin/sh";
}

function buildTerminalEnv(args: BuildTerminalEnvArgs): NodeJS.ProcessEnv {
  return {
    ...sanitizeInheritedChildProcessEnv({ env: process.env }),
    ...args.shellEnv,
    BB_ENVIRONMENT_ID: args.environmentId,
    BB_PROJECT_ID: args.projectId,
    BB_TERMINAL_SESSION_ID: args.terminalId,
    BB_THREAD_ID: args.threadId,
    BB_THREAD_STORAGE: args.threadStoragePath,
    COLORTERM: "truecolor",
    DISABLE_AUTO_TITLE: "true",
    // zsh emits a highlighted "%" by default when a prompt follows output
    // without a newline. It becomes noisy when scrollback is replayed.
    PROMPT_EOL_MARK: "",
    TERM: "xterm-256color",
  };
}

function terminalTitleFromShell(shell: string): string {
  return path.basename(shell) || "Terminal";
}

function terminalTitleFromCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77)}...`;
}

function terminalSpawnArgsForStart(message: TerminalOpenMessage): string[] {
  switch (message.start.mode) {
    case "shell":
      return [];
    case "command":
      return ["-lc", message.start.command];
  }
}

function terminalTitleForStart(
  message: TerminalOpenMessage,
  shell: string,
): string {
  switch (message.start.mode) {
    case "shell":
      return terminalTitleFromShell(shell);
    case "command":
      return terminalTitleFromCommand(message.start.command);
  }
}

function createTerminalOperationCompletion(): TerminalOperationCompletion {
  let resolveCompletion: () => void = () => {
    throw new Error("Terminal operation completion resolver was not set");
  };
  const promise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  return { promise, resolve: resolveCompletion };
}

export class TerminalManager {
  private readonly platform: NodeJS.Platform;
  private readonly ptyAdapter: TerminalPtyAdapter;
  private readonly resolveShell: ResolveTerminalShell;
  private readonly scrollbackMaxBytes: number;
  private readonly scrollbackMaxChunks: number;
  private readonly terminalOperations = new Map<string, Promise<void>>();
  private readonly openingTerminalEnvironmentIds = new Map<string, string>();
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly options: TerminalManagerOptions) {
    this.platform = options.platform ?? process.platform;
    this.ptyAdapter = options.ptyAdapter ?? nodePtyAdapter;
    this.resolveShell = options.resolveShell ?? resolveDefaultTerminalShell;
    this.scrollbackMaxBytes =
      options.scrollbackMaxBytes ?? DEFAULT_SCROLLBACK_MAX_BYTES;
    this.scrollbackMaxChunks =
      options.scrollbackMaxChunks ?? DEFAULT_SCROLLBACK_MAX_CHUNKS;
  }

  async handleMessage(message: HostDaemonServerTerminalMessage): Promise<void> {
    await this.runTerminalOperation({
      operation: () => this.handleSerializedMessage(message),
      terminalId: message.terminalId,
    });
  }

  private async handleSerializedMessage(
    message: HostDaemonServerTerminalMessage,
  ): Promise<void> {
    switch (message.type) {
      case "terminal.open":
        await this.openTerminal(message);
        return;
      case "terminal.attach":
        this.attachTerminal(message);
        return;
      case "terminal.input":
        this.writeTerminalInput(message.terminalId, message.dataBase64);
        return;
      case "terminal.resize":
        this.resizeTerminal({
          cols: message.cols,
          rows: message.rows,
          terminalId: message.terminalId,
        });
        return;
      case "terminal.close":
        this.closeTerminal({
          reason: message.reason,
          terminalId: message.terminalId,
        });
        return;
    }
  }

  async closeEnvironmentTerminals(
    args: CloseEnvironmentTerminalsArgs,
  ): Promise<void> {
    const terminalIds = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.environmentId === args.environmentId) {
        terminalIds.add(session.terminalId);
      }
    }
    for (const [terminalId, openingEnvironmentId] of this
      .openingTerminalEnvironmentIds) {
      if (openingEnvironmentId === args.environmentId) {
        terminalIds.add(terminalId);
      }
    }
    await Promise.all(
      [...terminalIds].map((terminalId) =>
        this.runTerminalOperation({
          operation: () =>
            this.closeTerminal({
              reason: args.reason,
              terminalId,
            }),
          terminalId,
        }),
      ),
    );
  }

  async shutdownAll(
    reason: TerminalSessionCloseReason = "daemon-disconnect",
  ): Promise<void> {
    const terminalIds = new Set([
      ...this.sessions.keys(),
      ...this.openingTerminalEnvironmentIds.keys(),
    ]);
    await Promise.all(
      [...terminalIds].map((terminalId) =>
        this.runTerminalOperation({
          operation: () => this.shutdownTerminal({ reason, terminalId }),
          terminalId,
        }),
      ),
    );
  }

  private async openTerminal(message: TerminalOpenMessage): Promise<void> {
    if (this.sessions.has(message.terminalId)) {
      this.sendTerminalError({
        code: "terminal_exists",
        message: "Terminal session is already open",
        requestId: message.requestId,
        terminalId: message.terminalId,
      });
      return;
    }

    if (this.platform === "win32") {
      this.sendTerminalError({
        code: "unsupported_platform",
        message: "Native Windows terminals are not supported",
        requestId: message.requestId,
        terminalId: message.terminalId,
      });
      return;
    }

    this.openingTerminalEnvironmentIds.set(
      message.terminalId,
      message.environmentId,
    );
    try {
      const entry = await requireResolvedWorkspaceForCommand({
        dataDir: this.options.dataDir,
        environmentId: message.environmentId,
        runtimeManager: this.options.runtimeManager,
        workspaceContext: message.workspaceContext,
      });
      const shell = await this.resolveShell();
      const pty = this.ptyAdapter.spawn({
        args: terminalSpawnArgsForStart(message),
        cols: message.cols,
        cwd: entry.path,
        env: buildTerminalEnv({
          environmentId: message.environmentId,
          projectId: message.projectId,
          shellEnv: this.options.runtimeManager.getShellEnv(),
          terminalId: message.terminalId,
          threadId: message.threadId,
          threadStoragePath: message.threadStoragePath,
        }),
        file: shell,
        logger: this.options.logger,
        rows: message.rows,
      });
      const session: TerminalSession = {
        closeReason: null,
        cols: message.cols,
        disposables: [],
        environmentId: message.environmentId,
        nextSeq: 0,
        pty,
        rows: message.rows,
        scrollback: [],
        scrollbackBytes: 0,
        terminalId: message.terminalId,
      };
      this.sessions.set(message.terminalId, session);
      this.options.runtimeManager.markTerminalActive(
        message.environmentId,
        message.terminalId,
      );
      session.disposables.push(
        pty.onData((data) => this.handleTerminalOutput(session, data)),
        pty.onExit((event) => {
          void this.runTerminalOperation({
            operation: () =>
              this.finishTerminalSession({
                closeReason: session.closeReason ?? "process-exit",
                exitCode: event.exitCode,
                session,
              }),
            terminalId: session.terminalId,
          }).catch((error) => {
            this.options.logger.warn(
              {
                terminalId: session.terminalId,
                ...runtimeErrorLogFields(error),
              },
              "Terminal exit handler failed",
            );
          });
        }),
      );
      this.options.sendMessage({
        type: "terminal.opened",
        requestId: message.requestId,
        terminalId: message.terminalId,
        shell,
        title: terminalTitleForStart(message, shell),
        initialCwd: entry.path,
        cols: message.cols,
        rows: message.rows,
      });
    } catch (error) {
      const code =
        error instanceof ExpectedCommandDispatchError &&
        error.code === "workspace_type_mismatch"
          ? error.code
          : "terminal_open_failed";
      this.sendTerminalError({
        code,
        message: error instanceof Error ? error.message : String(error),
        requestId: message.requestId,
        terminalId: message.terminalId,
      });
    } finally {
      if (
        this.openingTerminalEnvironmentIds.get(message.terminalId) ===
        message.environmentId
      ) {
        this.openingTerminalEnvironmentIds.delete(message.terminalId);
      }
    }
  }

  private attachTerminal(message: TerminalAttachMessage): void {
    const session = this.sessions.get(message.terminalId);
    if (!session) {
      this.sendTerminalError({
        code: "terminal_not_found",
        message: "Terminal session is not open",
        requestId: message.requestId,
        terminalId: message.terminalId,
      });
      return;
    }

    this.options.sendMessage({
      type: "terminal.replay",
      requestId: message.requestId,
      terminalId: message.terminalId,
      chunks: session.scrollback
        .filter((entry) => entry.chunk.seq >= message.sinceSeq)
        .map((entry) => entry.chunk),
      nextSeq: session.nextSeq,
    });
  }

  private writeTerminalInput(terminalId: string, dataBase64: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) {
      return;
    }
    session.pty.write(Buffer.from(dataBase64, "base64").toString("utf8"));
  }

  private resizeTerminal(args: ResizeTerminalArgs): void {
    const session = this.sessions.get(args.terminalId);
    if (!session) {
      return;
    }
    session.cols = args.cols;
    session.rows = args.rows;
    session.pty.resize(args.cols, args.rows);
  }

  private closeTerminal(args: CloseTerminalArgs): void {
    const session = this.sessions.get(args.terminalId);
    if (!session) {
      return;
    }
    session.closeReason = args.reason;
    try {
      session.pty.kill();
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: args.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to kill terminal",
      );
      this.finishTerminalSession({
        closeReason: args.reason,
        exitCode: null,
        session,
      });
    }
  }

  private shutdownTerminal(args: ShutdownTerminalArgs): void {
    const session = this.sessions.get(args.terminalId);
    if (!session) {
      return;
    }
    try {
      session.pty.kill();
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: session.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to kill terminal during shutdown",
      );
    }
    this.finishTerminalSession({
      closeReason: args.reason,
      exitCode: null,
      session,
    });
  }

  private handleTerminalOutput(session: TerminalSession, data: string): void {
    if (this.sessions.get(session.terminalId) !== session) {
      return;
    }

    const buffer = Buffer.from(data, "utf8");
    if (buffer.byteLength === 0) {
      return;
    }

    for (
      let offset = 0;
      offset < buffer.byteLength;
      offset += MAX_OUTPUT_CHUNK_BYTES
    ) {
      const dataBuffer = buffer.subarray(
        offset,
        Math.min(offset + MAX_OUTPUT_CHUNK_BYTES, buffer.byteLength),
      );
      const chunk = {
        seq: session.nextSeq,
        dataBase64: dataBuffer.toString("base64"),
      };
      session.nextSeq += 1;
      const entry: ScrollbackEntry = {
        byteLength: dataBuffer.byteLength,
        chunk,
      };
      session.scrollback.push(entry);
      session.scrollbackBytes += entry.byteLength;
      this.pruneScrollback(session);
      this.options.sendMessage({
        type: "terminal.output",
        terminalId: session.terminalId,
        chunk,
      });
    }
  }

  private pruneScrollback(session: TerminalSession): void {
    while (
      session.scrollbackBytes > this.scrollbackMaxBytes ||
      session.scrollback.length > this.scrollbackMaxChunks
    ) {
      const removed = session.scrollback.shift();
      if (!removed) {
        return;
      }
      session.scrollbackBytes -= removed.byteLength;
    }
  }

  private finishTerminalSession(args: FinishTerminalSessionArgs): void {
    if (this.sessions.get(args.session.terminalId) !== args.session) {
      return;
    }
    this.sessions.delete(args.session.terminalId);
    this.options.runtimeManager.markTerminalInactive(
      args.session.environmentId,
      args.session.terminalId,
    );
    for (const disposable of args.session.disposables) {
      disposable.dispose();
    }
    this.options.sendMessage({
      type: "terminal.exited",
      terminalId: args.session.terminalId,
      exitCode: args.exitCode,
      closeReason: args.closeReason,
    });
  }

  private sendTerminalError(args: SendTerminalErrorArgs): void {
    this.options.sendMessage({
      type: "terminal.error",
      requestId: args.requestId,
      terminalId: args.terminalId,
      code: args.code,
      message: args.message,
    });
  }

  private runTerminalOperation(args: RunTerminalOperationArgs): Promise<void> {
    const previousOperation = this.terminalOperations.get(args.terminalId);
    const completion = createTerminalOperationCompletion();
    this.terminalOperations.set(args.terminalId, completion.promise);
    const operation = this.runTerminalOperationAfterPrevious({
      operation: args.operation,
      previousOperation,
    });

    void operation.then(
      () => {
        completion.resolve();
      },
      () => {
        completion.resolve();
      },
    );
    void completion.promise.then(() => {
      if (this.terminalOperations.get(args.terminalId) === completion.promise) {
        this.terminalOperations.delete(args.terminalId);
      }
    });

    return operation;
  }

  private async runTerminalOperationAfterPrevious(
    args: RunTerminalOperationAfterPreviousArgs,
  ): Promise<void> {
    if (args.previousOperation) {
      await args.previousOperation;
    }
    await args.operation();
  }
}
