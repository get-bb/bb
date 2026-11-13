import type {
  HostDaemonBridgeLaunch,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";

export type ProviderHealthResult = HostDaemonOnlineRpcResult<"provider.health">;

interface ProviderHealthRequestArgs {
  cwd?: string;
  hostId: string;
  providerId: string;
}

const inFlightByRegistry = new WeakMap<
  ProviderRegistryService,
  Map<string, Promise<ProviderHealthResult>>
>();

function inFlightRequests(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
): Map<string, Promise<ProviderHealthResult>> {
  let requests = inFlightByRegistry.get(deps.providerRegistry);
  if (requests === undefined) {
    requests = new Map();
    inFlightByRegistry.set(deps.providerRegistry, requests);
  }
  return requests;
}

function requestKey(args: ProviderHealthRequestArgs): string {
  return JSON.stringify([args.hostId, args.providerId, args.cwd ?? null]);
}

export function findProviderHealthRequest(
  deps: Pick<LoggedWorkSessionDeps, "providerRegistry">,
  args: ProviderHealthRequestArgs,
): Promise<ProviderHealthResult> | undefined {
  return inFlightRequests(deps).get(requestKey(args));
}

export function requestProviderHealth(
  deps: LoggedWorkSessionDeps,
  args: ProviderHealthRequestArgs & {
    bridgeLaunch: HostDaemonBridgeLaunch;
    timeoutMs: number;
  },
): Promise<ProviderHealthResult> {
  const requests = inFlightRequests(deps);
  const key = requestKey(args);
  const existing = requests.get(key);
  if (existing !== undefined) return existing;
  const request = callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: args.timeoutMs,
    command: {
      type: "provider.health",
      providerId: args.providerId,
      bridgeLaunch: args.bridgeLaunch,
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    },
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}
