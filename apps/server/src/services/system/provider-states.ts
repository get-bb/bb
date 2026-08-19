import type {
  SystemProviderState,
  SystemProviderStatesResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import type { ProviderInfo } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import { resolveAcpLaunchSpecForProviderId } from "./acp-launch-spec.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";

function unknownProviderState(
  provider: ProviderInfo,
  statusMessage: string,
): SystemProviderState {
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    status: "unknown",
    statusMessage,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
  };
}

async function getProviderState(
  deps: AppDeps,
  args: { cwd?: string; hostId: string; provider: ProviderInfo },
): Promise<SystemProviderState> {
  const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, args.provider.id);
  if (bridgeLaunch === null) {
    return unknownProviderState(
      args.provider,
      "The provider bridge is unavailable.",
    );
  }
  const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
    deps,
    args.provider.id,
  );

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.health",
        providerId: args.provider.id,
        bridgeLaunch,
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        ...(acpLaunchSpec === undefined ? {} : { acpLaunchSpec }),
      },
    });
    if (!result.supported) {
      return unknownProviderState(
        args.provider,
        "This provider does not report readiness.",
      );
    }
    return {
      providerId: args.provider.id,
      displayName: args.provider.displayName,
      ...result.health,
    };
  } catch {
    // One broken bridge must not hide every other provider or strand the root
    // composer. Unknown is an explicit state; callers can still fall back to
    // the registry's normal default-selection policy.
    return unknownProviderState(
      args.provider,
      "Provider readiness could not be checked.",
    );
  }
}

/**
 * Resolve every provider's host-local readiness through its own bridge.
 * Provider registry order is preserved because it is also the picker/default
 * order used by the rest of the product.
 */
export async function getProviderStates(
  deps: AppDeps,
  query: SystemProvidersQuery,
): Promise<SystemProviderStatesResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const cwd =
    query.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, query.environmentId).path ?? undefined);
  const providers = await listSystemProviderInfos(deps, { hostId });
  return {
    providers: await Promise.all(
      providers.map((provider) =>
        getProviderState(deps, {
          hostId,
          provider,
          ...(cwd === undefined ? {} : { cwd }),
        }),
      ),
    ),
  };
}
