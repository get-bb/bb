import { loadDevAppConfig } from "./dev-app.js";
import { type EnvLoaderArgs } from "./env.js";
import { loadServerPortConfig } from "./server-port.js";

export type ViteDevServerWsOrigin = { kind: "browser-host"; port: number };

export interface ViteDevConfig {
  appPort: number;
  serverHttpOrigin: string;
  serverPort: number;
  serverWsOrigin: ViteDevServerWsOrigin;
  appHost: string;
}

export interface LoadViteDevConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

function resolveViteDevAppHost(configuredHost: string): string {
  if (configuredHost !== "") {
    return configuredHost;
  }

  return "0.0.0.0";
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
  const serverPort = serverPortConfig.BB_SERVER_PORT;
  return {
    appHost: resolveViteDevAppHost(devAppConfig.BB_DEV_APP_HOST),
    appPort,
    serverHttpOrigin: `http://localhost:${serverPort}`,
    serverPort,
    serverWsOrigin: {
      kind: "browser-host",
      port: serverPort,
    },
  };
}
