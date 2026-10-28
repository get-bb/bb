export const HOST_DAEMON_PROTOCOL_VERSION = 258 as const;

export const HOST_DAEMON_CONNECT_NEXT_PROTOCOL_VERSION = 247 as const;

export const HOST_DAEMON_DESKTOP_BROKER_PROOF_PROTOCOL_VERSION = 248 as const;

export const HOST_DAEMON_ENVIRONMENT_CLEANUP_INSPECTION_PROTOCOL_VERSION =
  249 as const;

export const HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS: readonly number[] = [
  HOST_DAEMON_PROTOCOL_VERSION,
];

export function isCompatibleHostDaemonProtocolVersion(
  protocolVersion: number,
): boolean {
  return HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS.includes(protocolVersion);
}

export function hostDaemonSupportsConnectNext(
  protocolVersion: number,
): boolean {
  return protocolVersion >= HOST_DAEMON_CONNECT_NEXT_PROTOCOL_VERSION;
}

export function hostDaemonSupportsDesktopBrokerProof(
  protocolVersion: number,
): boolean {
  return protocolVersion >= HOST_DAEMON_DESKTOP_BROKER_PROOF_PROTOCOL_VERSION;
}

export function hostDaemonSupportsEnvironmentCleanupInspection(
  protocolVersion: number,
): boolean {
  return (
    protocolVersion >=
    HOST_DAEMON_ENVIRONMENT_CLEANUP_INSPECTION_PROTOCOL_VERSION
  );
}

export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

export const HOST_DAEMON_TERMINAL_EXIT_RETENTION_MS = 30 * 60 * 1000;
