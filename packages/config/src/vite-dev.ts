import { loadDevAppConfig } from "./dev-app.js";
import { type EnvLoaderArgs } from "./env.js";
import { assignIfDefined } from "./objects.js";
import { loadServerPortConfig } from "./server-port.js";

export type ViteDevServerWsOrigin =
  | { kind: "browser-host"; port: number }
  | { kind: "fixed"; origin: string };

export interface ViteDevConfig {
  appPort: number;
  serverHttpOrigin: string;
  serverPort: number;
  serverWsOrigin: ViteDevServerWsOrigin;
  appHost?: string;
}

export interface LoadViteDevConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

interface ResolveViteDevAppHostArgs {
  configuredHost: string;
  remote: boolean;
}

interface ResolveViteDevServerWsOriginArgs {
  remote: boolean;
  serverPort: number;
}

function resolveViteDevAppHost(
  args: ResolveViteDevAppHostArgs,
): string | undefined {
  if (args.configuredHost !== "") {
    return args.configuredHost;
  }

  return args.remote ? "0.0.0.0" : undefined;
}

function resolveViteDevServerWsOrigin(
  args: ResolveViteDevServerWsOriginArgs,
): ViteDevServerWsOrigin {
  if (args.remote) {
    return {
      kind: "browser-host",
      port: args.serverPort,
    };
  }

  return {
    kind: "fixed",
    origin: `ws://localhost:${args.serverPort}`,
  };
}

export function loadViteDevConfig(
  args: LoadViteDevConfigArgs = {},
): ViteDevConfig {
  const devAppConfig = loadDevAppConfig(args);
  const appPort = devAppConfig.BB_DEV_APP_PORT;
  if (appPort === undefined) {
    throw new Error("BB_DEV_APP_PORT is required to run the app dev server");
  }

  const serverPortConfig = loadServerPortConfig(args);
  const serverHttpOrigin = `http://localhost:${serverPortConfig.BB_SERVER_PORT}`;
  const config: ViteDevConfig = {
    appPort,
    serverHttpOrigin,
    serverPort: serverPortConfig.BB_SERVER_PORT,
    serverWsOrigin: resolveViteDevServerWsOrigin({
      remote: devAppConfig.BB_DEV_REMOTE,
      serverPort: serverPortConfig.BB_SERVER_PORT,
    }),
  };

  assignIfDefined({
    key: "appHost",
    target: config,
    value: resolveViteDevAppHost({
      configuredHost: devAppConfig.BB_DEV_APP_HOST,
      remote: devAppConfig.BB_DEV_REMOTE,
    }),
  });

  return config;
}
