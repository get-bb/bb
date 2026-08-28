import type { HostDaemonEntrypointConfig } from "@bb/config/host-daemon-entrypoint";

export interface HostDaemonRuntimeEnvironment extends HostDaemonEntrypointConfig {
  BB_DATA_DIR: string;
  BB_HOST_DAEMON_PORT: string;
  BB_SERVER_URL: string;
  NODE_ENV: "development" | "production";
}

export function toHostDaemonProcessEnv(
  environment: HostDaemonRuntimeEnvironment,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }
    env[key] = value === true ? "1" : value === false ? "0" : value;
  }
  return env;
}
