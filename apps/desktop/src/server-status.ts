import type { BbDesktopServerStatus } from "@bb/desktop-contract";
import type { ServerProbeResult } from "./server-probe.js";
import type { DesktopServerRecord } from "./server-registry.js";

export const SERVER_STATUS_PROBE_TIMEOUT_MS = 1_500;

export function statusFromProbeResult(
  result: ServerProbeResult,
): BbDesktopServerStatus {
  if (result.kind === "compatible") {
    return "connected";
  }
  if (result.kind === "incompatible") {
    return "incompatible";
  }
  return "offline";
}

export function builtinServerStatus(args: {
  isRuntimeConnected: boolean;
  lastProbe: ServerProbeResult | null;
}): BbDesktopServerStatus {
  if (args.isRuntimeConnected) {
    return "connected";
  }
  if (args.lastProbe === null) {
    return "unknown";
  }
  return statusFromProbeResult(args.lastProbe);
}

export interface ProbeRemoteServerStatusesArgs {
  probe: (serverUrl: string) => Promise<ServerProbeResult>;
  servers: DesktopServerRecord[];
}

export async function probeRemoteServerStatuses(
  args: ProbeRemoteServerStatusesArgs,
): Promise<Map<string, BbDesktopServerStatus>> {
  const remoteServers = args.servers.filter(
    (server) => server.source !== "builtin",
  );
  const entries = await Promise.all(
    remoteServers.map(async (server) => {
      const result = await args.probe(server.url);
      return [server.id, statusFromProbeResult(result)] as const;
    }),
  );
  return new Map(entries);
}
