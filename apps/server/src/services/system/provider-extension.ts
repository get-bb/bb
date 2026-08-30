import type { JsonValue } from "@bb/domain";
import type { SystemProviderExtensionRequest } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { ServerAppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requireBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

const PROVIDER_EXTENSION_TIMEOUT_MS = 10 * COMMAND_TIMEOUT_MS;
const PROVIDER_EXTENSION_OPERATION_TIMEOUT_MS =
  PROVIDER_EXTENSION_TIMEOUT_MS - COMMAND_TIMEOUT_MS;

export async function callProviderExtension(
  deps: ServerAppDeps,
  providerId: string,
  request: SystemProviderExtensionRequest,
): Promise<JsonValue> {
  const hostId = resolveSystemLookupHostId(deps, request);
  return callHostOnlineRpc(deps, {
    command: {
      type: "provider.extension",
      providerId,
      bridgeLaunch: requireBridgeLaunchForProviderId(deps, providerId),
      cwd: request.cwd,
      method: request.method,
      params: request.params,
      timeoutMs: PROVIDER_EXTENSION_OPERATION_TIMEOUT_MS,
    },
    hostId,
    timeoutMs: PROVIDER_EXTENSION_TIMEOUT_MS,
  });
}
