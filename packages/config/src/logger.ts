import {
  loadCommonConfig,
  loadLogLevelConfig,
  type LoadCommonConfigArgs,
  type LogLevelConfig,
} from "./common.js";

interface LoggerConfig extends LogLevelConfig {
  BB_DATA_DIR: string;
}

interface LoadLoggerConfigArgs extends LoadCommonConfigArgs {
  dataDir?: string;
}

export function loadLoggerConfig(
  args: LoadLoggerConfigArgs = {},
): LoggerConfig {
  if (args.dataDir !== undefined) {
    return {
      ...loadLogLevelConfig(args),
      BB_DATA_DIR: args.dataDir,
    };
  }

  return loadCommonConfig(args);
}
