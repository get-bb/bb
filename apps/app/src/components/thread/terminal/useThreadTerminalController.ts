import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TerminalSession } from "@bb/server-contract";
import { isVisibleTerminalSessionStatus } from "@bb/domain";
import {
  useCloseThreadTerminal,
  useCreateThreadTerminal,
  useRenameThreadTerminal,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  useActiveFixedRightTerminalId,
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
} from "@/lib/fixed-panel-tabs";
import { normalizeTerminalTitle } from "./thread-terminal-title";

export const DEFAULT_TERMINAL_COLS = 100;
export const DEFAULT_TERMINAL_ROWS = 30;
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const TERMINAL_TITLE_RENAME_DEBOUNCE_MS = 250;

export interface ThreadTerminalControllerArgs {
  canCreateTerminal: boolean;
  threadId: string;
}

export interface ThreadTerminalController {
  activeSession: TerminalSession | null;
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  closingTerminalId: string | null;
  emptyTerminalMessage: string;
  handleActiveTerminalTitleChange: ThreadTerminalTitleChangeHandler;
  handleActiveTerminalUserInput: ThreadTerminalActionHandler;
  handleClosePanel: ThreadTerminalActionHandler;
  handleCloseTerminal: ThreadTerminalIdHandler;
  handleCreateTerminal: ThreadTerminalActionHandler;
  handleSelectTerminal: ThreadTerminalIdHandler;
  hasTerminalQueryError: boolean;
  isCreateTerminalPending: boolean;
  isPanelOpen: boolean;
  isTerminalQueryLoading: boolean;
  showTerminalPlaceholders: boolean;
  terminalBodyMessage: string;
  threadId: string;
  visibleSessions: readonly TerminalSession[];
}

interface TerminalTitleRenameRequest {
  terminalId: string;
  title: string;
}

type ThreadTerminalActionHandler = () => void;
export type ThreadTerminalIdHandler = (terminalId: string) => void;
export type ThreadTerminalTitleChangeHandler = (title: string) => void;
type TerminalTitleRenameTimeout = number;

function isVisibleTerminalSession(session: TerminalSession): boolean {
  return isVisibleTerminalSessionStatus(session.status);
}

function pickActiveTerminalId(
  sessions: readonly TerminalSession[],
  preferredTerminalId: string | null,
): string | null {
  if (
    preferredTerminalId &&
    sessions.some((session) => session.id === preferredTerminalId)
  ) {
    return preferredTerminalId;
  }
  return sessions[0]?.id ?? null;
}

export function terminalStatusLabel(session: TerminalSession): string {
  switch (session.status) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "disconnected":
      return "disconnected";
    case "exited":
      return "exited";
  }
}

export function useThreadTerminalController({
  canCreateTerminal,
  threadId,
}: ThreadTerminalControllerArgs): ThreadTerminalController {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const isRightPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const activeFixedTerminalId = useActiveFixedRightTerminalId(threadId);
  const closeFixedSecondaryPanel = useCloseFixedSecondaryPanel(threadId);
  const setActiveFixedTerminal =
    useSetFixedRightTerminalActiveTerminal(threadId);
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(threadId);
  const dirtyTerminalIdsRef = useRef<Set<string>>(new Set());
  const closingCleanTerminalIdsRef = useRef<Set<string>>(new Set());
  const latestRequestedTitleRenameRef =
    useRef<TerminalTitleRenameRequest | null>(null);
  const pendingTitleRenameTimeoutRef =
    useRef<TerminalTitleRenameTimeout | null>(null);
  const terminalsQuery = useThreadTerminals(threadId, {
    enabled: isRightPanelOpen,
  });
  const createTerminal = useCreateThreadTerminal();
  const closeTerminal = useCloseThreadTerminal();
  const renameTerminal = useRenameThreadTerminal();
  const sessions = terminalsQuery.data?.sessions ?? EMPTY_TERMINAL_SESSIONS;
  const visibleSessions = useMemo(
    () => sessions.filter(isVisibleTerminalSession),
    [sessions],
  );
  const activeTerminalId = useMemo(
    () => pickActiveTerminalId(visibleSessions, activeFixedTerminalId),
    [activeFixedTerminalId, visibleSessions],
  );
  const activeSession =
    visibleSessions.find((session) => session.id === activeTerminalId) ?? null;

  useEffect(() => {
    if (!isRightPanelOpen || terminalsQuery.isLoading || terminalsQuery.error) {
      return;
    }
    if (activeFixedTerminalId === activeTerminalId) {
      return;
    }
    setActiveFixedTerminal(activeTerminalId);
  }, [
    activeFixedTerminalId,
    activeTerminalId,
    isRightPanelOpen,
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

  const startTerminal = useCallback(() => {
    if (!canCreateTerminal || createTerminal.isPending) {
      return;
    }
    void createTerminal
      .mutateAsync({
        threadId,
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
      })
      .then((session) => {
        setActiveFixedTerminal(session.id);
      })
      .catch(() => undefined);
  }, [canCreateTerminal, createTerminal, setActiveFixedTerminal, threadId]);

  const replaceDisconnectedTerminal = useCallback(
    (terminalId: string) => {
      if (
        !canCreateTerminal ||
        createTerminal.isPending ||
        closeTerminal.isPending
      ) {
        return;
      }
      closeTerminal.mutate(
        { mode: "force", threadId, terminalId },
        {
          onSuccess: () => {
            dirtyTerminalIdsRef.current.delete(terminalId);
            closingCleanTerminalIdsRef.current.delete(terminalId);
            removeFixedTerminalTab(terminalId);
            startTerminal();
          },
        },
      );
    },
    [
      canCreateTerminal,
      closeTerminal,
      createTerminal.isPending,
      removeFixedTerminalTab,
      startTerminal,
      threadId,
    ],
  );

  useEffect(() => {
    if (isRightPanelOpen) {
      return;
    }
    for (const session of visibleSessions) {
      if (
        session.lastUserInputAt !== null ||
        dirtyTerminalIdsRef.current.has(session.id) ||
        closingCleanTerminalIdsRef.current.has(session.id)
      ) {
        continue;
      }
      closingCleanTerminalIdsRef.current.add(session.id);
      closeTerminal.mutate(
        { mode: "if-clean", threadId, terminalId: session.id },
        {
          onSuccess: (closedSession) => {
            if (closedSession.status !== "exited") {
              return;
            }
            dirtyTerminalIdsRef.current.delete(closedSession.id);
            removeFixedTerminalTab(closedSession.id);
          },
          onSettled: () => {
            closingCleanTerminalIdsRef.current.delete(session.id);
          },
        },
      );
    }
  }, [
    closeTerminal,
    isRightPanelOpen,
    removeFixedTerminalTab,
    threadId,
    visibleSessions,
  ]);

  const handleCreateTerminal = useCallback(() => {
    if (activeSession?.status === "disconnected") {
      replaceDisconnectedTerminal(activeSession.id);
      return;
    }
    startTerminal();
  }, [activeSession, replaceDisconnectedTerminal, startTerminal]);

  const handleSelectTerminal = useCallback(
    (terminalId: string) => {
      setActiveFixedTerminal(terminalId);
    },
    [setActiveFixedTerminal],
  );

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      closeTerminal.mutate(
        { mode: "force", threadId, terminalId },
        {
          onSuccess: () => {
            dirtyTerminalIdsRef.current.delete(terminalId);
            closingCleanTerminalIdsRef.current.delete(terminalId);
            removeFixedTerminalTab(terminalId);
          },
        },
      );
    },
    [closeTerminal, removeFixedTerminalTab, threadId],
  );

  const handleActiveTerminalUserInput = useCallback(() => {
    if (!activeTerminalId) {
      return;
    }
    dirtyTerminalIdsRef.current.add(activeTerminalId);
  }, [activeTerminalId]);

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
          renameTerminal.mutate(
            {
              threadId,
              terminalId: request.terminalId,
              title: request.title,
            },
            {
              onSettled: () => {
                const currentRequest = latestRequestedTitleRenameRef.current;
                if (
                  currentRequest !== null &&
                  currentRequest.terminalId === request.terminalId &&
                  currentRequest.title === request.title
                ) {
                  latestRequestedTitleRenameRef.current = null;
                }
              },
            },
          );
        }, TERMINAL_TITLE_RENAME_DEBOUNCE_MS);
      },
      [activeSession, renameTerminal, threadId],
    );

  const handleClosePanel = useCallback(() => {
    closeFixedSecondaryPanel();
  }, [closeFixedSecondaryPanel]);

  const terminalIsReplacing =
    activeSession?.status === "disconnected" &&
    closeTerminal.isPending &&
    closeTerminal.variables?.terminalId === activeSession.id;
  const terminalIsStarting = createTerminal.isPending || terminalIsReplacing;

  const emptyTerminalMessage = terminalIsStarting
    ? "Starting terminal..."
    : "No terminals";

  const inactiveTerminalBodyMessage = canCreateTerminal
    ? "Starting terminal..."
    : "Terminals unavailable.";

  const terminalBodyMessage = terminalIsStarting
    ? inactiveTerminalBodyMessage
    : "No terminals";

  const showTerminalPlaceholders =
    terminalsQuery.isLoading ||
    (visibleSessions.length === 0 && terminalIsStarting);

  const closingTerminalId =
    closeTerminal.isPending && closeTerminal.variables
      ? closeTerminal.variables.terminalId
      : null;

  return {
    activeSession,
    activeTerminalId,
    canCreateTerminal,
    closingTerminalId,
    emptyTerminalMessage,
    handleActiveTerminalTitleChange,
    handleActiveTerminalUserInput,
    handleClosePanel,
    handleCloseTerminal,
    handleCreateTerminal,
    handleSelectTerminal,
    hasTerminalQueryError: terminalsQuery.error !== null,
    isCreateTerminalPending: createTerminal.isPending,
    isPanelOpen: isRightPanelOpen,
    isTerminalQueryLoading: terminalsQuery.isLoading,
    showTerminalPlaceholders,
    terminalBodyMessage,
    threadId,
    visibleSessions,
  };
}
