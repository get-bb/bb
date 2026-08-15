import { isLoopbackHostname } from "./loopback-hostname";

export type LocalHostDaemonAccessState =
  | "available"
  | "denied"
  | "permission-required"
  | "unavailable"
  | "unsupported";

type LocalNetworkPermissionName = "loopback-network" | "local-network-access";

export interface LocalNetworkPermissionQuery {
  query(descriptor: {
    name: LocalNetworkPermissionName;
  }): Promise<{ state: PermissionState }>;
}

interface ResolveLocalHostDaemonAccessArgs {
  configuredPort: number | null;
  hostname: string | null;
  isDesktop: boolean;
  permissions: LocalNetworkPermissionQuery | null;
  sessionAccessGranted: boolean;
}

const LOCAL_NETWORK_PERMISSION_NAMES: readonly LocalNetworkPermissionName[] = [
  "loopback-network",
  "local-network-access",
];

export function getBrowserLocalNetworkPermissionQuery(): LocalNetworkPermissionQuery | null {
  if (
    typeof navigator === "undefined" ||
    !("permissions" in navigator) ||
    navigator.permissions === undefined
  ) {
    return null;
  }

  // Local Network Access permission names are newer than the DOM typings used
  // by some supported browsers. Narrow this browser boundary once, then keep
  // the rest of the app on the explicit local contract above.
  return navigator.permissions as unknown as LocalNetworkPermissionQuery;
}

async function queryLoopbackPermissionState(
  permissions: LocalNetworkPermissionQuery | null,
): Promise<PermissionState | "unsupported"> {
  if (!permissions) {
    return "unsupported";
  }

  for (const name of LOCAL_NETWORK_PERMISSION_NAMES) {
    try {
      const result = await permissions.query({ name });
      return result.state;
    } catch {
      // Chrome 142–144 only knows the original permission name. Chrome 145+
      // supports the loopback-specific name and retains the old name as an
      // alias, so only fall back when the newer query is unsupported.
    }
  }

  return "unsupported";
}

export async function resolveLocalHostDaemonAccess({
  configuredPort,
  hostname,
  isDesktop,
  permissions,
  sessionAccessGranted,
}: ResolveLocalHostDaemonAccessArgs): Promise<LocalHostDaemonAccessState> {
  if (configuredPort === null) {
    return "unavailable";
  }

  if (
    sessionAccessGranted ||
    isDesktop ||
    (hostname !== null && isLoopbackHostname(hostname))
  ) {
    return "available";
  }

  const permissionState = await queryLoopbackPermissionState(permissions);
  switch (permissionState) {
    case "granted":
      return "available";
    case "denied":
      return "denied";
    case "prompt":
      return "permission-required";
    case "unsupported":
      return "unsupported";
  }
}

export function resolveLocalHostDaemonProbePort(
  configuredPort: number | null,
  accessState: LocalHostDaemonAccessState,
): number | null {
  return accessState === "available" ? configuredPort : null;
}
