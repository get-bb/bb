import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  TerminalCreateTarget,
  TerminalSession,
} from "@bb/server-contract";
import {
  terminalQueryScopeForTarget,
  useRenameTerminal,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
} from "@/hooks/cache-owners/terminal-cache-owner";
import { isVisibleTerminalSession } from "@/lib/terminal-session-visibility";
import { normalizeTerminalTitle } from "./thread-terminal-title";

export const DEFAULT_TERMINAL_COLS = 100;
export const DEFAULT_TERMINAL_ROWS = 30;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const TERMINAL_TITLE_RENAME_DEBOUNCE_MS = 250;

export interface ThreadTerminalControllerArgs {
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
  terminalId: string;
  target: TerminalCreateTarget;
}

export interface ThreadTerminalController {
  activeSession: TerminalSession | null;
  handleActiveTerminalSessionChange: (session: TerminalSession) => void;
  handleActiveTerminalTitleChange: ThreadTerminalTitleChangeHandler;
  hasTerminalQueryError: boolean;
  isPanelOpen: boolean;
  shouldMountTerminalView: boolean;
  terminalBodyMessage: string;
}

interface TerminalTitleRenameRequest {
  terminalId: string;
  title: string;
}

type ThreadTerminalTitleChangeHandler = (title: string) => void;
type TerminalTitleRenameTimeout = number;

function shouldMountTerminalViewForPanel({
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

export function useThreadTerminalController({
  isPanelOpen,
  isPanelPersistedOpen,
  terminalId,
  target,
}: ThreadTerminalControllerArgs): ThreadTerminalController {
  const queryClient = useQueryClient();
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
  const terminalsQuery = useTerminals(terminalQueryScopeForTarget(target), {
    enabled: isPanelOpen,
  });
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
  const activeSession =
    visibleSessions.find((session) => session.id === terminalId) ?? null;

  useEffect(() => {
    return () => {
      if (pendingTitleRenameTimeoutRef.current === null) {
        return;
      }
      window.clearTimeout(pendingTitleRenameTimeoutRef.current);
    };
  }, []);

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
          renameTerminal.mutate(
            {
              terminalId: request.terminalId,
              title: request.title,
            },
            { onSettled },
          );
        }, TERMINAL_TITLE_RENAME_DEBOUNCE_MS);
      },
      [activeSession, renameTerminal],
    );

  const terminalBodyMessage = "No terminals";

  return {
    activeSession,
    handleActiveTerminalSessionChange,
    handleActiveTerminalTitleChange,
    hasTerminalQueryError:
      terminalsQuery.error !== null && terminalsQuery.data === undefined,
    isPanelOpen,
    shouldMountTerminalView,
    terminalBodyMessage,
  };
}
