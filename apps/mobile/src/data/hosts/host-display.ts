import type { Host, PermissionMode } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract/local";
import { formatHostUpdateStatus } from "./host-update-status";

/** Platform label for the primary machine (the only host whose platform the config reports). */
export const HOST_PLATFORM_LABELS: Record<HostPlatform, string | null> = {
  darwin: "macOS",
  linux: "Linux",
  wsl: "WSL",
  unknown: null,
};

export const PERMISSION_MODE_SHORT_LABELS: Record<PermissionMode, string> = {
  "accept-edits": "Accept edits",
  auto: "Auto",
  full: "Full access",
};

export const PRIMARY_HOST_REMOVE_DISABLED_REASON =
  "bb's primary machine can't be removed.";

export const MACHINES_SECTION_DESCRIPTION =
  "Computers that can run your tasks. Pair a machine to run projects and threads on it.";

export const PERMISSION_LIMIT_DESCRIPTION =
  "Highest permission mode any thread on the selected machine may run with. Threads that ask for more resolve down to it, and a provider that supports nothing this low can't run here.";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * "just now", "2m ago", "3h ago", "Yesterday", "2d ago", "3w ago", then a short
 * date (mirror of apps/app/src/lib/relative-time.ts; no Intl so tests and
 * devices agree). Future timestamps (clock skew) read as "just now".
 */
export function formatRelativeAge(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  if (diffMs < MINUTE_MS) return "just now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) return "Yesterday";
  if (diffMs < WEEK_MS) return `${days}d ago`;
  if (diffMs < 5 * WEEK_MS) return `${Math.floor(diffMs / WEEK_MS)}w ago`;
  const date = new Date(timestamp);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** "Online" / "Offline · last seen 5m ago" / "Offline" (no update caveat). */
function describeHostPresence(host: Host, now: number): string {
  if (host.status === "connected") return "Online";
  if (host.lastSeenAt !== null) {
    return `Offline · last seen ${formatRelativeAge(host.lastSeenAt, now)}`;
  }
  return "Offline";
}

export interface MachineMetaLineArgs {
  host: Host;
  platformLabel: string | null;
  projectCount: number;
  /** Null until `GET /install/version` has answered (see `useServerProtocolVersion`). */
  serverProtocolVersion: number | null;
  now: number;
}

/**
 * The list row's second line (web `machineMetaLine`): a stranded daemon's
 * update status wins over plain presence, then the platform and the number
 * of projects with a source on the machine.
 */
export function machineMetaLine({
  host,
  platformLabel,
  projectCount,
  serverProtocolVersion,
  now,
}: MachineMetaLineArgs): string {
  const parts: string[] = [];
  const updateStatus = formatHostUpdateStatus(host, serverProtocolVersion);
  parts.push(updateStatus ?? describeHostPresence(host, now));
  if (platformLabel !== null) parts.push(platformLabel);
  parts.push(`${projectCount} ${projectCount === 1 ? "project" : "projects"}`);
  return parts.join(" · ");
}

export interface MachineHeaderMetaArgs {
  host: Host;
  platformLabel: string | null;
  now: number;
}

/** The detail screen's subtitle (web `headerMeta`): presence · platform · paired age. */
export function machineHeaderMeta({
  host,
  platformLabel,
  now,
}: MachineHeaderMetaArgs): string {
  const parts: string[] = [describeHostPresence(host, now)];
  if (platformLabel !== null) parts.push(platformLabel);
  parts.push(`paired ${formatRelativeAge(host.createdAt, now)}`);
  return parts.join(" · ");
}

/** Projects per host from the sidebar bootstrap's project sources. */
export function countProjectsByHost(
  projects: ReadonlyArray<{ sources: ReadonlyArray<{ hostId: string }> }>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const hostIds = new Set(project.sources.map((source) => source.hostId));
    for (const hostId of hostIds) {
      counts.set(hostId, (counts.get(hostId) ?? 0) + 1);
    }
  }
  return counts;
}
