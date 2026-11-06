import type { MachineSummary } from "@/server/api";
import type { OAuthGrantView } from "@/server/oauth";

export interface DeviceGroup {
  devices: MachineSummary[];
  unusedDevices: MachineSummary[];
}

export function splitUnused(machines: readonly MachineSummary[]): DeviceGroup {
  return {
    devices: machines.filter((machine) => !machine.unused),
    unusedDevices: machines.filter((machine) => machine.unused),
  };
}

function deviceKindLabel(device: MachineSummary): string | null {
  switch (device.kind) {
    case "desktop":
      return "Desktop app";
    case "mobile":
      return "Phone";
    case "host":
      return "Remote host";
    case null:
      return device.subdomain !== null ? "Remote host" : null;
  }
}

export function deviceTitle(device: MachineSummary): string {
  return device.name ?? deviceKindLabel(device) ?? "Unnamed device";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function usedOn(ms: number, now: number): string {
  const days = Math.max(0, Math.round((localDay(now) - localDay(ms)) / DAY_MS));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function deviceStatus(device: MachineSummary, now: number): string {
  if (device.online) return "Online";
  return device.lastSeenAt === null
    ? "Not used yet"
    : usedOn(device.lastSeenAt, now);
}

export function appStatus(grant: OAuthGrantView, now: number): string {
  return grant.lastUsedAt === null
    ? "Never used"
    : usedOn(grant.lastUsedAt, now);
}
