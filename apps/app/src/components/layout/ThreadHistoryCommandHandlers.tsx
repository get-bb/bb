import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  recordThreadVisit,
  stepThreadNavigationHistory,
  threadNavigationHistoryAtom,
} from "@/lib/thread-navigation-history";

export function ThreadHistoryCommandHandlers({
  enabled,
}: {
  enabled: boolean;
}) {
  const { projectId, threadId } = useRouteState();
  const navigate = useNavigate();
  const [history, setHistory] = useAtom(threadNavigationHistoryAtom);
  const closeOnMobile = useCloseMobileSidebar();

  useEffect(() => {
    if (projectId === undefined || threadId === undefined) return;
    setHistory((current) =>
      recordThreadVisit(current, { projectId, threadId }),
    );
  }, [projectId, setHistory, threadId]);

  const step = useCallback(
    (offset: -1 | 1): boolean => {
      const next = stepThreadNavigationHistory(history, offset);
      if (!next) return false;
      setHistory(next.history);
      closeOnMobile();
      void navigate(getThreadRoutePath(next.entry));
      return true;
    },
    [closeOnMobile, history, navigate, setHistory],
  );

  useAppCommandHandler("thread.previous", () => step(-1), 0, enabled);
  useAppCommandHandler("thread.next", () => step(1), 0, enabled);

  return null;
}
