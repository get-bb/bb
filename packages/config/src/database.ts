import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import { resolveDataDirDatabasePath } from "./runtime.js";

export interface DatabaseConfig {
  databasePath: string;
}

interface LoadDatabaseConfigArgs extends LoadCommonConfigArgs {
  commonConfig?: CommonConfig;
}

export function loadDatabaseConfig(
  args: LoadDatabaseConfigArgs = {},
): DatabaseConfig {
  const commonConfig = args.commonConfig ?? loadCommonConfig(args);
  return {
    databasePath: resolveDataDirDatabasePath({
      dataDir: commonConfig.BB_DATA_DIR,
    }),
  };
}
