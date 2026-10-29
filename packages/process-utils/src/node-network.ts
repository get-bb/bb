const NODE_NETWORK_FLAGS = {
  "--use-system-ca": "NODE_USE_SYSTEM_CA",
  "--use-env-proxy": "NODE_USE_ENV_PROXY",
} as const;
const ENV_PROXY_FLAG = "--use-env-proxy";
const PROXY_KEYS = new Set(["HTTP_PROXY", "HTTPS_PROXY"]);
const NO_PROXY_KEY = "NO_PROXY";
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export interface NodeNetworkLaunch {
  nodeArgs: string[];
  env: NodeJS.ProcessEnv;
  rejectedProxyKeys: string[];
}

function isNodeNetworkFlag(
  arg: string,
): arg is keyof typeof NODE_NETWORK_FLAGS {
  return Object.hasOwn(NODE_NETWORK_FLAGS, arg);
}

export function nodeNetworkArgs(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(NODE_NETWORK_FLAGS)
    .filter(
      ([flag, key]) =>
        env[key] !== "0" && process.allowedNodeEnvironmentFlags.has(flag),
    )
    .map(([flag]) => flag);
}

export function inheritedNodeNetworkArgs(
  execArgv: readonly string[],
): string[] {
  return execArgv.filter(isNodeNetworkFlag);
}

function isHttpProxyUrl(value: string): boolean {
  if (/[\r\n]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
}

function proxyEntries(env: NodeJS.ProcessEnv): [string, string][] {
  return Object.entries(env).filter(
    (entry): entry is [string, string] =>
      PROXY_KEYS.has(entry[0].toUpperCase()) &&
      entry[1] !== undefined &&
      entry[1] !== "",
  );
}

function appendLoopback(value: string): string {
  const entries = value.split(/[\s,]+/u).filter(Boolean);
  if (entries.includes("*")) return value;
  const present = new Set(entries.map((entry) => entry.toLowerCase()));
  return [
    ...entries,
    ...LOOPBACK_HOSTS.filter((host) => !present.has(host)),
  ].join(",");
}

function withLoopbackNoProxy(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  const keys = Object.keys(result).filter(
    (key) => key.toUpperCase() === NO_PROXY_KEY && result[key] !== undefined,
  );
  for (const key of keys.length > 0 ? keys : [NO_PROXY_KEY])
    result[key] = appendLoopback(result[key] ?? "");
  return result;
}

export function nodeNetworkLaunch(
  nodeArgs: readonly string[],
  env: NodeJS.ProcessEnv,
): NodeNetworkLaunch {
  const enabled = nodeArgs.filter(
    (arg) => !isNodeNetworkFlag(arg) || env[NODE_NETWORK_FLAGS[arg]] !== "0",
  );
  if (!enabled.includes(ENV_PROXY_FLAG))
    return { nodeArgs: enabled, env, rejectedProxyKeys: [] };
  const proxies = proxyEntries(env);
  const rejectedProxyKeys = proxies
    .filter(([, value]) => !isHttpProxyUrl(value))
    .map(([key]) => key);
  if (rejectedProxyKeys.length > 0)
    return {
      nodeArgs: enabled.filter((arg) => arg !== ENV_PROXY_FLAG),
      env,
      rejectedProxyKeys,
    };
  return {
    nodeArgs: enabled,
    env: proxies.length > 0 ? withLoopbackNoProxy(env) : env,
    rejectedProxyKeys: [],
  };
}

const warnedProxyKeys = new Set<string>();

export function prepareNodeNetworkLaunch(
  nodeArgs: readonly string[],
  env: NodeJS.ProcessEnv,
): { nodeArgs: string[]; env: NodeJS.ProcessEnv } {
  const launch = nodeNetworkLaunch(nodeArgs, env);
  const unwarned = launch.rejectedProxyKeys.filter(
    (key) => !warnedProxyKeys.has(key),
  );
  if (unwarned.length > 0) {
    for (const key of unwarned) warnedProxyKeys.add(key);
    process.emitWarning(
      `bb started a Node process without --use-env-proxy because ${unwarned.join(", ")} is not an http:// or https:// URL. Add the scheme, for example http://proxy.example:3128, so bb uses the proxy.`,
      { code: "BB_INVALID_PROXY_ENV" },
    );
  }
  return { nodeArgs: launch.nodeArgs, env: launch.env };
}

export function prepareNodeNetworkCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { args: string[]; env: NodeJS.ProcessEnv } {
  const scriptIndex = args.findIndex(
    (arg) => arg === "--" || !arg.startsWith("-"),
  );
  const optionCount = scriptIndex < 0 ? args.length : scriptIndex;
  const launch = prepareNodeNetworkLaunch(args.slice(0, optionCount), env);
  return {
    args: [...launch.nodeArgs, ...args.slice(optionCount)],
    env: launch.env,
  };
}
