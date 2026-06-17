import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  BB_DEV_APP_HOST_ENV,
  BB_DEV_APP_PORT_ENV,
  DEFAULT_BB_DEV_APP_HOST,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

export interface DevAppConfig {
  BB_DEV_APP_HOST: string;
  BB_DEV_APP_PORT?: number;
}

export type LoadDevAppConfigArgs = EnvLoaderArgs;

export function loadDevAppConfig(
  args: LoadDevAppConfigArgs = {},
): DevAppConfig {
  const loader = resolveEnvLoader(args);
  const config: DevAppConfig = {
    BB_DEV_APP_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_DEV_APP_HOST,
      definition: BB_DEV_APP_HOST_ENV,
      env: loader.env,
    }),
  };
  const appPort = readOptionalEnvVar({
    context: loader.context,
    definition: BB_DEV_APP_PORT_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "BB_DEV_APP_PORT",
    target: config,
    value: appPort,
  });

  return config;
}
