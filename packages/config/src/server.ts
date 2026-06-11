import type { FeatureFlags } from "@bb/domain";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import { loadDatabaseConfig, type DatabaseConfig } from "./database.js";
import { loadDevEnvConfig } from "./dev-env.js";
import { readEnvVarWithDefault, resolveEnvLoader } from "./env.js";
import {
  BB_APP_URL_ENV,
  BB_APP_VERSION_ENV,
  BB_EXTERNAL_URL_ENV,
  BB_INFERENCE_ENV,
  BB_TRANSCRIPTION_ENV,
  BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST_ENV,
  DEFAULT_BB_APP_URL,
  DEFAULT_BB_APP_VERSION,
  DEFAULT_BB_EXTERNAL_URL,
  DEFAULT_BB_INFERENCE,
  DEFAULT_BB_TRANSCRIPTION,
  DEFAULT_BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST,
  DEFAULT_OPENAI_API_KEY,
  OPENAI_API_KEY_ENV,
} from "./env-vars.js";
import { loadFeatureFlags } from "./feature-flags.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { loadServerPortConfig, type ServerPortConfig } from "./server-port.js";

export interface ServerConfig
  extends CommonConfig, DatabaseConfig, ServerPortConfig {
  BB_APP_URL: string;
  BB_APP_VERSION: string;
  BB_DEV_APP_PORT?: number;
  BB_EXTERNAL_URL: string;
  BB_HOST_DAEMON_PORT: number;
  BB_INFERENCE: string;
  BB_TRANSCRIPTION: string;
  BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST: number;
  OPENAI_API_KEY: string;
  featureFlags: FeatureFlags;
}

export type LoadServerConfigArgs = LoadCommonConfigArgs;

export function loadServerConfig(
  args: LoadServerConfigArgs = {},
): ServerConfig {
  const loader = resolveEnvLoader(args);
  const commonConfig = loadCommonConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const databaseConfig = loadDatabaseConfig({
    commonConfig,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const serverPortConfig = loadServerPortConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const devEnvConfig = loadDevEnvConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });
  const config: ServerConfig = {
    ...commonConfig,
    ...databaseConfig,
    ...serverPortConfig,
    BB_APP_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_APP_URL,
      definition: BB_APP_URL_ENV,
      env: loader.env,
    }),
    BB_APP_VERSION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_APP_VERSION,
      definition: BB_APP_VERSION_ENV,
      env: loader.env,
    }),
    BB_EXTERNAL_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_EXTERNAL_URL,
      definition: BB_EXTERNAL_URL_ENV,
      env: loader.env,
    }),
    BB_HOST_DAEMON_PORT: loadHostDaemonPortValue({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
      repoRoot: args.repoRoot,
    }),
    BB_INFERENCE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_INFERENCE,
      definition: BB_INFERENCE_ENV,
      env: loader.env,
    }),
    BB_TRANSCRIPTION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_TRANSCRIPTION,
      definition: BB_TRANSCRIPTION_ENV,
      env: loader.env,
    }),
    BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST,
      definition: BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST_ENV,
      env: loader.env,
    }),
    OPENAI_API_KEY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_OPENAI_API_KEY,
      definition: OPENAI_API_KEY_ENV,
      env: loader.env,
    }),
    featureFlags: loadFeatureFlags({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
  };

  assignIfDefined({
    key: "BB_DEV_APP_PORT",
    target: config,
    value: devEnvConfig.BB_DEV_APP_PORT,
  });

  return config;
}
