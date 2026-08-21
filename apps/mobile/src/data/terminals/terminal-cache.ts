import type {
  TerminalListResponse,
  TerminalSession,
} from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import {
  allTerminalsQueryKeyPrefix,
  terminalSessionQueryKey,
  terminalsQueryKey,
  type TerminalQueryScope,
} from "@/lib/query/query-keys";

/**
 * Terminal list / session cache writes (mirror of
 * apps/app/src/hooks/cache-owners/terminal-cache-owner.ts). Sessions stream
 * their own updates over the attach socket (`attached` / `session-updated` /
 * `exited`), so the terminal view writes them here first and the
 * `terminals-changed` refetch confirms.
 */

function upsertTerminalSession(
  current: TerminalListResponse | undefined,
  session: TerminalSession,
): TerminalListResponse {
  if (!current) {
    return { sessions: [session] };
  }
  const index = current.sessions.findIndex(
    (existing) => existing.id === session.id,
  );
  if (index === -1) {
    return { sessions: [...current.sessions, session] };
  }
  return {
    sessions: current.sessions.map((existing) =>
      existing.id === session.id ? session : existing,
    ),
  };
}

function removeTerminalSession(
  current: TerminalListResponse | undefined,
  terminalId: string,
): TerminalListResponse | undefined {
  if (!current) {
    return current;
  }
  const sessions = current.sessions.filter(
    (session) => session.id !== terminalId,
  );
  return sessions.length === current.sessions.length ? current : { sessions };
}

/** Every list a session belongs to (a host list exists with and without cwd). */
export function terminalScopesForSession(
  session: TerminalSession,
): TerminalQueryScope[] {
  if (session.threadId !== null) {
    return [{ kind: "thread", threadId: session.threadId }];
  }
  if (session.environmentId !== null) {
    return [{ kind: "environment", environmentId: session.environmentId }];
  }
  return [
    { kind: "host_path", hostId: session.hostId },
    { kind: "host_path", hostId: session.hostId, cwd: session.initialCwd },
  ];
}

export function applyTerminalSessionUpsert(
  queryClient: QueryClient,
  session: TerminalSession,
): void {
  queryClient.setQueryData<TerminalSession>(
    terminalSessionQueryKey(session.id),
    session,
  );
  for (const scope of terminalScopesForSession(session)) {
    queryClient.setQueryData<TerminalListResponse>(
      terminalsQueryKey(scope),
      (current) => upsertTerminalSession(current, session),
    );
  }
  void queryClient.invalidateQueries({
    queryKey: allTerminalsQueryKeyPrefix(),
  });
}

/** An exited session leaves the lists; anything else is an upsert. */
export function applyTerminalSessionClose(
  queryClient: QueryClient,
  session: TerminalSession,
): void {
  queryClient.setQueryData<TerminalSession>(
    terminalSessionQueryKey(session.id),
    session,
  );
  for (const scope of terminalScopesForSession(session)) {
    queryClient.setQueryData<TerminalListResponse>(
      terminalsQueryKey(scope),
      (current) =>
        session.status === "exited"
          ? removeTerminalSession(current, session.id)
          : upsertTerminalSession(current, session),
    );
  }
  void queryClient.invalidateQueries({
    queryKey: allTerminalsQueryKeyPrefix(),
  });
}
