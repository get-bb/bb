// bb-fork(windows): shells a machine offers the Start terminal picker.
import { useQuery } from "@tanstack/react-query";
import type { TerminalShellOption } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { terminalShellsQueryKey } from "./query-keys";
import { requireEnabledQueryArg, type QueryOptions } from "./query-helpers";

const TERMINAL_SHELLS_STALE_TIME_MS = 60_000;

export function useTerminalShells(
  hostId: string | null,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && hostId !== null;
  return useQuery<TerminalShellOption[]>({
    queryKey: terminalShellsQueryKey(hostId),
    queryFn: async ({ signal }) => {
      const response = await sdk.hosts.listTerminalShells({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useTerminalShells",
          argName: "host id",
        }),
        signal,
      });
      return response.shells;
    },
    enabled,
    staleTime: TERMINAL_SHELLS_STALE_TIME_MS,
  });
}
