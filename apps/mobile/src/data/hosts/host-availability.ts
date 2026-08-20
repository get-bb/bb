import type { Host } from "@bb/domain";
import { selectPrimaryHost } from "./select-primary-host";

/**
 * Whether the screens that talk to a machine's daemon (usage limits,
 * provider CLIs, CLI skills) can work right now: a primary host must exist
 * and be online. `loading` until the host list and config have answered.
 */
export type HostDependentAvailability =
  | { state: "loading"; host: null }
  | { state: "no-host"; host: null }
  | { state: "offline"; host: Host }
  | { state: "ready"; host: Host };

export function resolveHostDependentAvailability(args: {
  hosts: readonly Host[] | undefined;
  primaryHostId: string | null | undefined;
}): HostDependentAvailability {
  if (args.hosts === undefined || args.primaryHostId === undefined) {
    return { state: "loading", host: null };
  }
  const host = selectPrimaryHost(args.hosts, args.primaryHostId);
  if (host === null) return { state: "no-host", host: null };
  if (host.status !== "connected") return { state: "offline", host };
  return { state: "ready", host };
}
