import {
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
  DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
} from "@bb/host-daemon-contract";

export interface HostDaemonLocalApiConfig {
  bindHost: string;
  healthPath: string;
  healthValue: string;
  port: number;
}

export function resolveHostDaemonLocalApiConfig(args: {
  hostDaemonPort: number;
}): HostDaemonLocalApiConfig {
  return {
    bindHost: DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
    healthPath: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH,
    healthValue: DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE,
    port: args.hostDaemonPort,
  };
}
