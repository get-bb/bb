import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";

/**
 * Reads live Codex/Claude Code subscription usage from the connected primary
 * host's daemon. The daemon owns the credentials and provider HTTP calls; the
 * server only routes the request so the browser never needs to reach the
 * loopback-bound daemon directly (which fails for non-localhost app origins).
 */
export async function getProviderUsageLimits(
  deps: AppDeps,
): Promise<ProviderUsageResponse> {
  const hostId = requireConnectedPrimaryHostId(deps);
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "provider.usage" },
  });
}
