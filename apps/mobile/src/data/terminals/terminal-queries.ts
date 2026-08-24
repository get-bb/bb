import type {
  TerminalListResponse,
  TerminalOutputResponse,
  TerminalSession,
} from "@bb/server-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  allTerminalsQueryKeyPrefix,
  terminalSessionQueryKey,
  terminalsQueryKey,
  type TerminalQueryScope,
} from "@/lib/query/query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "../shared/query-policies";
import { useThreadDetailRealtimeSubscription } from "../shared/use-realtime-subscription";

/**
 * Terminal reads (mirror of apps/app/src/hooks/queries/thread-terminal-queries.ts).
 * Realtime owns freshness: the thread's `terminals-changed` invalidates the
 * lists, and the attached socket's `attached` / `session-updated` / `exited`
 * messages are written into the cache by the terminal view
 * (`applyTerminalSessionUpsert`).
 */

const EMPTY_SESSIONS: readonly TerminalSession[] = [];
const DISABLED_SCOPE: TerminalQueryScope = {
  kind: "host_path",
  hostId: "__disabled__",
};

/** `GET /terminals?…` for one scope; `null` disables the query. */
export function useTerminals(scope: TerminalQueryScope | null) {
  const { sdk } = useProfileClient();
  const enabled = scope !== null;
  // `terminals-changed` rides the thread-detail subscription.
  useThreadDetailRealtimeSubscription(
    scope?.kind === "thread" ? scope.threadId : null,
    { enabled },
  );
  return useQuery<TerminalListResponse>({
    queryKey: terminalsQueryKey(scope ?? DISABLED_SCOPE),
    queryFn: ({ signal }) => {
      if (scope === null) {
        throw new Error(
          "useTerminals: scope is required when query is enabled",
        );
      }
      return sdk.terminals.list({ scope, signal });
    },
    enabled,
    refetchOnWindowFocus: false,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  });
}

/** The sessions of a terminal list query (stable empty list). */
export function getTerminalSessions(
  data: TerminalListResponse | undefined,
): readonly TerminalSession[] {
  return data?.sessions ?? EMPTY_SESSIONS;
}

/**
 * `GET /terminals/:id`: one session record (the full-screen route and the
 * panel tab only carry the id). Seeded from any cached list.
 */
export function useTerminalSession(terminalId: string | null | undefined) {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const enabled = Boolean(terminalId);
  return useQuery<TerminalSession>({
    queryKey: terminalSessionQueryKey(terminalId ?? ""),
    queryFn: ({ signal }) => {
      if (!terminalId) {
        throw new Error(
          "useTerminalSession: terminalId is required when query is enabled",
        );
      }
      return sdk.terminals.get({ terminalId, signal });
    },
    enabled,
    initialData: () => {
      if (!terminalId) return undefined;
      const lists = queryClient.getQueriesData<TerminalListResponse>({
        queryKey: allTerminalsQueryKeyPrefix(),
      });
      for (const [, list] of lists) {
        const match = list?.sessions.find(
          (session) => session.id === terminalId,
        );
        if (match) return match;
      }
      return undefined;
    },
    refetchOnWindowFocus: false,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  });
}

export interface FetchTerminalOutputArgs {
  terminalId: string;
  sinceSeq: number;
  signal?: AbortSignal;
}

export type FetchTerminalOutput = (
  args: FetchTerminalOutputArgs,
) => Promise<TerminalOutputResponse>;

/**
 * `GET /terminals/:id/output?sinceSeq=`: the scrollback fallback the attach
 * stream uses to fill a replay gap after the app resumes (the socket replay
 * is capped at 512 KiB; the daemon keeps 4 MiB).
 */
export function useFetchTerminalOutput(): FetchTerminalOutput {
  const { sdk } = useProfileClient();
  return useCallback<FetchTerminalOutput>(
    ({ terminalId, sinceSeq, signal }) =>
      sdk.terminals.output({ terminalId, sinceSeq, signal }),
    [sdk],
  );
}
