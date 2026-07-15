import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import type { SystemUsageLimitsQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";

/**
 * Reads live Codex, Claude Code, and Cursor subscription usage from a connected
 * host's daemon. The daemon owns the credentials and provider HTTP calls; the
 * server only validates and routes the selected machine.
 */
export async function getProviderUsageLimits(
  deps: AppDeps,
  query: SystemUsageLimitsQuery,
): Promise<ProviderUsageResponse> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "provider.usage" },
  });
}
