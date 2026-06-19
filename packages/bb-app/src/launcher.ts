#!/usr/bin/env node
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BB_APP_MANAGED_CONFIG_KEYS,
  bbAppManagedConfigSchema,
  bbAppManagedEnvFileSchema,
  formatBbAppConfigPath,
  formatBbAppEnvPath,
  type BbAppManagedConfig,
  type BbAppManagedConfigKey,
  type BbAppManagedConfigValues,
  type BbAppManagedEnvConfig,
  type BbAppManagedEnvFile,
} from "@bb/config/bb-app-managed-config";
import {
  validateInferenceModel,
  validateTranscriptionModel,
} from "@bb/config/inference-model";
import { validateLogLevel } from "@bb/config/log-level";
import { validateOptionalUrl } from "@bb/config/public-url";
import {
  BB_PROD_HOST_DAEMON_PORT,
  BB_LOOPBACK_HOST,
  BB_PROD_SERVER_PORT,
  resolveConfiguredDataDir,
  resolveDataDirDatabasePath,
  resolvePortFromEnv,
  resolveProdDataDir,
} from "@bb/config/runtime";
import { z } from "zod";

const HOST_AUTH_FILE_NAME = "auth.json";
const HOST_ID_FILE_NAME = "host-id";
const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 100;
const MANAGED_PROCESS_TERMINATION_TIMEOUT_MS = 5_000;
const MANAGED_PROCESS_KILL_TIMEOUT_MS = 1_000;
const MANAGED_PROCESS_RESTART_RETRY_DELAY_MS = 1_000;
const START_COMMAND = "start";
const HOST_DAEMON_COMMAND = "host-daemon";
const HOST_DAEMON_JOIN_COMMAND = "join";
const CONFIG_COMMAND = "config";
const ENV_COMMAND = "env";
const SET_COMMAND = "set";
const CONFIG_UNSET_COMMAND = "unset";
const CONFIG_LIST_COMMAND = "list";
const CONFIG_REFRESH_COMMAND = "refresh";

type ManagedConfigValueKey = BbAppManagedConfigKey;
type ManagedConfigKey = "BB_SERVER_URL" | "serverUrl" | ManagedConfigValueKey;

const MANAGED_CONFIG_KEYS = BB_APP_MANAGED_CONFIG_KEYS;
const MANAGED_CONFIG_KEY_VALUES = new Set<string>(MANAGED_CONFIG_KEYS);
const PORTABLE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SECRET_SHAPED_ENV_NAME_PATTERN =
  /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD)$/u;

const bbAppPackageJsonSchema = z
  .object({
    version: z.string().min(1),
  })
  .passthrough();

const hostEnrollKeyResponseSchema = z
  .object({
    enrollKey: z.string().min(1),
    hostId: z.string().min(1),
  })
  .passthrough();

const apiErrorResponseSchema = z.object({
  message: z.string(),
});

export type HostEnrollKeyResponse = z.infer<typeof hostEnrollKeyResponseSchema>;
export type ManagedConfigValues = BbAppManagedConfigValues;
export type ManagedEnvConfig = BbAppManagedEnvConfig;
export type ManagedEnvFile = BbAppManagedEnvFile;
export type ManagedConfig = BbAppManagedConfig;

export interface HostEnrollKeyRequestBody {
  hostId?: string;
}

export interface CreateHostEnrollKeyRequestBodyArgs {
  requestedHostId: string | null;
}

export interface ResolveDataDirArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export interface ResolvePortArgs {
  defaultPort: number;
  env: NodeJS.ProcessEnv;
  name: string;
}

export interface ResolveBbAppStartContextArgs {
  entrypointUrl: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export interface ResolveBbAppRuntimeContextArgs {
  entrypointUrl: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  options: LauncherCliOptions;
  serverUrlMode: "local" | "managed";
}

export interface BbAppStartContext {
  appDistDir: string;
  appVersion: string;
  configFile: string;
  daemonBundleDir: string;
  daemonEntry: string;
  daemonLockDir: string;
  daemonLockFile: string;
  daemonPort: number;
  dataDir: string;
  dbPath: string;
  envFile: string;
  logDir: string;
  packageRoot: string;
  serverEntry: string;
  serverPort: number;
  serverUrl: string;
}

export interface BbAppRuntimeState {
  config: ManagedConfig;
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
  serverEnv: NodeJS.ProcessEnv;
}

export interface IsMainModuleArgs {
  entrypointPath: string | undefined;
  moduleUrl: string;
}

export interface StartCommand {
  kind: "start";
}

export interface HostDaemonCommand {
  args: string[];
  kind: "host-daemon";
}

export interface ConfigCommand {
  args: string[];
  kind: "config";
}

export interface EnvCommand {
  args: string[];
  kind: "env";
}

export interface HelpCommand {
  kind: "help";
}

export interface InvalidCommand {
  command: string;
  kind: "invalid";
}

export interface LauncherCliOptions {
  dataDir?: string;
  enrollKey?: string;
  help: boolean;
  hostDaemonPort?: string;
  hostId?: string;
  hostType?: string;
  joinCode?: string;
  serverPort?: string;
  serverUrl?: string;
}

export interface ParsedLauncherArgs {
  options: LauncherCliOptions;
  positionals: string[];
}

interface ManagedSpawnArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  outputBuffer: OutputBuffer;
}

interface OutputBuffer {
  flush(): void;
  handler(chunk: OutputChunk): void;
}

export interface ProcessExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export type ManagedProcessName = "daemon" | "server";
type OutputChunk = Buffer | string;
type WaitForProcessExitWithTimeoutResult = "exited" | "timed-out";
type StartManagedProcess = () => Promise<ManagedProcessRun>;
export type DelayMillisecondsFn = (
  args: DelayMillisecondsArgs,
) => Promise<void>;
export type FullStackSupervisionResult = "shutdown" | "stopped";
type ResolveWaitForProcessExitWithTimeout = (
  result: WaitForProcessExitWithTimeoutResult,
) => void;
type BbAppCommand =
  | ConfigCommand
  | EnvCommand
  | HelpCommand
  | HostDaemonCommand
  | InvalidCommand
  | StartCommand;

interface WaitForNamedProcessExitArgs {
  childProcess: ChildProcess;
  processName: ManagedProcessName;
}

interface WaitForProcessExitWithTimeoutArgs {
  childProcess: ChildProcess;
  timeoutMs: number;
}

interface TerminateProcessIfRunningArgs {
  childProcess: ChildProcess;
  processName: ManagedProcessName;
  signal: NodeJS.Signals;
}

export interface NamedProcessExitResult {
  processName: ManagedProcessName;
  result: ProcessExitResult;
}

export interface ManagedProcessRun {
  exit: Promise<NamedProcessExitResult>;
  terminate(signal: NodeJS.Signals): Promise<void>;
}

interface ChildManagedProcessRun extends ManagedProcessRun {
  childProcess: ChildProcess;
}

export interface ManagedFullStackProcesses {
  daemonRun: ManagedProcessRun | null;
  serverRun: ManagedProcessRun | null;
}

interface SpawnNamedManagedProcessArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  outputBuffer: OutputBuffer;
  processName: ManagedProcessName;
}

interface StartFullStackServerProcessArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
  outputBuffer: OutputBuffer;
  processes: ManagedFullStackProcesses;
}

interface StartFullStackDaemonProcessArgs {
  autoJoinEnv: NodeJS.ProcessEnv;
  context: BbAppStartContext;
  outputBuffer: OutputBuffer;
  processes: ManagedFullStackProcesses;
}

interface RestartManagedProcessArgs {
  context: BbAppStartContext;
  delayMilliseconds: DelayMillisecondsFn;
  isShutdownRequested: () => boolean;
  processName: ManagedProcessName;
  start: StartManagedProcess;
}

export interface SuperviseFullStackProcessesArgs {
  context: BbAppStartContext;
  delayMilliseconds: DelayMillisecondsFn;
  isShutdownRequested: () => boolean;
  processes: ManagedFullStackProcesses;
  startDaemon: StartManagedProcess;
  startServer: StartManagedProcess;
}

export interface TerminateManagedFullStackProcessesArgs {
  processes: ManagedFullStackProcesses;
  signal: NodeJS.Signals;
}

export interface CompleteFullStackSupervisionArgs {
  shutdownPromise: Promise<void> | null;
  supervisionResult: FullStackSupervisionResult;
}

interface LogManagedProcessStartupFailureContextArgs {
  context: BbAppStartContext;
  processName: ManagedProcessName;
}

export interface DelayMillisecondsArgs {
  ms: number;
}

interface WaitForHealthArgs {
  childProcess: ChildProcess | null;
  timeoutMs?: number;
  url: string;
}

interface RequestHostEnrollKeyArgs {
  requestedHostId: string | null;
  serverUrl: string;
}

interface MaybeAddAutoJoinEnvArgs {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  serverUrl: string;
}

interface ArtifactPath {
  label: string;
  path: string;
}

interface CreateCliEnvArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface CreateSharedEnvArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface CreateServerEnvArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface CreateServerBaseEnvArgs {
  config: ManagedConfig;
  env: NodeJS.ProcessEnv;
  envFile: ManagedEnvFile;
}

interface CreateHostDaemonOnlyEnvArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
  serverUrl: string;
}

interface EnrollmentRequirements {
  enrollKey?: string;
  enrolled: boolean;
}

interface ResolveEnrollmentRequirementsArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface ResolveHostDaemonServerUrlArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface CreateHostDaemonJoinEnvArgs {
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
  serverUrl: string;
}

interface CreateEnvFromOptionsArgs {
  env: NodeJS.ProcessEnv;
  options: LauncherCliOptions;
}

interface ResolveManagedConfigArgs {
  dataDir: string;
}

interface WriteManagedConfigArgs {
  config: ManagedConfig;
  dataDir: string;
}

interface WriteManagedConfigFileArgs {
  config: ManagedConfig;
  dataDir: string;
}

interface WriteManagedEnvFileArgs {
  config: ManagedEnvFile;
  dataDir: string;
}

interface ResolveServerUrlArgs {
  config: ManagedConfig;
  defaultServerUrl: string;
  env: NodeJS.ProcessEnv;
  optionServerUrl?: string;
}

interface ApplyManagedConfigEnvArgs {
  config: ManagedConfig;
  env: NodeJS.ProcessEnv;
  envFile: ManagedEnvFile;
}

interface ResolveBbAppRuntimeStateArgs {
  entrypointUrl: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  options: LauncherCliOptions;
  serverUrlMode: "local" | "managed";
}

interface RunConfigCommandArgs {
  args: string[];
  dataDir: string;
  serverUrl: string;
}

interface RunEnvCommandArgs {
  args: string[];
  dataDir: string;
  serverUrl: string;
}

interface RefreshRunningServerConfigArgs {
  required: boolean;
  serverUrl: string;
}

interface RunHostDaemonOnlyArgs {
  args: string[];
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface RunBundledCliCommandArgs {
  args: string[];
  context: BbAppStartContext;
  env: NodeJS.ProcessEnv;
}

interface ResolveHostDaemonCommandResult {
  kind: "join" | "start";
}

function color(code: number, value: string): string {
  return `\x1b[${code}m${value}\x1b[0m`;
}

function bold(value: string): string {
  return color(1, value);
}

function cyan(value: string): string {
  return color(36, value);
}

function dim(value: string): string {
  return color(2, value);
}

function green(value: string): string {
  return color(32, value);
}

function red(value: string): string {
  return color(31, value);
}

function yellow(value: string): string {
  return color(33, value);
}

function log(icon: string, message: string): void {
  process.stdout.write(`  ${icon}  ${message}\n`);
}

function beginStep(message: string): void {
  process.stdout.write(`\x1b[2K  ${dim("○")}  ${message}\r`);
}

function endStep(icon: string, message: string): void {
  process.stdout.write(`\x1b[2K  ${icon}  ${message}\n`);
}

function formatReadyOutputRow(label: string, value: string): string {
  return `${dim(label.padEnd("daemon".length))} ${value}`;
}

function warnExistingDaemonLock(lockDir: string): void {
  log(yellow("!"), "Daemon lock exists - waiting or reclaiming if stale");
  log(" ", dim(`lock: ${lockDir}`));
  log(" ", dim("If startup fails, stop the other bb process or remove it."));
  process.stdout.write("\n");
}

function isManagedConfigValueKey(
  value: string,
): value is ManagedConfigValueKey {
  return MANAGED_CONFIG_KEY_VALUES.has(value);
}

function isPortableEnvName(value: string): boolean {
  return PORTABLE_ENV_NAME_PATTERN.test(value);
}

function isSecretShapedEnvName(value: string): boolean {
  return SECRET_SHAPED_ENV_NAME_PATTERN.test(value);
}

function supportedConfigKeysText(): string {
  return ["BB_SERVER_URL", ...MANAGED_CONFIG_KEYS].join(", ");
}

function createDefaultLauncherOptions(): LauncherCliOptions {
  return { help: false };
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringOption(
  value: boolean | string | string[] | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return trimToUndefined(value);
}

function readBooleanOption(
  value: boolean | string | string[] | undefined,
): boolean {
  return value === true;
}

function chooseServerUrlOption(
  serverUrl: string | undefined,
  server: string | undefined,
): string | undefined {
  if (serverUrl !== undefined && server !== undefined && serverUrl !== server) {
    throw new Error("--server-url and --server must match when both are set");
  }
  return serverUrl ?? server;
}

export function parseLauncherArgs(args: string[]): ParsedLauncherArgs {
  const parsed = parseArgs({
    allowPositionals: true,
    args,
    options: {
      "data-dir": { type: "string" },
      "enroll-key": { type: "string" },
      "host-daemon-port": { type: "string" },
      "host-id": { type: "string" },
      "host-type": { type: "string" },
      "join-code": { type: "string" },
      "server-port": { type: "string" },
      "server-url": { type: "string" },
      help: { short: "h", type: "boolean" },
      server: { type: "string" },
    },
  });
  const options: LauncherCliOptions = {
    help: readBooleanOption(parsed.values.help),
  };
  const dataDir = readStringOption(parsed.values["data-dir"]);
  const enrollKey = readStringOption(parsed.values["enroll-key"]);
  const hostDaemonPort = readStringOption(parsed.values["host-daemon-port"]);
  const hostId = readStringOption(parsed.values["host-id"]);
  const hostType = readStringOption(parsed.values["host-type"]);
  const joinCode = readStringOption(parsed.values["join-code"]);
  const serverPort = readStringOption(parsed.values["server-port"]);
  const serverUrl = chooseServerUrlOption(
    readStringOption(parsed.values["server-url"]),
    readStringOption(parsed.values.server),
  );
  if (dataDir !== undefined) {
    options.dataDir = dataDir;
  }
  if (enrollKey !== undefined) {
    options.enrollKey = enrollKey;
  }
  if (hostDaemonPort !== undefined) {
    options.hostDaemonPort = hostDaemonPort;
  }
  if (hostId !== undefined) {
    options.hostId = hostId;
  }
  if (hostType !== undefined) {
    options.hostType = hostType;
  }
  if (joinCode !== undefined) {
    options.joinCode = joinCode;
  }
  if (serverPort !== undefined) {
    options.serverPort = serverPort;
  }
  if (serverUrl !== undefined) {
    options.serverUrl = serverUrl;
  }

  return {
    options,
    positionals: parsed.positionals,
  };
}

export function resolveDataDir(args: ResolveDataDirArgs): string {
  return resolveConfiguredDataDir({
    defaultDataDir: resolveProdDataDir({ homeDir: args.homeDir }),
    env: args.env,
    homeDir: args.homeDir,
  });
}

export function resolvePort(args: ResolvePortArgs): number {
  return resolvePortFromEnv(args);
}

function createEnvFromOptions(
  args: CreateEnvFromOptionsArgs,
): NodeJS.ProcessEnv {
  const env = { ...args.env };
  if (args.options.dataDir !== undefined) {
    env.BB_DATA_DIR = args.options.dataDir;
  }
  if (args.options.hostDaemonPort !== undefined) {
    env.BB_HOST_DAEMON_PORT = args.options.hostDaemonPort;
  }
  if (args.options.serverPort !== undefined) {
    env.BB_SERVER_PORT = args.options.serverPort;
  }
  if (args.options.serverUrl !== undefined) {
    env.BB_SERVER_URL = args.options.serverUrl;
  }
  if (args.options.hostId !== undefined) {
    env.BB_HOST_ID = args.options.hostId;
  }
  if (args.options.hostType !== undefined) {
    env.BB_HOST_TYPE = args.options.hostType;
  }
  if (args.options.joinCode !== undefined) {
    env.BB_HOST_ENROLL_KEY = args.options.joinCode;
  }
  if (args.options.enrollKey !== undefined) {
    env.BB_HOST_ENROLL_KEY = args.options.enrollKey;
  }
  return env;
}

function resolveServerUrl(args: ResolveServerUrlArgs): string {
  return (
    trimToUndefined(args.optionServerUrl) ??
    args.config.serverUrl ??
    trimToUndefined(args.env.BB_SERVER_URL) ??
    args.defaultServerUrl
  );
}

function applyManagedConfigEnv(
  args: ApplyManagedConfigEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.env,
    ...args.config.config,
    ...args.envFile.env,
  };
}

function createServerBaseEnv(args: CreateServerBaseEnvArgs): NodeJS.ProcessEnv {
  return {
    ...args.env,
    ...args.config.config,
    ...args.envFile.env,
  };
}

async function readManagedConfig(
  args: ResolveManagedConfigArgs,
): Promise<ManagedConfig> {
  try {
    const rawConfig = await readFile(
      formatBbAppConfigPath(args.dataDir),
      "utf8",
    );
    return bbAppManagedConfigSchema.parse(JSON.parse(rawConfig));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid bb-app config JSON at ${formatBbAppConfigPath(args.dataDir)}`,
      );
    }
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid bb-app config at ${formatBbAppConfigPath(args.dataDir)}: ${error.message}`,
      );
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function readManagedEnvFile(
  args: ResolveManagedConfigArgs,
): Promise<ManagedEnvFile> {
  try {
    const rawConfig = await readFile(formatBbAppEnvPath(args.dataDir), "utf8");
    return bbAppManagedEnvFileSchema.parse(JSON.parse(rawConfig));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid bb-app env JSON at ${formatBbAppEnvPath(args.dataDir)}`,
      );
    }
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid bb-app env at ${formatBbAppEnvPath(args.dataDir)}: ${error.message}`,
      );
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function createManagedConfigValuePatch(
  key: ManagedConfigValueKey,
  value: string,
): ManagedConfigValues {
  const config: ManagedConfigValues = {};
  config[key] = value;
  return config;
}

function mergeManagedConfig(
  currentConfig: ManagedConfig,
  patchConfig: ManagedConfig,
): ManagedConfig {
  const nextConfig: ManagedConfig = {
    ...currentConfig,
  };

  if (patchConfig.serverUrl !== undefined) {
    nextConfig.serverUrl = patchConfig.serverUrl;
  }

  if (patchConfig.config !== undefined) {
    nextConfig.config = {
      ...currentConfig.config,
      ...patchConfig.config,
    };
  }

  if (patchConfig.customModels !== undefined) {
    nextConfig.customModels = patchConfig.customModels;
  }

  return nextConfig;
}

function pruneManagedConfig(config: ManagedConfig): ManagedConfig {
  const nextConfig: ManagedConfig = {};
  if (config.serverUrl !== undefined) {
    nextConfig.serverUrl = config.serverUrl;
  }
  if (config.config !== undefined && Object.keys(config.config).length > 0) {
    nextConfig.config = config.config;
  }
  if (config.customModels !== undefined && config.customModels.length > 0) {
    nextConfig.customModels = config.customModels;
  }
  return nextConfig;
}

function mergeManagedEnvFile(
  currentConfig: ManagedEnvFile,
  patchConfig: ManagedEnvFile,
): ManagedEnvFile {
  const nextConfig: ManagedEnvFile = {
    ...currentConfig,
  };

  if (patchConfig.env !== undefined) {
    nextConfig.env = {
      ...currentConfig.env,
      ...patchConfig.env,
    };
  }

  return nextConfig;
}

function pruneManagedEnvFile(config: ManagedEnvFile): ManagedEnvFile {
  const nextConfig: ManagedEnvFile = {};
  if (config.env !== undefined && Object.keys(config.env).length > 0) {
    nextConfig.env = config.env;
  }
  return nextConfig;
}

async function writeManagedConfigFile(
  args: WriteManagedConfigFileArgs,
): Promise<void> {
  validateManagedConfigForWrite(args.config);
  await mkdir(args.dataDir, { recursive: true });
  const nextConfig = pruneManagedConfig(args.config);
  const configPath = formatBbAppConfigPath(args.dataDir);
  const tempPath = join(
    args.dataDir,
    `.config.json.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, configPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

function validateManagedConfigForWrite(config: ManagedConfig): void {
  if (config.serverUrl !== undefined) {
    validateOptionalUrl("BB_SERVER_URL", config.serverUrl);
  }
  const configValues = config.config;
  if (configValues === undefined) {
    return;
  }
  if (configValues.BB_APP_URL !== undefined) {
    validateOptionalUrl("BB_APP_URL", configValues.BB_APP_URL);
  }
  if (configValues.BB_INFERENCE !== undefined) {
    validateInferenceModel(configValues.BB_INFERENCE);
  }
  if (configValues.BB_TRANSCRIPTION !== undefined) {
    validateTranscriptionModel(configValues.BB_TRANSCRIPTION);
  }
  if (configValues.BB_LOG_LEVEL !== undefined) {
    validateLogLevel(configValues.BB_LOG_LEVEL);
  }
}

async function writeManagedConfig(args: WriteManagedConfigArgs): Promise<void> {
  const existingConfig = await readManagedConfig({ dataDir: args.dataDir });
  await writeManagedConfigFile({
    config: mergeManagedConfig(existingConfig, args.config),
    dataDir: args.dataDir,
  });
}

async function writeManagedEnv(args: WriteManagedEnvFileArgs): Promise<void> {
  const existingConfig = await readManagedEnvFile({ dataDir: args.dataDir });
  await writeManagedEnvFile({
    config: mergeManagedEnvFile(existingConfig, args.config),
    dataDir: args.dataDir,
  });
}

async function writeManagedEnvFile(
  args: WriteManagedEnvFileArgs,
): Promise<void> {
  await mkdir(args.dataDir, { recursive: true });
  const nextConfig = pruneManagedEnvFile(args.config);
  const envPath = formatBbAppEnvPath(args.dataDir);
  const tempPath = join(
    args.dataDir,
    `.env.json.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, envPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

const BB_APP_VERSION_DEV_FALLBACK = "0.0.0-dev";

export function readBbAppPackageVersion(packageRoot: string): string {
  try {
    const packageJsonPath = join(packageRoot, "package.json");
    const rawContents = readFileSync(packageJsonPath, "utf8");
    return bbAppPackageJsonSchema.parse(JSON.parse(rawContents)).version;
  } catch {
    return BB_APP_VERSION_DEV_FALLBACK;
  }
}

export function resolveBbAppStartContext(
  args: ResolveBbAppStartContextArgs,
): BbAppStartContext {
  const entrypointDir = dirname(fileURLToPath(args.entrypointUrl));
  const packageRoot = resolve(entrypointDir, "..");
  const dataDir = resolveDataDir({ env: args.env, homeDir: args.homeDir });
  const serverPort = resolvePort({
    defaultPort: BB_PROD_SERVER_PORT,
    env: args.env,
    name: "BB_SERVER_PORT",
  });
  const daemonPort = resolvePort({
    defaultPort: BB_PROD_HOST_DAEMON_PORT,
    env: args.env,
    name: "BB_HOST_DAEMON_PORT",
  });
  const daemonBundleDir = resolve(packageRoot, "host-daemon", "dist");

  return {
    appDistDir: resolve(packageRoot, "app", "dist"),
    appVersion: readBbAppPackageVersion(packageRoot),
    configFile: formatBbAppConfigPath(dataDir),
    daemonBundleDir,
    daemonEntry: resolve(daemonBundleDir, "daemon-bundle.mjs"),
    daemonLockDir: `${join(dataDir, "daemon.lock")}.lock`,
    daemonLockFile: join(dataDir, "daemon.lock"),
    daemonPort,
    dataDir,
    dbPath: resolveDataDirDatabasePath({ dataDir }),
    envFile: formatBbAppEnvPath(dataDir),
    logDir: join(dataDir, "logs"),
    packageRoot,
    serverEntry: resolve(packageRoot, "server", "dist", "index.js"),
    serverPort,
    serverUrl:
      trimToUndefined(args.env.BB_SERVER_URL) ??
      `http://${BB_LOOPBACK_HOST}:${serverPort}`,
  };
}

export async function resolveBbAppRuntimeState(
  args: ResolveBbAppRuntimeStateArgs,
): Promise<BbAppRuntimeState> {
  const initialEnv = createEnvFromOptions({
    env: args.env,
    options: args.options,
  });
  const initialContext = resolveBbAppStartContext({
    entrypointUrl: args.entrypointUrl,
    env: initialEnv,
    homeDir: args.homeDir,
  });
  const config = await readManagedConfig({ dataDir: initialContext.dataDir });
  const envFile = await readManagedEnvFile({ dataDir: initialContext.dataDir });
  const managedEnv = applyManagedConfigEnv({
    config,
    envFile,
    env: initialEnv,
  });

  if (args.serverUrlMode === "local") {
    const localEnv = { ...managedEnv };
    const localServerEnv = createServerBaseEnv({
      config,
      envFile,
      env: initialEnv,
    });
    delete localEnv.BB_SERVER_URL;
    delete localServerEnv.BB_SERVER_URL;
    return {
      config,
      context: resolveBbAppStartContext({
        entrypointUrl: args.entrypointUrl,
        env: localEnv,
        homeDir: args.homeDir,
      }),
      env: localEnv,
      serverEnv: localServerEnv,
    };
  }

  const finalEnv = {
    ...managedEnv,
    BB_SERVER_URL: resolveServerUrl({
      config,
      defaultServerUrl: initialContext.serverUrl,
      env: managedEnv,
      optionServerUrl: args.options.serverUrl,
    }),
  };
  return {
    config,
    context: resolveBbAppStartContext({
      entrypointUrl: args.entrypointUrl,
      env: finalEnv,
      homeDir: args.homeDir,
    }),
    env: finalEnv,
    serverEnv: createServerBaseEnv({
      config,
      envFile,
      env: initialEnv,
    }),
  };
}

export async function resolveBbAppRuntimeContext(
  args: ResolveBbAppRuntimeContextArgs,
): Promise<BbAppStartContext> {
  return (await resolveBbAppRuntimeState(args)).context;
}

export function createHostEnrollKeyRequestBody(
  args: CreateHostEnrollKeyRequestBodyArgs,
): HostEnrollKeyRequestBody {
  const requestBody: HostEnrollKeyRequestBody = {};
  if (args.requestedHostId !== null) {
    requestBody.hostId = args.requestedHostId;
  }
  return requestBody;
}

export function resolveBbAppCommand(args: string[]): BbAppCommand {
  if (args.length === 0) {
    return { kind: "start" };
  }

  if (args[0] === START_COMMAND && args.length === 1) {
    return { kind: "start" };
  }

  if (args[0] === HOST_DAEMON_COMMAND) {
    return {
      args: args.slice(1),
      kind: "host-daemon",
    };
  }

  if (args[0] === CONFIG_COMMAND) {
    return {
      args: args.slice(1),
      kind: "config",
    };
  }

  if (args[0] === ENV_COMMAND) {
    return {
      args: args.slice(1),
      kind: "env",
    };
  }

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }

  return {
    command: args[0],
    kind: "invalid",
  };
}

function printConfigHelp(dataDir: string): void {
  process.stdout.write(`bb-app config

Usage:
  bb-app config
  bb-app config list
  bb-app config refresh
  bb-app config set <key> <value>
  bb-app config unset <key>

Supported keys:
  ${supportedConfigKeysText()}

Config file:
  ${formatBbAppConfigPath(dataDir)}
`);
}

function printEnvHelp(dataDir: string): void {
  process.stdout.write(`bb-app env

Usage:
  bb-app env
  bb-app env list
  bb-app env set <key> <value>
  bb-app env unset <key>

Env file:
  ${formatBbAppEnvPath(dataDir)}
`);
}

function resolveManagedConfigKey(rawKey: string): ManagedConfigKey {
  const key = rawKey.trim();
  if (key === "BB_SERVER_URL" || key === "serverUrl") {
    return key;
  }
  if (isManagedConfigValueKey(key)) {
    return key;
  }
  if (isSecretShapedEnvName(key)) {
    throw new Error(
      `bb-app config does not store secrets. Use "bb-app env set ${key} <value>" instead.`,
    );
  }
  throw new Error(
    `Unsupported bb-app config key "${rawKey}". Supported keys: ${supportedConfigKeysText()}`,
  );
}

function createManagedConfigPatch(
  key: ManagedConfigKey,
  value: string,
): ManagedConfig {
  if (key === "BB_SERVER_URL" || key === "serverUrl") {
    return { serverUrl: value };
  }
  return { config: createManagedConfigValuePatch(key, value) };
}

function unsetManagedConfigKey(
  config: ManagedConfig,
  key: ManagedConfigKey,
): ManagedConfig {
  const nextConfig: ManagedConfig = {
    ...config,
  };
  if (key === "BB_SERVER_URL" || key === "serverUrl") {
    delete nextConfig.serverUrl;
    return pruneManagedConfig(nextConfig);
  }
  const nextConfigValues: ManagedConfigValues = {
    ...config.config,
  };
  delete nextConfigValues[key];
  nextConfig.config = nextConfigValues;
  return pruneManagedConfig(nextConfig);
}

function resolveManagedEnvKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!isPortableEnvName(key)) {
    throw new Error(
      `Invalid env key "${rawKey}". Env keys must match ${PORTABLE_ENV_NAME_PATTERN.source}`,
    );
  }
  return key;
}

function createManagedEnvPatch(key: string, value: string): ManagedEnvFile {
  return {
    env: {
      [key]: value,
    },
  };
}

function unsetManagedEnvKey(
  config: ManagedEnvFile,
  key: string,
): ManagedEnvFile {
  const nextConfig: ManagedEnvFile = {
    ...config,
  };
  const nextEnv: ManagedEnvConfig = {
    ...config.env,
  };
  delete nextEnv[key];
  nextConfig.env = nextEnv;
  return pruneManagedEnvFile(nextConfig);
}

function formatManagedConfig(config: ManagedConfig): string {
  const lines: string[] = [];
  if (config.serverUrl !== undefined) {
    lines.push(`BB_SERVER_URL=${config.serverUrl}`);
  }
  for (const key of MANAGED_CONFIG_KEYS) {
    const value = config.config?.[key];
    if (value !== undefined) {
      lines.push(`${key}=${value}`);
    }
  }
  // customModels has no set/unset CLI surface (edit config.json directly),
  // but list must still surface the entries so the file's contents are never
  // invisible to the official inspection command.
  for (const [index, customModel] of (config.customModels ?? []).entries()) {
    lines.push(
      `customModels[${index}]=${customModel.providerId}:${customModel.model}`,
    );
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "No bb-app config set.\n";
}

function formatManagedEnv(config: ManagedEnvFile): string {
  const env = config.env;
  if (env === undefined) {
    return "No bb-app env set.\n";
  }
  const keys = Object.keys(env).sort();
  if (keys.length === 0) {
    return "No bb-app env set.\n";
  }
  return `${keys.map((key) => `${key}=<set>`).join("\n")}\n`;
}

async function refreshRunningServerConfig(
  args: RefreshRunningServerConfigArgs,
): Promise<boolean> {
  const reloadUrl = new URL("/api/v1/system/config/reload", args.serverUrl);
  let response: Response;
  try {
    response = await fetch(reloadUrl, { method: "POST" });
  } catch {
    if (args.required) {
      throw new Error(`Could not reach bb server at ${args.serverUrl}`);
    }
    return false;
  }

  if (response.ok) {
    return true;
  }

  let message = `bb server rejected config reload with HTTP ${response.status}`;
  try {
    const parsed = apiErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      message = parsed.data.message;
    }
  } catch {
    // Keep the generic HTTP status message.
  }
  throw new Error(message);
}

async function refreshRunningServerConfigAfterWrite(
  serverUrl: string,
): Promise<void> {
  const refreshed = await refreshRunningServerConfig({
    required: false,
    serverUrl,
  });
  if (refreshed) {
    process.stdout.write("Reloaded running bb server config.\n");
    return;
  }
  process.stdout.write(
    `No running bb server found at ${serverUrl}; config will apply on next start.\n`,
  );
}

async function runConfigCommand(args: RunConfigCommandArgs): Promise<void> {
  const commandArgs = args.args;
  if (
    commandArgs.length === 0 ||
    (commandArgs.length === 1 && commandArgs[0] === CONFIG_LIST_COMMAND)
  ) {
    process.stdout.write(
      formatManagedConfig(await readManagedConfig({ dataDir: args.dataDir })),
    );
    return;
  }
  if (
    commandArgs.length === 1 &&
    (commandArgs[0] === "help" ||
      commandArgs[0] === "--help" ||
      commandArgs[0] === "-h")
  ) {
    printConfigHelp(args.dataDir);
    return;
  }
  if (commandArgs.length === 1 && commandArgs[0] === CONFIG_REFRESH_COMMAND) {
    await refreshRunningServerConfig({
      required: true,
      serverUrl: args.serverUrl,
    });
    process.stdout.write("Reloaded running bb server config.\n");
    return;
  }
  if (commandArgs[0] === CONFIG_UNSET_COMMAND) {
    if (commandArgs.length !== 2) {
      throw new Error("Usage: bb-app config unset <key>");
    }
    const key = resolveManagedConfigKey(commandArgs[1]);
    const currentConfig = await readManagedConfig({ dataDir: args.dataDir });
    await writeManagedConfigFile({
      config: unsetManagedConfigKey(currentConfig, key),
      dataDir: args.dataDir,
    });
    process.stdout.write(
      `Unset ${key} in ${formatBbAppConfigPath(args.dataDir)}\n`,
    );
    await refreshRunningServerConfigAfterWrite(args.serverUrl);
    return;
  }
  if (commandArgs[0] !== SET_COMMAND || commandArgs.length !== 3) {
    throw new Error("Usage: bb-app config set <key> <value>");
  }

  const value = commandArgs[2].trim();
  if (value.length === 0) {
    throw new Error("Config value must not be empty. Use unset to remove it.");
  }
  const key = resolveManagedConfigKey(commandArgs[1]);
  await writeManagedConfig({
    config: createManagedConfigPatch(key, value),
    dataDir: args.dataDir,
  });
  process.stdout.write(
    `Set ${key} in ${formatBbAppConfigPath(args.dataDir)}\n`,
  );
  await refreshRunningServerConfigAfterWrite(args.serverUrl);
}

async function runEnvCommand(args: RunEnvCommandArgs): Promise<void> {
  const commandArgs = args.args;
  if (
    commandArgs.length === 0 ||
    (commandArgs.length === 1 && commandArgs[0] === CONFIG_LIST_COMMAND)
  ) {
    process.stdout.write(
      formatManagedEnv(await readManagedEnvFile({ dataDir: args.dataDir })),
    );
    return;
  }
  if (
    commandArgs.length === 1 &&
    (commandArgs[0] === "help" ||
      commandArgs[0] === "--help" ||
      commandArgs[0] === "-h")
  ) {
    printEnvHelp(args.dataDir);
    return;
  }
  if (commandArgs[0] === CONFIG_UNSET_COMMAND) {
    if (commandArgs.length !== 2) {
      throw new Error("Usage: bb-app env unset <key>");
    }
    const key = resolveManagedEnvKey(commandArgs[1]);
    const currentConfig = await readManagedEnvFile({ dataDir: args.dataDir });
    await writeManagedEnvFile({
      config: unsetManagedEnvKey(currentConfig, key),
      dataDir: args.dataDir,
    });
    process.stdout.write(
      `Unset ${key} in ${formatBbAppEnvPath(args.dataDir)}\n`,
    );
    await refreshRunningServerConfigAfterWrite(args.serverUrl);
    return;
  }
  if (commandArgs[0] !== SET_COMMAND || commandArgs.length !== 3) {
    throw new Error("Usage: bb-app env set <key> <value>");
  }

  const key = resolveManagedEnvKey(commandArgs[1]);
  const value = commandArgs[2].trim();
  if (value.length === 0) {
    throw new Error("Env value must not be empty. Use unset to remove it.");
  }
  await writeManagedEnv({
    config: createManagedEnvPatch(key, value),
    dataDir: args.dataDir,
  });
  process.stdout.write(`Set ${key} in ${formatBbAppEnvPath(args.dataDir)}\n`);
  await refreshRunningServerConfigAfterWrite(args.serverUrl);
}

function requiredArtifactPaths(context: BbAppStartContext): ArtifactPath[] {
  return [
    { label: "server entry", path: context.serverEntry },
    { label: "host daemon entry", path: context.daemonEntry },
    { label: "bundled bb CLI", path: join(context.daemonBundleDir, "bb") },
    {
      label: "Claude Code bridge",
      path: join(context.daemonBundleDir, "bb-claude-code-bridge.mjs"),
    },
    {
      label: "Pi bridge",
      path: join(context.daemonBundleDir, "bb-pi-bridge.mjs"),
    },
    {
      label: "ACP bridge",
      path: join(context.daemonBundleDir, "bb-acp-bridge.mjs"),
    },
    {
      label: "parcel watcher child",
      path: join(context.daemonBundleDir, "bb-parcel-watcher-child.mjs"),
    },
    { label: "web app", path: join(context.appDistDir, "index.html") },
  ];
}

export function assertBbAppArtifacts(context: BbAppStartContext): void {
  const missingArtifact = requiredArtifactPaths(context).find(
    (artifact) => !existsSync(artifact.path),
  );
  if (missingArtifact) {
    throw new Error(
      `Missing ${missingArtifact.label} at ${missingArtifact.path}. Rebuild bb-app before running this package.`,
    );
  }
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await access(pathToCheck);
    return true;
  } catch {
    return false;
  }
}

async function readPersistedHostId(dataDir: string): Promise<string | null> {
  try {
    const value = (
      await readFile(join(dataDir, HOST_ID_FILE_NAME), "utf8")
    ).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function requestHostEnrollKey(
  args: RequestHostEnrollKeyArgs,
): Promise<HostEnrollKeyResponse> {
  const response = await fetch(`${args.serverUrl}/internal/hosts/enroll-key`, {
    body: JSON.stringify(
      createHostEnrollKeyRequestBody({
        requestedHostId: args.requestedHostId,
      }),
    ),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (response.status !== 201) {
    const detail = await response.text();
    throw new Error(
      `Failed to request host enroll key: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }

  return hostEnrollKeyResponseSchema.parse(await response.json());
}

export async function maybeAddAutoJoinEnv(
  args: MaybeAddAutoJoinEnvArgs,
): Promise<NodeJS.ProcessEnv> {
  if (trimToUndefined(args.env.BB_HOST_ENROLL_KEY) !== undefined) {
    return args.env;
  }
  if (await pathExists(join(args.dataDir, HOST_AUTH_FILE_NAME))) {
    return args.env;
  }

  const requestedHostId =
    trimToUndefined(args.env.BB_HOST_ID) ??
    (await readPersistedHostId(args.dataDir));
  const enrollKeyResponse = await requestHostEnrollKey({
    requestedHostId,
    serverUrl: args.serverUrl,
  });

  if (
    requestedHostId !== null &&
    enrollKeyResponse.hostId !== requestedHostId
  ) {
    throw new Error(
      `Enroll key response host ID ${enrollKeyResponse.hostId} does not match persisted host ID ${requestedHostId}`,
    );
  }

  return {
    ...args.env,
    BB_HOST_ENROLL_KEY: enrollKeyResponse.enrollKey,
    BB_HOST_ID: enrollKeyResponse.hostId,
  };
}

async function waitForHealth(args: WaitForHealthArgs): Promise<void> {
  const timeoutMs = args.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (
      args.childProcess &&
      (args.childProcess.exitCode !== null ||
        args.childProcess.signalCode !== null)
    ) {
      throw new Error("Process exited before becoming healthy");
    }
    try {
      const response = await fetch(args.url);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, HEALTH_CHECK_INTERVAL_MS);
    });
  }
  throw new Error(`Timed out waiting for health at ${args.url}`);
}

function toChunkString(chunk: OutputChunk): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

function createOutputBuffer(): OutputBuffer {
  const chunks: OutputChunk[] = [];
  let passthrough = false;

  return {
    handler(chunk) {
      if (passthrough) {
        process.stdout.write(chunk);
        return;
      }
      chunks.push(chunk);
    },
    flush() {
      process.stdout.write("\n");
      for (const chunk of chunks) {
        process.stdout.write(toChunkString(chunk));
      }
      chunks.length = 0;
      passthrough = true;
    },
  };
}

function spawnManagedProcess(args: ManagedSpawnArgs): ChildProcess {
  const child = spawn(args.command, args.args, {
    cwd: process.cwd(),
    env: args.env,
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (child.stdout === null) {
    throw new Error("Expected managed process stdout to be piped");
  }

  child.stdout.on("data", args.outputBuffer.handler);
  return child;
}

function spawnNamedManagedProcess(
  args: SpawnNamedManagedProcessArgs,
): ChildManagedProcessRun {
  const childProcess = spawnManagedProcess(args);
  return {
    childProcess,
    exit: waitForNamedProcessExit({
      childProcess,
      processName: args.processName,
    }),
    async terminate(signal): Promise<void> {
      await terminateProcessIfRunning({
        childProcess,
        processName: args.processName,
        signal,
      });
    },
  };
}

function hasProcessExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

export function waitForProcessExit(
  childProcess: ChildProcess,
): Promise<ProcessExitResult> {
  if (hasProcessExited(childProcess)) {
    return Promise.resolve({
      code: childProcess.exitCode,
      signal: childProcess.signalCode,
    });
  }

  return new Promise<ProcessExitResult>((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function waitForProcessExitWithTimeout(
  args: WaitForProcessExitWithTimeoutArgs,
): Promise<WaitForProcessExitWithTimeoutResult> {
  if (hasProcessExited(args.childProcess)) {
    return Promise.resolve("exited");
  }

  return new Promise<WaitForProcessExitWithTimeoutResult>((resolvePromise) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish: ResolveWaitForProcessExitWithTimeout = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      args.childProcess.off("exit", exitHandler);
      resolvePromise(result);
    };
    const exitHandler = (): void => {
      finish("exited");
    };
    timeout = setTimeout(() => {
      finish("timed-out");
    }, args.timeoutMs);
    timeout.unref();

    args.childProcess.once("exit", exitHandler);
    if (hasProcessExited(args.childProcess)) {
      finish("exited");
    }
  });
}

async function waitForNamedProcessExit(
  args: WaitForNamedProcessExitArgs,
): Promise<NamedProcessExitResult> {
  return {
    processName: args.processName,
    result: await waitForProcessExit(args.childProcess),
  };
}

function formatProcessExitResult(result: ProcessExitResult): string {
  if (result.code !== null) {
    return `code ${result.code}`;
  }
  if (result.signal !== null) {
    return `signal ${result.signal}`;
  }
  return "no exit code or signal";
}

function formatManagedProcessName(processName: ManagedProcessName): string {
  return processName === "server" ? "Server" : "Host daemon";
}

function formatManagedProcessLabel(processName: ManagedProcessName): string {
  return processName === "server" ? "server" : "host daemon";
}

function toExitCode(result: ProcessExitResult): number {
  if (result.code !== null) {
    return result.code;
  }
  return result.signal === null ? 1 : 128;
}

function delayMilliseconds(args: DelayMillisecondsArgs): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, args.ms);
  });
}

async function terminateProcessIfRunning(
  args: TerminateProcessIfRunningArgs,
): Promise<void> {
  if (hasProcessExited(args.childProcess)) {
    return;
  }
  args.childProcess.kill(args.signal);
  const gracefulResult = await waitForProcessExitWithTimeout({
    childProcess: args.childProcess,
    timeoutMs: MANAGED_PROCESS_TERMINATION_TIMEOUT_MS,
  });
  if (gracefulResult === "exited") {
    return;
  }

  log(
    yellow("!"),
    `${args.processName} did not stop after ${MANAGED_PROCESS_TERMINATION_TIMEOUT_MS}ms - sending SIGKILL`,
  );
  if (!hasProcessExited(args.childProcess)) {
    args.childProcess.kill("SIGKILL");
  }
  await waitForProcessExitWithTimeout({
    childProcess: args.childProcess,
    timeoutMs: MANAGED_PROCESS_KILL_TIMEOUT_MS,
  });
}

function createSharedEnv(args: CreateSharedEnvArgs): NodeJS.ProcessEnv {
  return {
    ...args.env,
    BB_APP_VERSION: args.context.appVersion,
    BB_DATA_DIR: args.context.dataDir,
    BB_HOST_DAEMON_PORT: String(args.context.daemonPort),
    BB_SERVER_PORT: String(args.context.serverPort),
    NODE_ENV: "production",
  };
}

function createServerEnv(args: CreateServerEnvArgs): NodeJS.ProcessEnv {
  return {
    ...args.env,
    BB_APP_VERSION: args.context.appVersion,
    BB_DATA_DIR: args.context.dataDir,
    BB_HOST_DAEMON_PORT: String(args.context.daemonPort),
    BB_SERVER_PORT: String(args.context.serverPort),
    NODE_ENV: "production",
  };
}

function createDaemonEnv(
  context: BbAppStartContext,
  autoJoinEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...autoJoinEnv,
    BB_APP_VERSION: context.appVersion,
    BB_BRIDGE_DIR: context.daemonBundleDir,
    BB_CLI_DIR: context.daemonBundleDir,
    BB_DATA_DIR: context.dataDir,
    BB_HOST_DAEMON_PORT: String(context.daemonPort),
    BB_SERVER_URL: context.serverUrl,
    NODE_ENV: "production",
  };
}

function createCliEnv(args: CreateCliEnvArgs): NodeJS.ProcessEnv {
  const cliEnv: NodeJS.ProcessEnv = {
    ...args.env,
    BB_APP_VERSION: args.context.appVersion,
    BB_HOST_DAEMON_PORT: String(args.context.daemonPort),
    NODE_ENV: "production",
  };

  if (trimToUndefined(cliEnv.BB_SERVER_URL) === undefined) {
    cliEnv.BB_SERVER_URL = args.context.serverUrl;
  }

  return cliEnv;
}

function resolveHostDaemonServerUrl(
  args: ResolveHostDaemonServerUrlArgs,
): string {
  return trimToUndefined(args.env.BB_SERVER_URL) ?? args.context.serverUrl;
}

function createHostDaemonOnlyEnv(
  args: CreateHostDaemonOnlyEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.env,
    BB_APP_VERSION: args.context.appVersion,
    BB_BRIDGE_DIR: args.context.daemonBundleDir,
    BB_CLI_DIR: args.context.daemonBundleDir,
    BB_DATA_DIR: args.context.dataDir,
    BB_HOST_DAEMON_PORT: String(args.context.daemonPort),
    BB_SERVER_URL: args.serverUrl,
    NODE_ENV: "production",
  };
}

function resolveEnrollmentRequirements(
  args: ResolveEnrollmentRequirementsArgs,
): EnrollmentRequirements {
  const enrollKey = trimToUndefined(args.env.BB_HOST_ENROLL_KEY);
  return {
    enrolled: existsSync(join(args.context.dataDir, HOST_AUTH_FILE_NAME)),
    ...(enrollKey !== undefined ? { enrollKey } : {}),
  };
}

function resolveHostDaemonCommand(
  args: string[],
): ResolveHostDaemonCommandResult {
  if (args.length === 0) {
    return { kind: "start" };
  }
  if (args.length === 1 && args[0] === HOST_DAEMON_JOIN_COMMAND) {
    return { kind: "join" };
  }
  throw new Error(
    `bb-app host-daemon accepts no subcommand except ${HOST_DAEMON_JOIN_COMMAND}`,
  );
}

async function createHostDaemonJoinEnv(
  args: CreateHostDaemonJoinEnvArgs,
): Promise<NodeJS.ProcessEnv> {
  const requestedHostId =
    trimToUndefined(args.env.BB_HOST_ID) ??
    (await readPersistedHostId(args.context.dataDir));
  const enrollKeyResponse = await requestHostEnrollKey({
    requestedHostId,
    serverUrl: args.serverUrl,
  });

  if (
    requestedHostId !== null &&
    enrollKeyResponse.hostId !== requestedHostId
  ) {
    throw new Error(
      `Enroll key response host ID ${enrollKeyResponse.hostId} does not match persisted host ID ${requestedHostId}`,
    );
  }

  await writeManagedConfig({
    config: { serverUrl: args.serverUrl },
    dataDir: args.context.dataDir,
  });

  return {
    ...args.env,
    BB_HOST_ENROLL_KEY: enrollKeyResponse.enrollKey,
    BB_HOST_ID: enrollKeyResponse.hostId,
  };
}

async function runBundledCliCommand(
  args: RunBundledCliCommandArgs,
): Promise<number> {
  const childProcess = spawn(
    join(args.context.daemonBundleDir, "bb"),
    args.args,
    {
      cwd: process.cwd(),
      env: createCliEnv({ context: args.context, env: args.env }),
      stdio: "inherit",
    },
  );

  return toExitCode(await waitForProcessExit(childProcess));
}

export async function runBbCli(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const runtime = await resolveBbAppRuntimeState({
    entrypointUrl: import.meta.url,
    env: process.env,
    homeDir: homedir(),
    options: createDefaultLauncherOptions(),
    serverUrlMode: "managed",
  });
  assertBbAppArtifacts(runtime.context);
  process.exitCode = await runBundledCliCommand({
    args: cliArgs,
    context: runtime.context,
    env: runtime.env,
  });
}

export async function runBbServer(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const parsedArgs = parseLauncherArgs(cliArgs);
  if (parsedArgs.options.help) {
    process.stdout.write(`bb-server

Usage:
  bb-server [--data-dir <path>] [--server-port <port>]
`);
    return;
  }
  if (parsedArgs.positionals.length > 0) {
    throw new Error("bb-server does not accept arguments.");
  }

  const runtime = await resolveBbAppRuntimeState({
    entrypointUrl: import.meta.url,
    env: process.env,
    homeDir: homedir(),
    options: parsedArgs.options,
    serverUrlMode: "local",
  });
  assertBbAppArtifacts(runtime.context);

  const childProcess = spawn(process.execPath, [runtime.context.serverEntry], {
    cwd: process.cwd(),
    env: createServerEnv({
      context: runtime.context,
      env: runtime.serverEnv,
    }),
    stdio: "inherit",
  });
  process.exitCode = toExitCode(await waitForProcessExit(childProcess));
}

async function runHostDaemonOnly(args: RunHostDaemonOnlyArgs): Promise<void> {
  const command = resolveHostDaemonCommand(args.args);
  const baseDaemonEnv = args.env;
  const serverUrl = resolveHostDaemonServerUrl({
    context: args.context,
    env: baseDaemonEnv,
  });
  const joinEnv =
    command.kind === "join"
      ? await createHostDaemonJoinEnv({
          context: args.context,
          env: baseDaemonEnv,
          serverUrl,
        })
      : baseDaemonEnv;
  const daemonEnv = createHostDaemonOnlyEnv({
    context: args.context,
    env: joinEnv,
    serverUrl,
  });
  const enrollment = resolveEnrollmentRequirements({
    context: args.context,
    env: daemonEnv,
  });

  process.stdout.write(`\n  ${bold("bb host-daemon")}\n\n`);

  if (existsSync(args.context.daemonLockDir)) {
    warnExistingDaemonLock(args.context.daemonLockDir);
  }

  if (!enrollment.enrolled && enrollment.enrollKey === undefined) {
    endStep(
      red("✗"),
      `Not enrolled - set BB_HOST_ENROLL_KEY to join ${serverUrl}`,
    );
    process.stdout.write("\n");
    log(" ", dim("Run this command to request enrollment and start daemon:"));
    log(" ", dim(`  bb-app host-daemon join --server-url ${serverUrl}`));
    process.stdout.write("\n");
    process.exitCode = 1;
    return;
  }

  beginStep(
    enrollment.enrolled ? "Starting daemon" : "Enrolling and starting daemon",
  );

  const outputBuffer = createOutputBuffer();
  const daemonProcess = spawnManagedProcess({
    args: [args.context.daemonEntry],
    command: process.execPath,
    env: daemonEnv,
    outputBuffer,
  });

  let shuttingDown = false;
  const daemonExit = waitForProcessExit(daemonProcess);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write("\n");
    log(dim("●"), "Shutting down");
    await terminateProcessIfRunning({
      childProcess: daemonProcess,
      processName: "daemon",
      signal,
    });
  };

  const removeSignalForwarding = installTerminationSignalForwarding(
    (signal) => {
      void shutdown(signal);
    },
  );

  try {
    try {
      await waitForHealth({
        childProcess: daemonProcess,
        url: `http://${BB_LOOPBACK_HOST}:${args.context.daemonPort}/health`,
      });
    } catch {
      endStep(red("✗"), "Host daemon failed to start");
      log(" ", dim(`lock: ${args.context.daemonLockDir}`));
      log(" ", dim(`logs: ${args.context.logDir}/`));
      outputBuffer.flush();
      process.exitCode = 1;
      await shutdown("SIGTERM");
      return;
    }

    endStep(green("✓"), "Host daemon running");

    process.stdout.write("\n");
    log(green("●"), bold("bb host-daemon is ready"));
    process.stdout.write("\n");
    log(" ", formatReadyOutputRow("server", cyan(serverUrl)));
    log(" ", formatReadyOutputRow("daemon", String(args.context.daemonPort)));
    log(" ", formatReadyOutputRow("data", args.context.dataDir));
    log(" ", formatReadyOutputRow("logs", `${args.context.logDir}/`));
    log(" ", formatReadyOutputRow("lock", args.context.daemonLockFile));
    log(
      " ",
      formatReadyOutputRow(
        "auth",
        join(args.context.dataDir, HOST_AUTH_FILE_NAME),
      ),
    );
    process.stdout.write("\n");
    log(" ", dim("Press Ctrl+C to stop"));

    outputBuffer.flush();
    process.exitCode = toExitCode(await daemonExit);
  } finally {
    removeSignalForwarding();
  }
}

export async function runBbHostDaemon(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const parsedArgs = parseLauncherArgs(cliArgs);
  if (parsedArgs.options.help) {
    process.stdout.write(`bb-host-daemon

Usage:
  bb-host-daemon [--server-url <url>] [--host-id <id>] [--host-type <type>] [--enroll-key <key>]
  bb-host-daemon join --server-url <url>
`);
    return;
  }

  const runtime = await resolveBbAppRuntimeState({
    entrypointUrl: import.meta.url,
    env: process.env,
    homeDir: homedir(),
    options: parsedArgs.options,
    serverUrlMode: "managed",
  });
  assertBbAppArtifacts(runtime.context);
  await runHostDaemonOnly({
    args: parsedArgs.positionals,
    context: runtime.context,
    env: runtime.env,
  });
}

function installTerminationSignalForwarding(
  callback: (signal: NodeJS.Signals) => void,
): () => void {
  const sigintHandler = (): void => callback("SIGINT");
  const sigtermHandler = (): void => callback("SIGTERM");
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  return () => {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
  };
}

export function isMainModule(args: IsMainModuleArgs): boolean {
  if (args.entrypointPath === undefined) {
    return false;
  }

  const modulePath = fileURLToPath(args.moduleUrl);
  try {
    return realpathSync(args.entrypointPath) === realpathSync(modulePath);
  } catch {
    return resolve(args.entrypointPath) === resolve(modulePath);
  }
}

function printBbAppHelp(): void {
  process.stdout.write(`bb-app

Usage:
  bb-app [--data-dir <path>] [--server-port <port>] [--host-daemon-port <port>]
  bb-app start
  bb-app config set <key> <value>
  bb-app config refresh
  bb-app env set <key> <value>
  bb-app host-daemon [--server-url <url>] [--host-id <id>] [--host-type <type>] [--enroll-key <key>]
  bb-app host-daemon join --server-url <url>

CLI:
  npx --package bb-app bb <command>
`);
}

function logManagedProcessStartupFailureContext(
  args: LogManagedProcessStartupFailureContextArgs,
): void {
  if (args.processName === "server") {
    log(" ", dim(`Check logs: ${args.context.logDir}/`));
    return;
  }

  log(" ", dim(`lock: ${args.context.daemonLockDir}`));
  log(" ", dim(`logs: ${args.context.logDir}/`));
}

async function startFullStackServerProcess(
  args: StartFullStackServerProcessArgs,
): Promise<ManagedProcessRun> {
  const serverRun = spawnNamedManagedProcess({
    args: [args.context.serverEntry],
    command: process.execPath,
    env: args.env,
    outputBuffer: args.outputBuffer,
    processName: "server",
  });
  args.processes.serverRun = serverRun;

  try {
    await waitForHealth({
      childProcess: serverRun.childProcess,
      url: `${args.context.serverUrl}/health`,
    });
    return serverRun;
  } catch {
    await terminateProcessIfRunning({
      childProcess: serverRun.childProcess,
      processName: "server",
      signal: "SIGTERM",
    });
    if (args.processes.serverRun === serverRun) {
      args.processes.serverRun = null;
    }
    throw new Error("Server failed to become healthy");
  }
}

async function startFullStackDaemonProcess(
  args: StartFullStackDaemonProcessArgs,
): Promise<ManagedProcessRun> {
  const daemonRun = spawnNamedManagedProcess({
    args: [args.context.daemonEntry],
    command: process.execPath,
    env: createDaemonEnv(args.context, args.autoJoinEnv),
    outputBuffer: args.outputBuffer,
    processName: "daemon",
  });
  args.processes.daemonRun = daemonRun;

  try {
    await waitForHealth({
      childProcess: daemonRun.childProcess,
      url: `http://${BB_LOOPBACK_HOST}:${args.context.daemonPort}/health`,
    });
    return daemonRun;
  } catch {
    await terminateProcessIfRunning({
      childProcess: daemonRun.childProcess,
      processName: "daemon",
      signal: "SIGTERM",
    });
    if (args.processes.daemonRun === daemonRun) {
      args.processes.daemonRun = null;
    }
    throw new Error("Host daemon failed to become healthy");
  }
}

async function restartManagedProcess(
  args: RestartManagedProcessArgs,
): Promise<ManagedProcessRun | null> {
  while (!args.isShutdownRequested()) {
    beginStep(`Restarting ${formatManagedProcessLabel(args.processName)}`);
    try {
      const processRun = await args.start();
      endStep(
        green("✓"),
        `${formatManagedProcessName(args.processName)} restarted`,
      );
      return processRun;
    } catch {
      if (args.isShutdownRequested()) {
        return null;
      }
      endStep(
        red("✗"),
        `${formatManagedProcessName(args.processName)} failed to restart`,
      );
      logManagedProcessStartupFailureContext({
        context: args.context,
        processName: args.processName,
      });
      await args.delayMilliseconds({
        ms: MANAGED_PROCESS_RESTART_RETRY_DELAY_MS,
      });
    }
  }

  return null;
}

export async function terminateManagedFullStackProcesses(
  args: TerminateManagedFullStackProcessesArgs,
): Promise<void> {
  const terminationPromises: Promise<void>[] = [];
  const serverRun = args.processes.serverRun;
  const daemonRun = args.processes.daemonRun;
  if (serverRun !== null) {
    terminationPromises.push(serverRun.terminate(args.signal));
  }
  if (daemonRun !== null) {
    terminationPromises.push(daemonRun.terminate(args.signal));
  }
  await Promise.all(terminationPromises);
}

export async function superviseFullStackProcesses(
  args: SuperviseFullStackProcessesArgs,
): Promise<FullStackSupervisionResult> {
  while (!args.isShutdownRequested()) {
    const serverRun = args.processes.serverRun;
    const daemonRun = args.processes.daemonRun;
    if (serverRun === null || daemonRun === null) {
      return "stopped";
    }

    const exitedProcess = await Promise.race([serverRun.exit, daemonRun.exit]);
    if (args.isShutdownRequested()) {
      return "shutdown";
    }

    log(
      yellow("!"),
      `${formatManagedProcessLabel(exitedProcess.processName)} exited with ${formatProcessExitResult(
        exitedProcess.result,
      )} - restarting ${formatManagedProcessLabel(exitedProcess.processName)}`,
    );

    if (exitedProcess.processName === "server") {
      if (args.processes.serverRun === serverRun) {
        args.processes.serverRun = null;
      }
      await args.delayMilliseconds({
        ms: MANAGED_PROCESS_RESTART_RETRY_DELAY_MS,
      });
      if (args.isShutdownRequested()) {
        return "shutdown";
      }
      const restartedServer = await restartManagedProcess({
        context: args.context,
        delayMilliseconds: args.delayMilliseconds,
        isShutdownRequested: args.isShutdownRequested,
        processName: "server",
        start: args.startServer,
      });
      if (restartedServer === null) {
        return "shutdown";
      }
      continue;
    }

    if (args.processes.daemonRun === daemonRun) {
      args.processes.daemonRun = null;
    }
    await args.delayMilliseconds({
      ms: MANAGED_PROCESS_RESTART_RETRY_DELAY_MS,
    });
    if (args.isShutdownRequested()) {
      return "shutdown";
    }
    const restartedDaemon = await restartManagedProcess({
      context: args.context,
      delayMilliseconds: args.delayMilliseconds,
      isShutdownRequested: args.isShutdownRequested,
      processName: "daemon",
      start: args.startDaemon,
    });
    if (restartedDaemon === null) {
      return "shutdown";
    }
  }
  return "shutdown";
}

export async function completeFullStackSupervision(
  args: CompleteFullStackSupervisionArgs,
): Promise<void> {
  if (args.shutdownPromise !== null) {
    await args.shutdownPromise;
  }
  if (args.supervisionResult === "shutdown") {
    process.exitCode = 0;
  }
}

export async function runBbApp(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const parsedArgs = parseLauncherArgs(cliArgs);

  if (parsedArgs.options.help) {
    printBbAppHelp();
    return;
  }

  const command = resolveBbAppCommand(parsedArgs.positionals);
  if (command.kind === "help") {
    printBbAppHelp();
    return;
  }
  if (command.kind === "invalid") {
    process.stderr.write(`Unknown bb-app command: ${command.command}\n\n`);
    printBbAppHelp();
    process.exitCode = 1;
    return;
  }

  const runtime = await resolveBbAppRuntimeState({
    entrypointUrl: import.meta.url,
    env: process.env,
    homeDir: homedir(),
    options: parsedArgs.options,
    serverUrlMode:
      command.kind === "config" ||
      command.kind === "env" ||
      command.kind === "host-daemon"
        ? "managed"
        : "local",
  });

  if (command.kind === "config") {
    await runConfigCommand({
      args: command.args,
      dataDir: runtime.context.dataDir,
      serverUrl: runtime.context.serverUrl,
    });
    return;
  }

  if (command.kind === "env") {
    await runEnvCommand({
      args: command.args,
      dataDir: runtime.context.dataDir,
      serverUrl: runtime.context.serverUrl,
    });
    return;
  }

  assertBbAppArtifacts(runtime.context);

  if (command.kind === "host-daemon") {
    await runHostDaemonOnly({
      args: command.args,
      context: runtime.context,
      env: runtime.env,
    });
    return;
  }

  const context = runtime.context;
  const outputBuffer = createOutputBuffer();
  const serverEnv = createServerEnv({
    context,
    env: runtime.serverEnv,
  });
  const sharedEnv = createSharedEnv({
    context,
    env: runtime.env,
  });

  process.stdout.write(`\n  ${bold("bb")}\n\n`);

  if (existsSync(runtime.context.daemonLockDir)) {
    warnExistingDaemonLock(runtime.context.daemonLockDir);
  }

  const processes: ManagedFullStackProcesses = {
    daemonRun: null,
    serverRun: null,
  };
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  const isShutdownRequested = (): boolean => shuttingDown;
  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise !== null) {
      return shutdownPromise;
    }
    shuttingDown = true;
    shutdownPromise = (async () => {
      process.stdout.write("\n");
      log(dim("●"), "Shutting down");
      await terminateManagedFullStackProcesses({ processes, signal });
    })();
    return shutdownPromise;
  };
  const startServer = (): Promise<ManagedProcessRun> =>
    startFullStackServerProcess({
      context,
      env: serverEnv,
      outputBuffer,
      processes,
    });

  const removeSignalForwarding = installTerminationSignalForwarding(
    (signal) => {
      void shutdown(signal);
    },
  );

  try {
    beginStep("Starting server");
    try {
      await startServer();
    } catch {
      endStep(red("✗"), "Server failed to start (health check timed out)");
      logManagedProcessStartupFailureContext({
        context,
        processName: "server",
      });
      outputBuffer.flush();
      process.exitCode = 1;
      await shutdown("SIGTERM");
      return;
    }

    endStep(green("✓"), `Server listening on ${cyan(context.serverUrl)}`);

    beginStep("Starting host daemon");
    const autoJoinEnv = await maybeAddAutoJoinEnv({
      dataDir: context.dataDir,
      env: sharedEnv,
      serverUrl: context.serverUrl,
    });
    const startDaemon = (): Promise<ManagedProcessRun> =>
      startFullStackDaemonProcess({
        autoJoinEnv,
        context,
        outputBuffer,
        processes,
      });

    try {
      await startDaemon();
    } catch {
      endStep(red("✗"), "Host daemon failed to start");
      logManagedProcessStartupFailureContext({
        context,
        processName: "daemon",
      });
      outputBuffer.flush();
      process.exitCode = 1;
      await shutdown("SIGTERM");
      return;
    }

    endStep(green("✓"), "Host daemon running");

    process.stdout.write("\n");
    log(green("●"), bold("bb is ready"));
    process.stdout.write("\n");
    log(" ", formatReadyOutputRow("app", cyan(context.serverUrl)));
    log(" ", formatReadyOutputRow("daemon", String(context.daemonPort)));
    log(" ", formatReadyOutputRow("data", context.dataDir));
    log(" ", formatReadyOutputRow("db", context.dbPath));
    log(" ", formatReadyOutputRow("logs", `${context.logDir}/`));
    log(" ", formatReadyOutputRow("lock", context.daemonLockFile));
    process.stdout.write("\n");
    log(" ", dim("Press Ctrl+C to stop"));

    outputBuffer.flush();
    const supervisionResult = await superviseFullStackProcesses({
      context,
      delayMilliseconds,
      isShutdownRequested,
      processes,
      startDaemon,
      startServer,
    });
    await completeFullStackSupervision({ shutdownPromise, supervisionResult });
  } catch (error) {
    await shutdown("SIGTERM");
    throw error;
  } finally {
    removeSignalForwarding();
  }
}
