import { loadDevAppConfig } from "./dev-app.js";
import { type EnvLoaderArgs } from "./env.js";
import { BB_LOOPBACK_HOST } from "./runtime.js";
import { loadServerPortConfig } from "./server-port.js";

interface ViteDevConfig {
  appPort: number;
  serverHttpOrigin: string;
  serverPort: number;
  appHost: string;
}

interface LoadViteDevConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

function resolveViteDevAppHost(configuredHost: string): string {
  if (configuredHost !== "") {
    return configuredHost;
  }

  return BB_LOOPBACK_HOST;
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
    serverHttpOrigin: `http://${BB_LOOPBACK_HOST}:${serverPort}`,
    serverPort,
  };
}
