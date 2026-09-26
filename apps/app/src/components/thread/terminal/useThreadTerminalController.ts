import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TerminalSession } from "@bb/server-contract";
import {
  useEnvironmentTerminals,
  useRenameTerminal,
  useRenameEnvironmentTerminal,
  useRenameThreadTerminal,
  useTerminals,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  useActiveFixedRightTerminalId,
  useSetFixedRightTerminalActiveTerminal,
} from "@/lib/fixed-panel-tabs";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
} from "@/hooks/cache-owners/terminal-cache-owner";
import { isVisibleTerminalSession } from "@/lib/terminal-session-visibility";
import { normalizeTerminalTitle } from "./thread-terminal-title";
import type { TerminalCreateTarget } from "@bb/server-contract";

export const DEFAULT_TERMINAL_COLS = 100;
export const DEFAULT_TERMINAL_ROWS = 30;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const TERMINAL_TITLE_RENAME_DEBOUNCE_MS = 250;

export type ThreadTerminalTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd: string | null; hostId: string };

export interface ThreadTerminalControllerArgs {
  canCreateTerminal: boolean;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
  panelStateId?: string;
  preferredTerminalId?: string;
  syncThreadId: string | null;
  fixedPanelTarget?: TerminalCreateTarget;
  fixedTerminalId?: string;
  target: ThreadTerminalTarget;
}

export interface ThreadTerminalController {
  activeSession: TerminalSession | null;
  canCreateTerminal: boolean;
  handleActiveTerminalSessionChange: (session: TerminalSession) => void;
  handleActiveTerminalTitleChange: ThreadTerminalTitleChangeHandler;
  handleSelectTerminal: ThreadTerminalIdHandler;
  hasTerminalQueryError: boolean;
  isPanelOpen: boolean;
  shouldMountTerminalView: boolean;
  terminalBodyMessage: string;
}

interface TerminalTitleRenameRequest {
  terminalId: string;
  title: string;
}

type ThreadTerminalIdHandler = (terminalId: string) => void;
type ThreadTerminalTitleChangeHandler = (title: string) => void;
type TerminalTitleRenameTimeout = number;

export function shouldMountTerminalViewForPanel({
  hasPanelOpened,
  isPanelOpen,
  isPanelPersistedOpen,
}: {
  hasPanelOpened: boolean;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
}): boolean {
  return isPanelOpen || (isPanelPersistedOpen && hasPanelOpened);
}

export function pickActiveTerminalId(
  sessions: readonly TerminalSession[],
  preferredTerminalId: string | null,
  fixedTerminalId?: string,
): string | null {
  if (fixedTerminalId !== undefined) {
    return sessions.some((session) => session.id === fixedTerminalId)
      ? fixedTerminalId
      : null;
  }
  if (
    preferredTerminalId &&
    sessions.some((session) => session.id === preferredTerminalId)
  ) {
    return preferredTerminalId;
  }
  return sessions[0]?.id ?? null;
}

export function useThreadTerminalController({
  canCreateTerminal,
  isPanelOpen,
  isPanelPersistedOpen,
  panelStateId,
  preferredTerminalId,
  syncThreadId,
  fixedPanelTarget,
  fixedTerminalId,
  target,
}: ThreadTerminalControllerArgs): ThreadTerminalController {
  const queryClient = useQueryClient();
  const terminalTargetKind = target.kind;
  const terminalTargetId =
    target.kind === "thread"
      ? target.threadId
      : target.kind === "environment"
        ? target.environmentId
        : `${target.hostId}:${target.cwd ?? "home"}`;
  const threadQueryId = target.kind === "thread" ? target.threadId : "";
  const environmentQueryId =
    target.kind === "environment" ? target.environmentId : "";
  const fixedPanelStateId = panelStateId ?? terminalTargetId;
  const activeFixedTerminalId = useActiveFixedRightTerminalId(
    fixedPanelStateId,
    syncThreadId,
  );
  const setActiveFixedTerminal = useSetFixedRightTerminalActiveTerminal(
    fixedPanelStateId,
    syncThreadId,
    fixedPanelTarget,
  );
  const latestRequestedTitleRenameRef =
    useRef<TerminalTitleRenameRequest | null>(null);
  const pendingTitleRenameTimeoutRef =
    useRef<TerminalTitleRenameTimeout | null>(null);
  const [hasPanelOpened, setHasPanelOpened] = useState(isPanelOpen);
  if (isPanelOpen && !hasPanelOpened) {
    setHasPanelOpened(true);
  } else if (!isPanelOpen && !isPanelPersistedOpen && hasPanelOpened) {
    setHasPanelOpened(false);
  }
  const shouldMountTerminalView = shouldMountTerminalViewForPanel({
    hasPanelOpened,
    isPanelOpen,
    isPanelPersistedOpen,
  });
  const threadTerminalsQuery = useThreadTerminals(threadQueryId, {
    enabled: isPanelOpen && terminalTargetKind === "thread",
  });
  const environmentTerminalsQuery = useEnvironmentTerminals(
    environmentQueryId,
    {
      enabled: isPanelOpen && terminalTargetKind === "environment",
    },
  );
  const globalTerminalsQuery = useTerminals(
    target.kind === "host_path"
      ? {
          kind: "host_path",
          hostId: target.hostId,
          ...(target.cwd === null ? {} : { cwd: target.cwd }),
        }
      : null,
    {
      enabled: isPanelOpen && terminalTargetKind === "host_path",
    },
  );
  const terminalsQuery =
    terminalTargetKind === "thread"
      ? threadTerminalsQuery
      : terminalTargetKind === "environment"
        ? environmentTerminalsQuery
        : globalTerminalsQuery;
  const renameThreadTerminal = useRenameThreadTerminal();
  const renameEnvironmentTerminal = useRenameEnvironmentTerminal();
  const renameTerminal = useRenameTerminal();
  const sessions = useMemo(() => {
    const currentSessions =
      terminalsQuery.data?.sessions ?? EMPTY_TERMINAL_SESSIONS;
    if (target.kind !== "host_path") {
      return currentSessions;
    }
    return currentSessions.filter(
      (session) =>
        session.threadId === null &&
        session.environmentId === null &&
        session.hostId === target.hostId &&
        (target.cwd === null || session.initialCwd === target.cwd),
    );
  }, [target, terminalsQuery.data?.sessions]);
  const visibleSessions = useMemo(
    () => sessions.filter(isVisibleTerminalSession),
    [sessions],
  );
  const activeTerminalId = useMemo(
    () =>
      pickActiveTerminalId(
        visibleSessions,
        preferredTerminalId ?? activeFixedTerminalId,
        fixedTerminalId,
      ),
    [
      activeFixedTerminalId,
      fixedTerminalId,
      preferredTerminalId,
      visibleSessions,
    ],
  );
  const activeSession =
    visibleSessions.find((session) => session.id === activeTerminalId) ?? null;
  useEffect(() => {
    if (!isPanelOpen || terminalsQuery.isLoading || terminalsQuery.error) {
      return;
    }
    if (
      preferredTerminalId !== undefined ||
      activeFixedTerminalId === activeTerminalId
    ) {
      return;
    }
    setActiveFixedTerminal(activeTerminalId);
  }, [
    activeFixedTerminalId,
    activeTerminalId,
    isPanelOpen,
    preferredTerminalId,
    setActiveFixedTerminal,
    terminalsQuery.error,
    terminalsQuery.isLoading,
  ]);

  useEffect(() => {
    return () => {
      if (pendingTitleRenameTimeoutRef.current === null) {
        return;
      }
      window.clearTimeout(pendingTitleRenameTimeoutRef.current);
    };
  }, []);

  const handleSelectTerminal = useCallback(
    (terminalId: string) => {
      setActiveFixedTerminal(terminalId);
    },
    [setActiveFixedTerminal],
  );

  const handleActiveTerminalSessionChange = useCallback(
    (session: TerminalSession) => {
      if (session.status === "exited") {
        applyTerminalSessionClose({
          queryClient,
          session,
          terminalId: session.id,
        });
        return;
      }
      applyTerminalSessionUpsert({ queryClient, session });
    },
    [queryClient],
  );

  const handleActiveTerminalTitleChange: ThreadTerminalTitleChangeHandler =
    useCallback(
      (title) => {
        if (!activeSession || activeSession.status !== "running") {
          return;
        }
        const normalizedTitle = normalizeTerminalTitle({ title });
        if (!normalizedTitle || normalizedTitle === activeSession.title) {
          return;
        }

        const request: TerminalTitleRenameRequest = {
          terminalId: activeSession.id,
          title: normalizedTitle,
        };
        const latestRequest = latestRequestedTitleRenameRef.current;
        if (
          latestRequest !== null &&
          latestRequest.terminalId === request.terminalId &&
          latestRequest.title === request.title
        ) {
          return;
        }

        latestRequestedTitleRenameRef.current = request;
        if (pendingTitleRenameTimeoutRef.current !== null) {
          window.clearTimeout(pendingTitleRenameTimeoutRef.current);
        }
        pendingTitleRenameTimeoutRef.current = window.setTimeout(() => {
          pendingTitleRenameTimeoutRef.current = null;
          const onSettled = () => {
            const currentRequest = latestRequestedTitleRenameRef.current;
            if (
              currentRequest !== null &&
              currentRequest.terminalId === request.terminalId &&
              currentRequest.title === request.title
            ) {
              latestRequestedTitleRenameRef.current = null;
            }
          };
          if (terminalTargetKind === "thread") {
            renameThreadTerminal.mutate(
              {
                threadId: terminalTargetId,
                terminalId: request.terminalId,
                title: request.title,
              },
              { onSettled },
            );
            return;
          }
          if (terminalTargetKind === "environment") {
            renameEnvironmentTerminal.mutate(
              {
                environmentId: terminalTargetId,
                terminalId: request.terminalId,
                title: request.title,
              },
              { onSettled },
            );
            return;
          }
          renameTerminal.mutate(
            {
              terminalId: request.terminalId,
              title: request.title,
            },
            { onSettled },
          );
        }, TERMINAL_TITLE_RENAME_DEBOUNCE_MS);
      },
      [
        activeSession,
        renameEnvironmentTerminal,
        renameTerminal,
        renameThreadTerminal,
        terminalTargetId,
        terminalTargetKind,
      ],
    );

  const terminalBodyMessage = "No terminals";

  return {
    activeSession,
    canCreateTerminal,
    handleActiveTerminalSessionChange,
    handleActiveTerminalTitleChange,
    handleSelectTerminal,
    hasTerminalQueryError: terminalsQuery.error !== null,
    isPanelOpen,
    shouldMountTerminalView,
    terminalBodyMessage,
  };
}
