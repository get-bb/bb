export function nodeNetworkEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    NODE_USE_ENV_PROXY: env.NODE_USE_ENV_PROXY ?? "1",
    NODE_USE_SYSTEM_CA: env.NODE_USE_SYSTEM_CA ?? "1",
  };
}

export function nodeNetworkArgs(env: NodeJS.ProcessEnv): string[] {
  return (env.NODE_USE_SYSTEM_CA ?? "1") === "1" ? ["--use-system-ca"] : [];
}
