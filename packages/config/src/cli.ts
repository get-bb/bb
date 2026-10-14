import { readFileSync } from "node:fs";
import {
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
  type BbAppManagedConfig,
} from "./bb-app-managed-config.js";
import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_SERVER_HEADERS_ENV } from "./env-vars.js";
import { loadHostDaemonPortValue } from "./ports.js";
import {
  BB_LOOPBACK_HOST,
  BB_PROD_HOST_DAEMON_PORT,
  BB_PROD_SERVER_PORT,
  resolveConfiguredDataDir,
  resolveDevInstanceConfig,
  resolveProdDataDir,
} from "./runtime.js";
import { loadServerUrlValue } from "./server-url.js";
import { toOptionalString } from "./strings.js";

export interface CliConfig {
  BB_HOST_DAEMON_PORT: number;
  BB_SERVER_URL: string;
  BB_SERVER_HEADERS?: Record<string, string>;
}

interface LoadCliConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

const DEFAULT_CLI_SERVER_URL = `http://${BB_LOOPBACK_HOST}:${BB_PROD_SERVER_PORT}`;

function readCliManagedConfig(dataDir: string): BbAppManagedConfig {
  let content: string;
  try {
    content = readFileSync(formatBbAppConfigPath(dataDir), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw new Error("Unable to read bb CLI configuration");
  }
  try {
    return parseBbAppManagedConfig(JSON.parse(content));
  } catch {
    throw new Error("Invalid bb CLI configuration");
  }
}

export function loadCliConfig(args: LoadCliConfigArgs = {}): CliConfig {
  const loader = resolveEnvLoader(args);
  const devConfig =
    loader.mode === "dev" && args.repoRoot !== undefined
      ? resolveDevInstanceConfig({
          homeDir: loader.context.homeDir,
          repoRoot: args.repoRoot,
        })
      : undefined;
  const dataDir = resolveConfiguredDataDir({
    env: loader.env,
    homeDir: loader.context.homeDir,
    defaultDataDir:
      devConfig?.dataDir ??
      resolveProdDataDir({ homeDir: loader.context.homeDir }),
  });
  const config = readCliManagedConfig(dataDir);
  const callerServerUrl = toOptionalString(loader.env.BB_SERVER_URL);
  const serverUrl = loadServerUrlValue({
    ...args,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    serverUrl:
      callerServerUrl ??
      config.serverUrl ??
      devConfig?.serverUrl ??
      DEFAULT_CLI_SERVER_URL,
  });
  const usesSavedServer =
    config.serverUrl !== undefined &&
    new URL(serverUrl).href === new URL(config.serverUrl).href;
  const envHeaders =
    callerServerUrl === undefined
      ? undefined
      : readOptionalEnvVar({
          context: loader.context,
          definition: BB_SERVER_HEADERS_ENV,
          env: loader.env,
        });
  const serverHeaders =
    envHeaders ??
    (usesSavedServer
      ? (config.serverHeaders ??
        (config.machineCredential === undefined
          ? undefined
          : { "x-bb-connect-machine": config.machineCredential }))
      : undefined);

  return {
    BB_HOST_DAEMON_PORT:
      loader.env.BB_HOST_DAEMON_PORT !== undefined || devConfig !== undefined
        ? loadHostDaemonPortValue({
            ...args,
            env: loader.env,
            homeDir: loader.context.homeDir,
            mode: loader.mode,
          })
        : BB_PROD_HOST_DAEMON_PORT,
    BB_SERVER_URL: serverUrl,
    ...(serverHeaders === undefined
      ? {}
      : { BB_SERVER_HEADERS: serverHeaders }),
  };
}
