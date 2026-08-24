import { loadServerPortValue, type RuntimePortLoaderArgs } from "./ports.js";

export interface ServerPortConfig {
  BB_SERVER_PORT: number;
}

type LoadServerPortConfigArgs = RuntimePortLoaderArgs;

export function loadServerPortConfig(
  args: LoadServerPortConfigArgs = {},
): ServerPortConfig {
  return {
    BB_SERVER_PORT: loadServerPortValue(args),
  };
}
