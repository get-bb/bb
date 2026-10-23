import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

export function discoverEnvironmentWorkspace(
  deps: AppDeps,
  environment: { hostId: string; path: string },
) {
  return callHostRetryableOnlineRpc(deps, {
    hostId: environment.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.describe_workspace", path: environment.path },
  });
}
