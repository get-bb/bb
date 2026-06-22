import type { QueryClient } from "@tanstack/react-query";
import type {
  EnvironmentTerminalListResponse,
  TerminalSession,
  TerminalListResponse,
  ThreadTerminalListResponse,
} from "@bb/server-contract";
import {
  environmentTerminalsQueryKey,
  terminalsQueryKey,
  threadTerminalsQueryKey,
} from "../queries/query-keys";

interface TerminalSessionCacheArgs {
  queryClient: QueryClient;
  session: TerminalSession;
}

interface CloseTerminalSessionCacheArgs extends TerminalSessionCacheArgs {
  terminalId: string;
}

function upsertTerminalSession(
  current: TerminalListResponse | undefined,
  session: TerminalSession,
): TerminalListResponse {
  if (!current) {
    return { sessions: [session] };
  }

  const existingIndex = current.sessions.findIndex(
    (existingSession) => existingSession.id === session.id,
  );
  if (existingIndex === -1) {
    return { sessions: [...current.sessions, session] };
  }

  return {
    sessions: current.sessions.map((existingSession) =>
      existingSession.id === session.id ? session : existingSession,
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

  const sessions = current.sessions.filter((session) => {
    return session.id !== terminalId;
  });
  if (sessions.length === current.sessions.length) {
    return current;
  }

  return { sessions };
}

export function applyThreadTerminalSessionUpsert({
  queryClient,
  session,
}: TerminalSessionCacheArgs): void {
  if (session.threadId === null) {
    return;
  }
  queryClient.setQueryData<ThreadTerminalListResponse>(
    threadTerminalsQueryKey(session.threadId),
    (current) => upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: threadTerminalsQueryKey(session.threadId),
  });
}

export function applyTerminalSessionUpsert({
  queryClient,
  session,
}: TerminalSessionCacheArgs): void {
  queryClient.setQueryData<TerminalListResponse>(
    terminalsQueryKey(),
    (current) => upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: terminalsQueryKey(),
  });
}

export function applyEnvironmentTerminalSessionUpsert({
  queryClient,
  session,
}: TerminalSessionCacheArgs): void {
  if (session.threadId !== null || session.environmentId === null) {
    return;
  }
  queryClient.setQueryData<EnvironmentTerminalListResponse>(
    environmentTerminalsQueryKey(session.environmentId),
    (current) => upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: environmentTerminalsQueryKey(session.environmentId),
  });
}

export function applyEnvironmentTerminalSessionClose({
  queryClient,
  session,
  terminalId,
}: CloseTerminalSessionCacheArgs): void {
  if (session.threadId !== null || session.environmentId === null) {
    return;
  }
  queryClient.setQueryData<EnvironmentTerminalListResponse>(
    environmentTerminalsQueryKey(session.environmentId),
    (current) =>
      session.status === "exited"
        ? removeTerminalSession(current, terminalId)
        : upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: environmentTerminalsQueryKey(session.environmentId),
  });
}

export function applyTerminalSessionClose({
  queryClient,
  session,
  terminalId,
}: CloseTerminalSessionCacheArgs): void {
  queryClient.setQueryData<TerminalListResponse>(
    terminalsQueryKey(),
    (current) =>
      session.status === "exited"
        ? removeTerminalSession(current, terminalId)
        : upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: terminalsQueryKey(),
  });
}

export function applyThreadTerminalSessionClose({
  queryClient,
  session,
  terminalId,
}: CloseTerminalSessionCacheArgs): void {
  if (session.threadId === null) {
    return;
  }
  queryClient.setQueryData<ThreadTerminalListResponse>(
    threadTerminalsQueryKey(session.threadId),
    (current) =>
      session.status === "exited"
        ? removeTerminalSession(current, terminalId)
        : upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: threadTerminalsQueryKey(session.threadId),
  });
}
