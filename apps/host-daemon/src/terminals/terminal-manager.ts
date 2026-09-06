import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";
import type { TerminalSessionCloseReason } from "@bb/domain";
import type { HostDaemonDaemonWsMessage } from "@bb/host-daemon-contract";
import {
  killProcessGroup,
  sanitizeInheritedChildProcessEnv,
} from "@bb/process-utils";
import type { HostDaemonServerTerminalMessage } from "../server-connection-support.js";
import type { HostDaemonLogger } from "../logger.js";
import { RuntimeManager } from "../runtime-manager.js";
import { runtimeErrorLogFields } from "../error-utils.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const DEFAULT_SCROLLBACK_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SCROLLBACK_MAX_CHUNKS = 10_000;
const MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_OUTPUT_BATCH_DELAY_MS = 4;
const DEFAULT_TERMINAL_CLOSE_GRACE_PERIOD_MS = 2_000;
const PRIMARY_DEVICE_ATTRIBUTES_QUERY_PATTERN = /\u001b\[(?:0)?c/g;
const PRIMARY_DEVICE_ATTRIBUTES_RESPONSE = "\u001b[?1;2c";
const MAX_PRIMARY_DEVICE_ATTRIBUTES_REPLIES_PER_CHUNK = 8;
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
  dispose(): void;
  kill(signal?: NodeJS.Signals): void;
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
export type TerminalOpenMessage = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.open" }
>;

export interface ResolveDefaultTerminalShellArgs {
  env?: NodeJS.ProcessEnv;
  locateOnPath?: (fileName: string) => Promise<string | null>;
  pathIsExecutable?: (filePath: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
}

export interface TerminalSpawnArgs {
  args: string[];
  file: string;
}
type TerminalAttachMessage = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.attach" }
>;

export interface TerminalManagerOptions {
  closeGracePeriodMs?: number;
  dataDir?: string;
  logger: HostDaemonLogger;
  platform?: NodeJS.Platform;
  ptyAdapter?: TerminalPtyAdapter;
  resolveShell?: ResolveTerminalShell;
  runtimeManager: RuntimeManager;
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
  closeTimeout: ReturnType<typeof setTimeout> | null;
  cols: number;
  disposables: TerminalPtyDisposable[];
  environmentId: string | null;
  nextSeq: number;
  outputBuffers: Buffer[];
  outputBytes: number;
  outputFlushTimeout: ReturnType<typeof setTimeout> | null;
  pendingPrimaryDeviceAttributesQuery: PendingPrimaryDeviceAttributesQuery;
  pty: TerminalPtyProcess;
  rows: number;
  scrollback: ScrollbackEntry[];
  scrollbackBytes: number;
  terminalId: string;
}

type PendingPrimaryDeviceAttributesQuery =
  | ""
  | "\u001b"
  | "\u001b["
  | "\u001b[0";

interface PrimaryDeviceAttributesQueryResult {
  output: string;
  pendingQuery: PendingPrimaryDeviceAttributesQuery;
  queryCount: number;
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

export interface BuildTerminalEnvArgs {
  platform?: NodeJS.Platform;
  shellEnv: NodeJS.ProcessEnv;
  terminalId: string;
}

interface ResizeTerminalArgs {
  cols: number;
  rows: number;
  terminalId: string;
}

interface ResolvedTerminalOpenTarget {
  cwd: string;
  environmentId: string | null;
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

function disposeNodePty(pty: ReturnType<typeof spawnPty>): void {
  const destroy = "destroy" in pty ? pty.destroy : undefined;
  if (typeof destroy !== "function") {
    throw new Error("node-pty terminal does not expose resource disposal");
  }
  Reflect.apply(destroy, pty, []);
}

const nodePtyAdapter: TerminalPtyAdapter = {
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
      dispose: () => disposeNodePty(pty),
      kill: (signal) =>
        killProcessGroup({
          child: { pid: pty.pid, kill: (groupSignal) => pty.kill(groupSignal) },
          signal: signal ?? "SIGHUP",
        }),
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

function resolveNodePtySpawnHelperCandidatePaths(
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

const WINDOWS_POWERSHELL_EXE = "powershell.exe";
const WINDOWS_PWSH_EXE = "pwsh.exe";
const WINDOWS_UTF8_CODE_PAGE_COMMAND = "chcp 65001";

export async function resolveDefaultTerminalShell(
  args: ResolveDefaultTerminalShellArgs = {},
): Promise<string> {
  const platform = args.platform ?? process.platform;
  const env = args.env ?? process.env;
  const isExecutable = args.pathIsExecutable ?? pathIsExecutable;
  if (platform === "win32") {
    return resolveWindowsTerminalShell({
      env,
      locateOnPath: args.locateOnPath ?? defaultLocateWindowsExecutable,
      pathIsExecutable: isExecutable,
    });
  }

  const candidates = [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    isNonEmptyString,
  );

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return "/bin/sh";
}

interface ResolveWindowsTerminalShellArgs {
  env: NodeJS.ProcessEnv;
  locateOnPath: (fileName: string) => Promise<string | null>;
  pathIsExecutable: (filePath: string) => Promise<boolean>;
}

function readWindowsEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function normalizeWindowsDir(directory: string): string {
  const stripped = directory.replace(/\\+$/u, "");
  return stripped.length > 0 ? stripped : "C:\\Windows";
}

function defaultLocateWindowsExecutable(
  fileName: string,
): Promise<string | null> {
  return new Promise<string | null>((resolveLocate) => {
    execFile(
      "where.exe",
      [fileName],
      { timeout: 5_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolveLocate(null);
          return;
        }
        const located =
          stdout
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? null;
        resolveLocate(located);
      },
    );
  });
}

async function resolveWindowsTerminalShell(
  args: ResolveWindowsTerminalShellArgs,
): Promise<string> {
  const locatedPwsh = await args.locateOnPath(WINDOWS_PWSH_EXE);
  if (locatedPwsh !== null) {
    return locatedPwsh;
  }
  for (const variable of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const programFiles = readWindowsEnvValue(args.env, variable);
    if (programFiles === undefined || programFiles.length === 0) {
      continue;
    }
    const candidate = `${normalizeWindowsDir(programFiles)}\\PowerShell\\7\\pwsh.exe`;
    if (await args.pathIsExecutable(candidate)) {
      return candidate;
    }
  }
  const locatedPowerShell = await args.locateOnPath(WINDOWS_POWERSHELL_EXE);
  if (locatedPowerShell !== null) {
    return locatedPowerShell;
  }
  const systemRoot = normalizeWindowsDir(
    readWindowsEnvValue(args.env, "SystemRoot") ?? "C:\\Windows",
  );
  const systemPowerShell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  if (await args.pathIsExecutable(systemPowerShell)) {
    return systemPowerShell;
  }
  const comSpec = readWindowsEnvValue(args.env, "ComSpec");
  if (
    comSpec !== undefined &&
    comSpec.length > 0 &&
    (await args.pathIsExecutable(comSpec))
  ) {
    return comSpec;
  }
  const systemCmd = `${systemRoot}\\System32\\cmd.exe`;
  if (await args.pathIsExecutable(systemCmd)) {
    return systemCmd;
  }
  if (comSpec !== undefined && comSpec.length > 0) {
    return comSpec;
  }
  return WINDOWS_POWERSHELL_EXE;
}

function readPathValue(env: NodeJS.ProcessEnv): string | undefined {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toLowerCase() === "path") {
      return value;
    }
  }
  return undefined;
}

export function buildTerminalEnv(
  args: BuildTerminalEnvArgs,
): NodeJS.ProcessEnv {
  const sanitizedEnv = sanitizeInheritedChildProcessEnv({ env: process.env });
  const mergedEnv: NodeJS.ProcessEnv = {
    ...sanitizedEnv,
    ...args.shellEnv,
    BB_TERMINAL_SESSION_ID: args.terminalId,
    COLORTERM: "truecolor",
    DISABLE_AUTO_TITLE: "true",
    FORCE_HYPERLINK: "1",
    PROMPT_EOL_MARK: "",
    TERM: "xterm-256color",
  };
  if ((args.platform ?? process.platform) !== "win32") {
    return mergedEnv;
  }
  const pathValue = readPathValue(args.shellEnv) ?? readPathValue(sanitizedEnv);
  for (const key of Object.keys(mergedEnv)) {
    if (key.toLowerCase() === "path") {
      delete mergedEnv[key];
    }
  }
  if (pathValue !== undefined) {
    mergedEnv.Path = pathValue;
  }
  return mergedEnv;
}

export function isWindowsCommandShell(shell: string): boolean {
  const baseName = shell.toLowerCase().split(/[/\\]/u).pop() ?? "";
  return baseName === "cmd.exe" || baseName === "cmd";
}

function terminalTitleFromShell(shell: string, platform: NodeJS.Platform): string {
  const baseName =
    platform === "win32"
      ? (shell.split(/[/\\]/u).pop() ?? "")
      : path.basename(shell);
  return baseName || "Terminal";
}

function terminalTitleFromCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77)}...`;
}

export function terminalSpawnArgsForStart(
  message: TerminalOpenMessage,
  shell: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== "win32") {
    switch (message.start.mode) {
      case "shell":
        return [];
      case "command":
        return ["-lc", message.start.command];
    }
  }
  if (isWindowsCommandShell(shell)) {
    switch (message.start.mode) {
      case "shell":
        return ["/d", "/s", "/k", `${WINDOWS_UTF8_CODE_PAGE_COMMAND}>nul`];
      case "command":
        return [
          "/d",
          "/s",
          "/c",
          `${WINDOWS_UTF8_CODE_PAGE_COMMAND}>nul & ${message.start.command}`,
        ];
    }
  }
  switch (message.start.mode) {
    case "shell":
      return [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-Command",
        `${WINDOWS_UTF8_CODE_PAGE_COMMAND} >$null`,
      ];
    case "command":
      return [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `${WINDOWS_UTF8_CODE_PAGE_COMMAND} >$null; ${message.start.command}`,
      ];
  }
}

function terminalTitleForStart(
  message: TerminalOpenMessage,
  shell: string,
  platform: NodeJS.Platform,
): string {
  switch (message.start.mode) {
    case "shell":
      return terminalTitleFromShell(shell, platform);
    case "command":
      return terminalTitleFromCommand(message.start.command);
  }
}

function terminalEnvironmentIdFromOpenMessage(
  message: TerminalOpenMessage,
): string | null {
  return message.target.kind === "workspace"
    ? message.target.environmentId
    : null;
}

async function requireTerminalCwd(cwd: string | null): Promise<string> {
  const resolvedCwd = cwd ?? os.homedir();
  if (!path.isAbsolute(resolvedCwd)) {
    throw new Error("Terminal cwd must be an absolute path");
  }
  const info = await stat(resolvedCwd);
  if (!info.isDirectory()) {
    throw new Error(`Terminal cwd is not a directory: ${resolvedCwd}`);
  }
  return resolvedCwd;
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

function consumePrimaryDeviceAttributesQueries(
  pendingQuery: PendingPrimaryDeviceAttributesQuery,
  data: string,
): PrimaryDeviceAttributesQueryResult {
  const input = pendingQuery + data;
  const nextPendingQuery: PendingPrimaryDeviceAttributesQuery = input.endsWith(
    "\u001b[0",
  )
    ? "\u001b[0"
    : input.endsWith("\u001b[")
      ? "\u001b["
      : input.endsWith("\u001b")
        ? "\u001b"
        : "";
  const completeInput = input.slice(0, input.length - nextPendingQuery.length);
  let queryCount = 0;
  const output = completeInput.replace(
    PRIMARY_DEVICE_ATTRIBUTES_QUERY_PATTERN,
    () => {
      queryCount += 1;
      return "";
    },
  );
  return {
    output,
    pendingQuery: nextPendingQuery,
    queryCount,
  };
}

export class TerminalManager {
  private readonly closeGracePeriodMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly ptyAdapter: TerminalPtyAdapter;
  private readonly resolveShell: ResolveTerminalShell;
  private readonly terminalOperations = new Map<string, Promise<void>>();
  private readonly openingTerminalEnvironmentIds = new Map<
    string,
    string | null
  >();
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly options: TerminalManagerOptions) {
    this.closeGracePeriodMs =
      options.closeGracePeriodMs ?? DEFAULT_TERMINAL_CLOSE_GRACE_PERIOD_MS;
    this.platform = options.platform ?? process.platform;
    this.ptyAdapter = options.ptyAdapter ?? nodePtyAdapter;
    this.resolveShell =
      options.resolveShell ??
      (() => resolveDefaultTerminalShell({ platform: this.platform }));
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

    const openingEnvironmentId = terminalEnvironmentIdFromOpenMessage(message);
    this.openingTerminalEnvironmentIds.set(
      message.terminalId,
      openingEnvironmentId,
    );
    let spawnedPty: TerminalPtyProcess | null = null;
    try {
      const target = await this.resolveTerminalOpenTarget(message);
      const shell = await this.resolveShell();
      spawnedPty = this.ptyAdapter.spawn({
        args: terminalSpawnArgsForStart(message, shell, this.platform),
        cols: message.cols,
        cwd: target.cwd,
        env: buildTerminalEnv({
          platform: this.platform,
          shellEnv: this.options.runtimeManager.getShellEnv(),
          terminalId: message.terminalId,
        }),
        file: shell,
        logger: this.options.logger,
        rows: message.rows,
      });
      const pty = spawnedPty;
      const session: TerminalSession = {
        closeReason: null,
        closeTimeout: null,
        cols: message.cols,
        disposables: [],
        environmentId: target.environmentId,
        nextSeq: 0,
        outputBuffers: [],
        outputBytes: 0,
        outputFlushTimeout: null,
        pendingPrimaryDeviceAttributesQuery: "",
        pty,
        rows: message.rows,
        scrollback: [],
        scrollbackBytes: 0,
        terminalId: message.terminalId,
      };
      this.sessions.set(message.terminalId, session);
      if (target.environmentId !== null) {
        this.options.runtimeManager.markTerminalActive(
          target.environmentId,
          message.terminalId,
        );
      }
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
        title: terminalTitleForStart(message, shell, this.platform),
        initialCwd: target.cwd,
        cols: message.cols,
        rows: message.rows,
      });
    } catch (error) {
      this.cleanupFailedTerminalOpen({
        pty: spawnedPty,
        terminalId: message.terminalId,
      });
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
        openingEnvironmentId
      ) {
        this.openingTerminalEnvironmentIds.delete(message.terminalId);
      }
    }
  }

  private cleanupFailedTerminalOpen(args: {
    pty: TerminalPtyProcess | null;
    terminalId: string;
  }): void {
    const session = this.sessions.get(args.terminalId);
    if (session !== undefined) {
      this.sessions.delete(args.terminalId);
      if (session.outputFlushTimeout !== null) {
        clearTimeout(session.outputFlushTimeout);
        session.outputFlushTimeout = null;
      }
      if (session.closeTimeout !== null) {
        clearTimeout(session.closeTimeout);
        session.closeTimeout = null;
      }
      if (session.environmentId !== null) {
        try {
          this.options.runtimeManager.markTerminalInactive(
            session.environmentId,
            session.terminalId,
          );
        } catch (error) {
          this.options.logger.warn(
            {
              terminalId: session.terminalId,
              ...runtimeErrorLogFields(error),
            },
            "Failed to release environment terminal after failed open",
          );
        }
      }
      for (const disposable of session.disposables) {
        try {
          disposable.dispose();
        } catch (error) {
          this.options.logger.warn(
            {
              terminalId: session.terminalId,
              ...runtimeErrorLogFields(error),
            },
            "Failed to dispose terminal listener after failed open",
          );
        }
      }
    }
    const pty = args.pty ?? session?.pty ?? null;
    if (pty === null) {
      return;
    }
    try {
      pty.kill();
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: args.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to kill terminal PTY after failed open",
      );
    }
    try {
      pty.dispose();
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: args.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to dispose terminal PTY after failed open",
      );
    }
  }

  private async resolveTerminalOpenTarget(
    message: TerminalOpenMessage,
  ): Promise<ResolvedTerminalOpenTarget> {
    switch (message.target.kind) {
      case "workspace": {
        const entry = await requireResolvedWorkspaceForCommand({
          dataDir: this.options.dataDir,
          environmentId: message.target.environmentId,
          runtimeManager: this.options.runtimeManager,
          workspaceContext: message.target.workspaceContext,
        });
        return {
          cwd: entry.path,
          environmentId: message.target.environmentId,
        };
      }
      case "host_path":
        return {
          cwd: await requireTerminalCwd(message.target.cwd),
          environmentId: null,
        };
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

    this.flushTerminalOutput(session);
    const replayEntries = session.scrollback.filter(
      (entry) => entry.chunk.seq >= message.sinceSeq,
    );
    let replayBytes = replayEntries.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    );
    while (replayEntries.length > 1 && replayBytes > message.tailBytes) {
      const removed = replayEntries.shift();
      if (removed) {
        replayBytes -= removed.byteLength;
      }
    }
    const chunks = replayEntries.map((entry) => entry.chunk);
    this.options.sendMessage({
      type: "terminal.replay",
      requestId: message.requestId,
      terminalId: message.terminalId,
      chunks,
      replayStartSeq: chunks[0]?.seq ?? session.nextSeq,
      nextSeq: session.nextSeq,
    });
  }

  private writeTerminalInput(terminalId: string, dataBase64: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) {
      return;
    }
    session.pty.write(Buffer.from(dataBase64, "base64"));
  }

  private resizeTerminal(args: ResizeTerminalArgs): void {
    const session = this.sessions.get(args.terminalId);
    if (!session) {
      return;
    }
    if (session.cols === args.cols && session.rows === args.rows) {
      return;
    }
    session.cols = args.cols;
    session.rows = args.rows;
    session.pty.resize(args.cols, args.rows);
  }

  private closeTerminal(args: CloseTerminalArgs): void {
    const session = this.sessions.get(args.terminalId);
    if (!session) {
      this.options.sendMessage({
        type: "terminal.exited",
        terminalId: args.terminalId,
        exitCode: null,
        closeReason: args.reason,
      });
      return;
    }
    if (session.closeReason !== null) {
      return;
    }
    session.closeReason = args.reason;
    session.closeTimeout = setTimeout(() => {
      session.closeTimeout = null;
      void this.runTerminalOperation({
        operation: () => this.forceCloseTerminal(session),
        terminalId: session.terminalId,
      });
    }, this.closeGracePeriodMs);
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

  private forceCloseTerminal(session: TerminalSession): void {
    if (this.sessions.get(session.terminalId) !== session) {
      return;
    }
    this.options.logger.warn(
      { terminalId: session.terminalId },
      "Terminal did not exit after close; forcing cleanup",
    );
    try {
      session.pty.kill("SIGKILL");
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: session.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to force kill terminal",
      );
    }
    this.finishTerminalSession({
      closeReason: session.closeReason ?? "user",
      exitCode: null,
      session,
    });
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

    const result = consumePrimaryDeviceAttributesQueries(
      session.pendingPrimaryDeviceAttributesQuery,
      data,
    );
    session.pendingPrimaryDeviceAttributesQuery = result.pendingQuery;
    if (result.queryCount > 0) {
      const replyCount = Math.min(
        result.queryCount,
        MAX_PRIMARY_DEVICE_ATTRIBUTES_REPLIES_PER_CHUNK,
      );
      session.pty.write(PRIMARY_DEVICE_ATTRIBUTES_RESPONSE.repeat(replyCount));
    }
    this.bufferTerminalOutput(session, result.output);
  }

  private bufferTerminalOutput(session: TerminalSession, data: string): void {
    const buffer = Buffer.from(data, "utf8");
    if (buffer.byteLength === 0) {
      return;
    }

    session.outputBuffers.push(buffer);
    session.outputBytes += buffer.byteLength;
    if (session.outputBytes >= MAX_OUTPUT_CHUNK_BYTES) {
      this.flushTerminalOutput(session);
      return;
    }
    if (session.outputFlushTimeout !== null) {
      return;
    }
    session.outputFlushTimeout = setTimeout(() => {
      session.outputFlushTimeout = null;
      this.flushTerminalOutput(session);
    }, DEFAULT_OUTPUT_BATCH_DELAY_MS);
  }

  private flushTerminalOutput(session: TerminalSession): void {
    if (session.outputFlushTimeout !== null) {
      clearTimeout(session.outputFlushTimeout);
      session.outputFlushTimeout = null;
    }
    if (
      this.sessions.get(session.terminalId) !== session ||
      session.outputBytes === 0
    ) {
      session.outputBuffers = [];
      session.outputBytes = 0;
      return;
    }

    const buffer = Buffer.concat(session.outputBuffers, session.outputBytes);
    session.outputBuffers = [];
    session.outputBytes = 0;
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
      session.scrollbackBytes > DEFAULT_SCROLLBACK_MAX_BYTES ||
      session.scrollback.length > DEFAULT_SCROLLBACK_MAX_CHUNKS
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
    if (args.session.pendingPrimaryDeviceAttributesQuery.length > 0) {
      this.bufferTerminalOutput(
        args.session,
        args.session.pendingPrimaryDeviceAttributesQuery,
      );
      args.session.pendingPrimaryDeviceAttributesQuery = "";
    }
    this.flushTerminalOutput(args.session);
    if (args.session.closeTimeout !== null) {
      clearTimeout(args.session.closeTimeout);
      args.session.closeTimeout = null;
    }
    this.sessions.delete(args.session.terminalId);
    if (args.session.environmentId !== null) {
      this.options.runtimeManager.markTerminalInactive(
        args.session.environmentId,
        args.session.terminalId,
      );
    }
    for (const disposable of args.session.disposables) {
      disposable.dispose();
    }
    try {
      args.session.pty.dispose();
    } catch (error) {
      this.options.logger.warn(
        {
          terminalId: args.session.terminalId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to dispose terminal PTY",
      );
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
