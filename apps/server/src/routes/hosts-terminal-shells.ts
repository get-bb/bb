// bb-fork(windows): shells the host can launch from the Start terminal picker.
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import { assertUsableHostId } from "../services/hosts/primary-host.js";

type HostRoutes = typeof publicApiRoutes.hosts;
type HostTypedRoutes = ReturnType<typeof typedRoutes<PublicApiSchema>>;

export function registerHostTerminalShellsRoute(args: {
  deps: AppDeps;
  get: HostTypedRoutes["get"];
  route: HostRoutes["terminalShells"];
}): void {
  const { deps, get, route } = args;
  get(route, async (context) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "host.list_terminal_shells" },
    });
    return context.json(result);
  });
}
