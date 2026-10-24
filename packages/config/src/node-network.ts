const NODE_NETWORK_FLAGS = {
  "--use-system-ca": "NODE_USE_SYSTEM_CA",
  "--use-env-proxy": "NODE_USE_ENV_PROXY",
} as const;

export function nodeNetworkArgs(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(NODE_NETWORK_FLAGS)
    .filter(
      ([flag, key]) =>
        env[key] !== "0" && process.allowedNodeEnvironmentFlags.has(flag),
    )
    .map(([flag]) => flag);
}
