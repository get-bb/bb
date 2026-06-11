import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import {
  BB_APP_URL_ENV,
  BB_DEV_APP_PORT_ENV,
  BB_DEV_REPLAY_CAPTURE_ENV,
  BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES_ENV,
  DEFAULT_BB_APP_URL,
  DEFAULT_BB_DEV_REPLAY_CAPTURE,
  DEFAULT_BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { validateOptionalUrl } from "./public-url.js";
import { validatePortNumber } from "./runtime.js";
import { loadServerUrlValue } from "./server-url.js";

export interface HostDaemonConnectionConfig {
  BB_APP_URL: string;
  BB_DEV_APP_PORT?: number;
  BB_DEV_REPLAY_CAPTURE: boolean;
  BB_HOST_DAEMON_PORT: number;
  BB_SERVER_URL: string;
  BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES: number;
}

export interface HostDaemonConfig
  extends CommonConfig, HostDaemonConnectionConfig {}

export interface LoadHostDaemonConnectionConfigArgs extends EnvLoaderArgs {
  hostDaemonPort?: number;
  repoRoot?: string;
  serverUrl?: string;
}

export interface LoadHostDaemonConfigArgs
  extends LoadCommonConfigArgs, LoadHostDaemonConnectionConfigArgs {}

export interface HostDaemonStartConfig {
  dataDir?: string;
  connectionConfig?: HostDaemonConnectionConfig;
}

export interface LoadHostDaemonStartConfigArgs extends LoadHostDaemonConfigArgs {
  dataDir?: string;
  enableLocalApi: boolean;
}

function resolveHostDaemonPort(
  args: LoadHostDaemonConnectionConfigArgs,
): number {
  if (args.hostDaemonPort !== undefined) {
    return validatePortNumber({
      name: "BB_HOST_DAEMON_PORT",
      value: args.hostDaemonPort,
    });
  }

  return loadHostDaemonPortValue(args);
}

export function loadHostDaemonConnectionConfig(
  args: LoadHostDaemonConnectionConfigArgs = {},
): HostDaemonConnectionConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonConnectionConfig = {
    BB_APP_URL: validateOptionalUrl(
      "BB_APP_URL",
      readEnvVarWithDefault({
        context: loader.context,
        defaultValue: DEFAULT_BB_APP_URL,
        definition: BB_APP_URL_ENV,
        env: loader.env,
      }),
    ),
    BB_DEV_REPLAY_CAPTURE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_DEV_REPLAY_CAPTURE,
      definition: BB_DEV_REPLAY_CAPTURE_ENV,
      env: loader.env,
    }),
    BB_HOST_DAEMON_PORT: resolveHostDaemonPort({
      ...args,
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
    BB_SERVER_URL: loadServerUrlValue({
      ...args,
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
    BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES,
      definition: BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES_ENV,
      env: loader.env,
    }),
  };
  const devAppPort = readOptionalEnvVar({
    context: loader.context,
    definition: BB_DEV_APP_PORT_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "BB_DEV_APP_PORT",
    target: config,
    value: devAppPort,
  });

  return config;
}

export function loadHostDaemonConfig(
  args: LoadHostDaemonConfigArgs = {},
): HostDaemonConfig {
  return {
    ...loadCommonConfig(args),
    ...loadHostDaemonConnectionConfig(args),
  };
}

export function loadHostDaemonStartConfig(
  args: LoadHostDaemonStartConfigArgs,
): HostDaemonStartConfig {
  if (args.dataDir === undefined) {
    const config = loadHostDaemonConfig(args);
    return {
      connectionConfig: config,
      dataDir: config.BB_DATA_DIR,
    };
  }

  if (args.serverUrl === undefined || args.enableLocalApi) {
    return {
      connectionConfig: loadHostDaemonConnectionConfig(args),
      dataDir: args.dataDir,
    };
  }

  return {
    dataDir: args.dataDir,
  };
}
