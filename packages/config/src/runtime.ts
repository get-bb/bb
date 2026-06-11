import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export type BbRuntimeMode = "dev" | "prod";

export interface DevPortSet {
  appPort: number;
  devEnvPort: number;
  hostDaemonPort: number;
  serverPort: number;
}

export interface DevInstanceConfig {
  dataDir: string;
  instanceId: string;
  ports: DevPortSet;
  repoRoot: string;
  serverUrl: string;
}

export interface ResolveDevInstanceConfigArgs {
  homeDir: string;
  repoRoot: string;
}

export interface DevProcessEnvArgs {
  baseEnv: NodeJS.ProcessEnv;
  config: DevInstanceConfig;
}

export interface ParseDataDirEnvValueArgs {
  homeDir: string;
  rawDataDir: string;
}

export interface ResolveConfiguredDataDirArgs {
  defaultDataDir: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export interface ResolveProdDataDirArgs {
  homeDir: string;
}

export interface ResolveRuntimeDataDirArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  mode: BbRuntimeMode;
  repoRoot?: string;
}

export interface ResolveDataDirDatabasePathArgs {
  dataDir: string;
}

export interface ParsePortValueArgs {
  name: string;
  rawPort: string;
}

export interface ValidatePortNumberArgs {
  name: string;
  value: number;
}

export interface ResolvePortFromEnvArgs {
  defaultPort: number;
  env: NodeJS.ProcessEnv;
  name: string;
}

export const BB_PROD_DATA_DIR_NAME = ".bb";
export const BB_DEV_DATA_ROOT_DIR = ".bb-dev";
export const BB_PROD_SERVER_PORT = 38886;
export const BB_PROD_HOST_DAEMON_PORT = 38887;
export const BB_LOOPBACK_HOST = "127.0.0.1";
export const BB_SQLITE_DATABASE_FILE_NAME = "bb.db";

const DEV_HASH_LENGTH = 12;
const DEV_PORT_BUCKETS = 8_000;
const DEV_APP_PORT_BASE = 11_000;
const DEV_SERVER_PORT_BASE = 19_000;
const DEV_HOST_DAEMON_PORT_BASE = 27_000;
const DEV_ENV_PORT_BASE = 43_000;
const DEV_PROCESS_STRIPPED_ENV_KEYS: readonly string[] = [
  "BB_ENVIRONMENT_ID",
  "BB_THREAD_ID",
  "BB_THREAD_STORAGE",
];

function createRepoRootHash(repoRootPath: string): string {
  return createHash("sha256").update(repoRootPath).digest("hex");
}

function sanitizeInstanceLabel(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  return sanitized.length > 0 ? sanitized : "worktree";
}

function resolveRepoRootLabel(args: ResolveDevInstanceConfigArgs): string {
  const homeRelativePath = relative(args.homeDir, args.repoRoot);
  if (
    homeRelativePath.length > 0 &&
    !homeRelativePath.startsWith("../") &&
    !homeRelativePath.startsWith("..\\") &&
    homeRelativePath !== ".." &&
    !isAbsolute(homeRelativePath)
  ) {
    return homeRelativePath;
  }

  return args.repoRoot;
}

function resolveInstanceId(args: ResolveDevInstanceConfigArgs): string {
  const hash = createRepoRootHash(args.repoRoot);
  const label = resolveRepoRootLabel(args);
  return `${sanitizeInstanceLabel(label)}-${hash.slice(0, DEV_HASH_LENGTH)}`;
}

function resolvePortOffset(repoRootPath: string): number {
  const hash = createRepoRootHash(repoRootPath);
  return Number.parseInt(hash.slice(0, 8), 16) % DEV_PORT_BUCKETS;
}

function resolvePorts(repoRootPath: string): DevPortSet {
  const offset = resolvePortOffset(repoRootPath);
  return {
    appPort: DEV_APP_PORT_BASE + offset,
    devEnvPort: DEV_ENV_PORT_BASE + offset,
    hostDaemonPort: DEV_HOST_DAEMON_PORT_BASE + offset,
    serverPort: DEV_SERVER_PORT_BASE + offset,
  };
}

function expandHomeDirectory(pathValue: string, homeDir: string): string {
  if (pathValue === "~") {
    return homeDir;
  }

  if (pathValue.startsWith("~/")) {
    return resolve(homeDir, pathValue.slice(2));
  }

  return resolve(pathValue);
}

export function resolveRuntimeMode(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): BbRuntimeMode {
  return nodeEnv === "production" ? "prod" : "dev";
}

export function resolveProdDataDir(args: ResolveProdDataDirArgs): string {
  return join(args.homeDir, BB_PROD_DATA_DIR_NAME);
}

export function parseDataDirEnvValue(args: ParseDataDirEnvValueArgs): string {
  const trimmedDataDir = args.rawDataDir.trim();
  if (trimmedDataDir.length === 0) {
    throw new Error("BB_DATA_DIR must not be empty");
  }

  return expandHomeDirectory(trimmedDataDir, args.homeDir);
}

export function resolveConfiguredDataDir(
  args: ResolveConfiguredDataDirArgs,
): string {
  const rawDataDir = args.env.BB_DATA_DIR;
  if (rawDataDir === undefined) {
    return args.defaultDataDir;
  }

  return parseDataDirEnvValue({
    homeDir: args.homeDir,
    rawDataDir,
  });
}

export function resolveDevInstanceConfig(
  args: ResolveDevInstanceConfigArgs,
): DevInstanceConfig {
  const instanceId = resolveInstanceId(args);
  const dataDir = join(args.homeDir, BB_DEV_DATA_ROOT_DIR, instanceId);
  const ports = resolvePorts(args.repoRoot);
  const serverUrl = `http://localhost:${ports.serverPort}`;
  return {
    dataDir,
    instanceId,
    ports,
    repoRoot: args.repoRoot,
    serverUrl,
  };
}

export function resolveCurrentDevInstanceConfig(
  repoRoot: string,
): DevInstanceConfig {
  return resolveDevInstanceConfig({
    homeDir: homedir(),
    repoRoot,
  });
}

export function resolveRuntimeDataDir(args: ResolveRuntimeDataDirArgs): string {
  if (args.env.BB_DATA_DIR !== undefined) {
    return parseDataDirEnvValue({
      homeDir: args.homeDir,
      rawDataDir: args.env.BB_DATA_DIR,
    });
  }

  if (args.mode === "prod") {
    return resolveProdDataDir({ homeDir: args.homeDir });
  }

  if (args.repoRoot === undefined) {
    throw new Error("repoRoot is required to resolve development BB_DATA_DIR");
  }

  return resolveDevInstanceConfig({
    homeDir: args.homeDir,
    repoRoot: args.repoRoot,
  }).dataDir;
}

export function resolveDataDirDatabasePath(
  args: ResolveDataDirDatabasePathArgs,
): string {
  return join(args.dataDir, BB_SQLITE_DATABASE_FILE_NAME);
}

export function parsePortValue(args: ParsePortValueArgs): number {
  const port = Number(args.rawPort);
  if (String(port) !== args.rawPort) {
    throw new Error(`${args.name} must be a valid TCP port`);
  }

  return validatePortNumber({
    name: args.name,
    value: port,
  });
}

export function validatePortNumber(args: ValidatePortNumberArgs): number {
  if (Number.isInteger(args.value) && args.value >= 1 && args.value <= 65_535) {
    return args.value;
  }

  throw new Error(`${args.name} must be a valid TCP port`);
}

export function resolvePortFromEnv(args: ResolvePortFromEnvArgs): number {
  const rawPort = args.env[args.name];
  if (rawPort === undefined) {
    return args.defaultPort;
  }

  return parsePortValue({
    name: args.name,
    rawPort,
  });
}

export function toDevProcessEnv(args: DevProcessEnvArgs): NodeJS.ProcessEnv {
  const env = { ...args.baseEnv };
  for (const key of DEV_PROCESS_STRIPPED_ENV_KEYS) {
    delete env[key];
  }
  return {
    ...env,
    BB_DATA_DIR: args.config.dataDir,
    BB_DEV_APP_PORT: String(args.config.ports.appPort),
    BB_DEV_ENV_PORT: String(args.config.ports.devEnvPort),
    BB_HOST_DAEMON_PORT: String(args.config.ports.hostDaemonPort),
    BB_SERVER_PORT: String(args.config.ports.serverPort),
    BB_SERVER_URL: args.config.serverUrl,
    NODE_ENV: "development",
  };
}

export function resolveCurrentDevProcessEnv(
  repoRoot: string,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return toDevProcessEnv({
    baseEnv,
    config: resolveCurrentDevInstanceConfig(repoRoot),
  });
}
