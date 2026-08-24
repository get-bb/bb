import { DEFAULTS } from "./defaults.js";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_LOG_LEVEL_ENV } from "./env-vars.js";
import { resolveRuntimeDataDir, type BbRuntimeMode } from "./runtime.js";

export interface LogLevelConfig {
  BB_LOG_LEVEL: string;
}

type LoadLogLevelConfigArgs = EnvLoaderArgs;

export interface CommonConfig extends LogLevelConfig {
  BB_DATA_DIR: string;
}

export interface LoadCommonConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

function resolveDefaultLogLevel(mode: BbRuntimeMode): string {
  return mode === "prod" ? DEFAULTS.logLevel.prod : DEFAULTS.logLevel.dev;
}

export function loadLogLevelConfig(
  args: LoadLogLevelConfigArgs = {},
): LogLevelConfig {
  const loader = resolveEnvLoader(args);
  return {
    BB_LOG_LEVEL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: resolveDefaultLogLevel(loader.mode),
      definition: BB_LOG_LEVEL_ENV,
      env: loader.env,
    }),
  };
}

export function loadCommonConfig(
  args: LoadCommonConfigArgs = {},
): CommonConfig {
  const loader = resolveEnvLoader(args);
  const logLevelConfig = loadLogLevelConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });

  return {
    ...logLevelConfig,
    BB_DATA_DIR: resolveRuntimeDataDir({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
      repoRoot: args.repoRoot,
    }),
  };
}
