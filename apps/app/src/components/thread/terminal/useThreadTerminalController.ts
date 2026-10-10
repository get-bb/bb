import { useCallback, useEffect, useRef, useState } from "react";
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

interface TerminalPanelVisibility {
  hasPanelOpened: boolean;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
}

export function resolveTerminalPanelMount({
  hasPanelOpened,
  isPanelOpen,
  isPanelPersistedOpen,
}: TerminalPanelVisibility): {
  hasPanelOpened: boolean;
  shouldFetchTerminals: boolean;
  shouldMountTerminalView: boolean;
} {
  const nextHasPanelOpened = isPanelOpen
    ? true
    : isPanelPersistedOpen && hasPanelOpened;
  return {
    hasPanelOpened: nextHasPanelOpened,
    shouldFetchTerminals: isPanelOpen,
    shouldMountTerminalView:
      isPanelOpen || (isPanelPersistedOpen && nextHasPanelOpened),
  };
}

export function selectActiveTerminalSession({
  sessions,
  target,
  terminalId,
}: {
  sessions: readonly TerminalSession[];
  target: TerminalCreateTarget;
  terminalId: string;
}): TerminalSession | null {
  return (
    sessions.find(
      (session) =>
        session.id === terminalId &&
        isVisibleTerminalSession(session) &&
        (target.kind !== "host_path" ||
          (session.threadId === null &&
            session.environmentId === null &&
            session.hostId === target.hostId &&
            (target.cwd === null || session.initialCwd === target.cwd))),
    ) ?? null
  );
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
  const panelMount = resolveTerminalPanelMount({
    hasPanelOpened,
    isPanelOpen,
    isPanelPersistedOpen,
  });
  if (panelMount.hasPanelOpened !== hasPanelOpened) {
    setHasPanelOpened(panelMount.hasPanelOpened);
  }
  const { shouldMountTerminalView } = panelMount;
  const terminalsQuery = useTerminals(terminalQueryScopeForTarget(target), {
    enabled: panelMount.shouldFetchTerminals,
  });
  const renameTerminal = useRenameTerminal();
  const activeSession = selectActiveTerminalSession({
    sessions: terminalsQuery.data?.sessions ?? EMPTY_TERMINAL_SESSIONS,
    target,
    terminalId,
  });

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
