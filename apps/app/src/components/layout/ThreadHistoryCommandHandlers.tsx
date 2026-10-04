import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChangedMessage } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadRoutePath } from "@/lib/route-paths";
import { BbHttpError } from "@/lib/sdk";
import {
  recordThreadVisit,
  removeThreadNavigationEntries,
  stepThreadNavigationHistory,
  threadNavigationHistoryAtom,
  type ThreadNavigationEntry,
  type ThreadNavigationOffset,
} from "@/lib/thread-navigation-history";
import { wsManager } from "@/lib/ws";

function isThreadKnownDeleted(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const state = queryClient.getQueryState<ThreadResponse>(
    threadQueryKey(threadId),
  );
  if (state === undefined) return false;
  if (state.data !== undefined && state.data.deletedAt !== null) return true;
  return state.error instanceof BbHttpError && state.error.status === 404;
}

function deletedEntryMatcher(
  message: ChangedMessage,
): ((entry: ThreadNavigationEntry) => boolean) | null {
  if (message.entity === "thread") {
    const deletedThreadId = message.id;
    if (
      deletedThreadId === undefined ||
      !message.changes.includes("thread-deleted")
    ) {
      return null;
    }
    return (entry) => entry.threadId === deletedThreadId;
  }
  if (message.entity === "project") {
    const deletedProjectId = message.id;
    if (
      deletedProjectId === undefined ||
      !message.changes.includes("project-deleted")
    ) {
      return null;
    }
    return (entry) => entry.projectId === deletedProjectId;
  }
  return null;
}

export function ThreadHistoryCommandHandlers() {
  const { projectId, threadId } = useRouteState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [history, setHistory] = useAtom(threadNavigationHistoryAtom);
  const closeOnMobile = useCloseMobileSidebar();

  useEffect(() => {
    if (projectId === undefined || threadId === undefined) return;
    setHistory((current) =>
      recordThreadVisit(current, { projectId, threadId }),
    );
  }, [projectId, setHistory, threadId]);

  useEffect(
    () =>
      wsManager.onChanged((message) => {
        const matches = deletedEntryMatcher(message);
        if (matches === null) return;
        setHistory((current) =>
          removeThreadNavigationEntries(current, matches),
        );
      }),
    [setHistory],
  );

  const step = useCallback(
    (offset: ThreadNavigationOffset): boolean => {
      const next = stepThreadNavigationHistory(history, offset, {
        currentThreadId: threadId,
        isAvailable: (entry) =>
          !isThreadKnownDeleted(queryClient, entry.threadId),
      });
      if (next === null) return false;
      setHistory(next.history);
      closeOnMobile();
      void navigate(getThreadRoutePath(next.entry));
      return true;
    },
    [closeOnMobile, history, navigate, queryClient, setHistory, threadId],
  );

  useAppCommandHandler("thread.back", () => step(-1));
  useAppCommandHandler("thread.forward", () => step(1));

  return null;
}
