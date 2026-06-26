import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalSession } from "@bb/server-contract";
import {
  useCloseTerminal,
  useCloseEnvironmentTerminal,
  useCloseThreadTerminal,
  useCreateTerminal,
  useCreateEnvironmentTerminal,
  useCreateThreadTerminal,
  useEnvironmentTerminals,
  useRenameTerminal,
  useRenameEnvironmentTerminal,
  useRenameThreadTerminal,
  useTerminals,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  useActiveFixedRightTerminalId,
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
} from "@/lib/fixed-panel-tabs";
import {
  shouldCloseUnretainedDisconnectedTerminalSession,
  shouldShowRetainedTerminalSession,
} from "@/lib/terminal-session-visibility";
import { normalizeTerminalTitle } from "./thread-terminal-title";

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
  panelStateId?: string;
  target: ThreadTerminalTarget;
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
  shouldRetainActiveTerminalView: boolean;
  terminalBodyMessage: string;
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
type TerminalCloseMode = "force" | "if-clean";

export function isVisibleTerminalSession({
  retainedTerminalViewId,
  session,
}: {
  retainedTerminalViewId: string | null;
  session: TerminalSession;
}): boolean {
  return shouldShowRetainedTerminalSession({
    retainedTerminalId: retainedTerminalViewId,
    session,
  });
}

export function shouldCloseDisconnectedTerminalSession({
  retainedTerminalViewId,
  session,
}: {
  retainedTerminalViewId: string | null;
  session: TerminalSession;
}): boolean {
  return shouldCloseUnretainedDisconnectedTerminalSession({
    retainedTerminalId: retainedTerminalViewId,
    session,
  });
}

export function shouldAutoCloseCleanTerminalSession({
  dirtyTerminalIds,
  session,
  uiCreatedTerminalIds,
}: {
  dirtyTerminalIds: ReadonlySet<string>;
  session: TerminalSession;
  uiCreatedTerminalIds: ReadonlySet<string>;
}): boolean {
  return (
    session.lastUserInputAt === null &&
    uiCreatedTerminalIds.has(session.id) &&
    !dirtyTerminalIds.has(session.id)
  );
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
  panelStateId,
  target,
}: ThreadTerminalControllerArgs): ThreadTerminalController {
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
  const fixedPanelTabsState = useFixedPanelTabsState(fixedPanelStateId);
  const isRightPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const activeFixedTerminalId =
    useActiveFixedRightTerminalId(fixedPanelStateId);
  const closeFixedSecondaryPanel =
    useCloseFixedSecondaryPanel(fixedPanelStateId);
  const setActiveFixedTerminal =
    useSetFixedRightTerminalActiveTerminal(fixedPanelStateId);
  const removeFixedTerminalTab =
    useRemoveFixedRightTerminalTab(fixedPanelStateId);
  const uiCreatedTerminalIdsRef = useRef<Set<string>>(new Set());
  const dirtyTerminalIdsRef = useRef<Set<string>>(new Set());
  const closingCleanTerminalIdsRef = useRef<Set<string>>(new Set());
  const closingDisconnectedTerminalIdsRef = useRef<Set<string>>(new Set());
  const latestRequestedTitleRenameRef =
    useRef<TerminalTitleRenameRequest | null>(null);
  const pendingTitleRenameTimeoutRef =
    useRef<TerminalTitleRenameTimeout | null>(null);
  const [retainedTerminalViewId, setRetainedTerminalViewId] = useState<
    string | null
  >(null);
  const threadTerminalsQuery = useThreadTerminals(threadQueryId, {
    enabled: isRightPanelOpen && terminalTargetKind === "thread",
  });
  const environmentTerminalsQuery = useEnvironmentTerminals(
    environmentQueryId,
    {
      enabled: isRightPanelOpen && terminalTargetKind === "environment",
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
      enabled: isRightPanelOpen && terminalTargetKind === "host_path",
    },
  );
  const terminalsQuery =
    terminalTargetKind === "thread"
      ? threadTerminalsQuery
      : terminalTargetKind === "environment"
        ? environmentTerminalsQuery
        : globalTerminalsQuery;
  const createThreadTerminal = useCreateThreadTerminal();
  const createEnvironmentTerminal = useCreateEnvironmentTerminal();
  const createTerminal = useCreateTerminal();
  const closeThreadTerminal = useCloseThreadTerminal();
  const closeEnvironmentTerminal = useCloseEnvironmentTerminal();
  const closeTerminalMutation = useCloseTerminal();
  const renameThreadTerminal = useRenameThreadTerminal();
  const renameEnvironmentTerminal = useRenameEnvironmentTerminal();
  const renameTerminal = useRenameTerminal();
  const isCreateTerminalPending =
    terminalTargetKind === "thread"
      ? createThreadTerminal.isPending
      : terminalTargetKind === "environment"
        ? createEnvironmentTerminal.isPending
        : createTerminal.isPending;
  const isCloseTerminalPending =
    terminalTargetKind === "thread"
      ? closeThreadTerminal.isPending
      : terminalTargetKind === "environment"
        ? closeEnvironmentTerminal.isPending
        : closeTerminalMutation.isPending;
  const closingTerminalVariables =
    terminalTargetKind === "thread"
      ? closeThreadTerminal.variables
      : terminalTargetKind === "environment"
        ? closeEnvironmentTerminal.variables
        : closeTerminalMutation.variables;
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
    () =>
      sessions.filter((session) =>
        isVisibleTerminalSession({ retainedTerminalViewId, session }),
      ),
    [retainedTerminalViewId, sessions],
  );
  const activeTerminalId = useMemo(
    () => pickActiveTerminalId(visibleSessions, activeFixedTerminalId),
    [activeFixedTerminalId, visibleSessions],
  );
  const activeSession =
    visibleSessions.find((session) => session.id === activeTerminalId) ?? null;
  const shouldRetainActiveTerminalView =
    activeSession?.status === "disconnected" &&
    activeSession.id === retainedTerminalViewId;

  useEffect(() => {
    if (!isRightPanelOpen) {
      setRetainedTerminalViewId(null);
      return;
    }
    if (activeSession?.status === "running") {
      setRetainedTerminalViewId(activeSession.id);
      return;
    }
    if (
      retainedTerminalViewId !== null &&
      activeTerminalId !== retainedTerminalViewId
    ) {
      setRetainedTerminalViewId(null);
    }
  }, [
    activeSession?.id,
    activeSession?.status,
    activeTerminalId,
    isRightPanelOpen,
    retainedTerminalViewId,
  ]);

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
    if (!canCreateTerminal || isCreateTerminalPending) {
      return;
    }
    const request = {
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
    };
    const created =
      target.kind === "thread"
        ? createThreadTerminal.mutateAsync({
            ...request,
            threadId: target.threadId,
          })
        : target.kind === "environment"
          ? createEnvironmentTerminal.mutateAsync({
              ...request,
              environmentId: target.environmentId,
            })
          : createTerminal.mutateAsync({
              ...request,
              target: {
                kind: "host_path",
                hostId: target.hostId,
                cwd: target.cwd,
              },
            });
    void created
      .then((session) => {
        uiCreatedTerminalIdsRef.current.add(session.id);
        setActiveFixedTerminal(session.id);
      })
      .catch(() => undefined);
  }, [
    canCreateTerminal,
    createTerminal,
    createEnvironmentTerminal,
    createThreadTerminal,
    isCreateTerminalPending,
    setActiveFixedTerminal,
    target,
  ]);

  const closeTerminal = useCallback(
    ({
      mode,
      onSettled,
      onSuccess,
      terminalId,
    }: {
      mode: TerminalCloseMode;
      onSettled?: () => void;
      onSuccess?: (session: TerminalSession) => void;
      terminalId: string;
    }) => {
      const options = {
        onSettled: () => {
          onSettled?.();
        },
        onSuccess,
      };
      if (terminalTargetKind === "thread") {
        closeThreadTerminal.mutate(
          { mode, threadId: terminalTargetId, terminalId },
          options,
        );
        return;
      }
      if (terminalTargetKind === "environment") {
        closeEnvironmentTerminal.mutate(
          { mode, environmentId: terminalTargetId, terminalId },
          options,
        );
        return;
      }
      closeTerminalMutation.mutate({ mode, terminalId }, options);
    },
    [
      closeEnvironmentTerminal,
      closeTerminalMutation,
      closeThreadTerminal,
      terminalTargetId,
      terminalTargetKind,
    ],
  );

  useEffect(() => {
    if (!isRightPanelOpen || terminalsQuery.isLoading || terminalsQuery.error) {
      return;
    }
    for (const session of sessions) {
      if (
        !shouldCloseDisconnectedTerminalSession({
          retainedTerminalViewId,
          session,
        }) ||
        closingDisconnectedTerminalIdsRef.current.has(session.id)
      ) {
        continue;
      }
      closingDisconnectedTerminalIdsRef.current.add(session.id);
      closeTerminal({
        mode: "force",
        terminalId: session.id,
        onSuccess: (closedSession) => {
          if (closedSession.status !== "exited") {
            return;
          }
          uiCreatedTerminalIdsRef.current.delete(closedSession.id);
          dirtyTerminalIdsRef.current.delete(closedSession.id);
          closingCleanTerminalIdsRef.current.delete(closedSession.id);
          removeFixedTerminalTab(closedSession.id);
        },
        onSettled: () => {
          closingDisconnectedTerminalIdsRef.current.delete(session.id);
        },
      });
    }
  }, [
    closeTerminal,
    isRightPanelOpen,
    removeFixedTerminalTab,
    retainedTerminalViewId,
    sessions,
    terminalsQuery.error,
    terminalsQuery.isLoading,
  ]);

  const replaceDisconnectedTerminal = useCallback(
    (terminalId: string) => {
      if (
        !canCreateTerminal ||
        isCreateTerminalPending ||
        isCloseTerminalPending
      ) {
        return;
      }
      closeTerminal({
        mode: "force",
        terminalId,
        onSuccess: () => {
          uiCreatedTerminalIdsRef.current.delete(terminalId);
          dirtyTerminalIdsRef.current.delete(terminalId);
          closingCleanTerminalIdsRef.current.delete(terminalId);
          removeFixedTerminalTab(terminalId);
          startTerminal();
        },
      });
    },
    [
      canCreateTerminal,
      closeTerminal,
      isCloseTerminalPending,
      isCreateTerminalPending,
      removeFixedTerminalTab,
      startTerminal,
    ],
  );

  useEffect(() => {
    if (isRightPanelOpen) {
      return;
    }
    for (const session of visibleSessions) {
      if (
        !shouldAutoCloseCleanTerminalSession({
          dirtyTerminalIds: dirtyTerminalIdsRef.current,
          session,
          uiCreatedTerminalIds: uiCreatedTerminalIdsRef.current,
        }) ||
        closingCleanTerminalIdsRef.current.has(session.id)
      ) {
        continue;
      }
      closingCleanTerminalIdsRef.current.add(session.id);
      closeTerminal({
        mode: "if-clean",
        terminalId: session.id,
        onSuccess: (closedSession) => {
          if (closedSession.status !== "exited") {
            return;
          }
          uiCreatedTerminalIdsRef.current.delete(closedSession.id);
          dirtyTerminalIdsRef.current.delete(closedSession.id);
          removeFixedTerminalTab(closedSession.id);
        },
        onSettled: () => {
          closingCleanTerminalIdsRef.current.delete(session.id);
        },
      });
    }
  }, [
    closeTerminal,
    isRightPanelOpen,
    removeFixedTerminalTab,
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
      closeTerminal({
        mode: "force",
        terminalId,
        onSuccess: () => {
          uiCreatedTerminalIdsRef.current.delete(terminalId);
          dirtyTerminalIdsRef.current.delete(terminalId);
          closingCleanTerminalIdsRef.current.delete(terminalId);
          removeFixedTerminalTab(terminalId);
        },
      });
    },
    [closeTerminal, removeFixedTerminalTab],
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

  const handleClosePanel = useCallback(() => {
    closeFixedSecondaryPanel();
  }, [closeFixedSecondaryPanel]);

  const terminalIsReplacing =
    activeSession?.status === "disconnected" &&
    isCloseTerminalPending &&
    closingTerminalVariables?.terminalId === activeSession.id;
  const terminalIsStarting = isCreateTerminalPending || terminalIsReplacing;

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
    isCloseTerminalPending && closingTerminalVariables
      ? closingTerminalVariables.terminalId
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
    isCreateTerminalPending,
    isPanelOpen: isRightPanelOpen,
    isTerminalQueryLoading: terminalsQuery.isLoading,
    showTerminalPlaceholders,
    shouldRetainActiveTerminalView,
    terminalBodyMessage,
    visibleSessions,
  };
}
