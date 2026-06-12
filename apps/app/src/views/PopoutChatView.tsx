import { useCallback, useEffect, useMemo } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { BbDesktopPopoutThreadChangedPayload } from "@bb/server-contract";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { RootComposeView } from "./RootComposeView";
import ThreadDetailRoute from "./thread-detail/ThreadDetailRoute";
import { useRouteState } from "@/hooks/useRouteState";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  getBbDesktopInfo,
} from "@/lib/bb-desktop";
import {
  getPopoutRoutePath,
  getPopoutThreadRoutePath,
} from "@/lib/route-paths";

const POPOUT_QUICK_ASK_HEIGHT = 220;
const POPOUT_THREAD_HEIGHT = 620;

function focusPromptEditor(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  });
}

function isPromptEditorEmpty(): boolean {
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (editor === null) {
    return true;
  }
  return editor.innerText.trim().length === 0;
}

function PopoutQuickAskRoute() {
  const desktop = getBbDesktopInfo();
  const navigate = useNavigate();
  const handleThreadCreated = useCallback(
    (thread: ThreadRoutePathArgs) => {
      navigate(getPopoutThreadRoutePath(thread));
    },
    [navigate],
  );
  const handleEscapeEmptyPrompt = useCallback(() => {
    desktop?.popout.toggle();
  }, [desktop]);

  return (
    <>
      <div className={`${MACOS_WINDOW_DRAG_CLASS} h-5 shrink-0`} />
      <div
        className={`${MACOS_APP_REGION_NO_DRAG_CLASS} shrink-0 px-3 pb-3 pt-1`}
      >
        <RootComposeView
          surface="popout"
          onThreadCreated={handleThreadCreated}
          onEscapeEmptyPrompt={handleEscapeEmptyPrompt}
        />
      </div>
    </>
  );
}

function PopoutThreadRoute() {
  const desktop = getBbDesktopInfo();
  const navigate = useNavigate();
  const handleHide = useCallback(() => {
    desktop?.popout.toggle();
  }, [desktop]);
  const handleNewQuickThread = useCallback(() => {
    navigate(getPopoutRoutePath());
  }, [navigate]);
  const handleOpenInMain = useCallback(
    (thread: ThreadRoutePathArgs) => {
      desktop?.popout.openInMain(thread);
    },
    [desktop],
  );

  return (
    <ThreadDetailRoute
      surface="popout"
      onPopoutHide={handleHide}
      onPopoutNewQuickThread={handleNewQuickThread}
      onPopoutOpenInMain={handleOpenInMain}
    />
  );
}

export function PopoutChatView() {
  const desktop = getBbDesktopInfo();
  const popout = desktop?.popout ?? null;
  const navigate = useNavigate();
  const { projectId, threadId } = useRouteState();
  const threadState = useMemo<BbDesktopPopoutThreadChangedPayload>(() => {
    if (projectId === undefined || threadId === undefined) {
      return null;
    }
    return { projectId, threadId };
  }, [projectId, threadId]);

  useEffect(() => {
    if (popout === null) {
      return;
    }
    return popout.onThreadChanged((nextThread) => {
      navigate(
        nextThread === null
          ? getPopoutRoutePath()
          : getPopoutThreadRoutePath(nextThread),
        { replace: true },
      );
      focusPromptEditor();
    });
  }, [navigate, popout]);

  useEffect(() => {
    popout?.stateChanged(threadState);
    popout?.requestResize({
      height:
        threadState === null ? POPOUT_QUICK_ASK_HEIGHT : POPOUT_THREAD_HEIGHT,
    });
  }, [popout, threadState]);

  useEffect(() => {
    if (threadState === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (!isPromptEditorEmpty()) {
        return;
      }
      event.preventDefault();
      popout?.toggle();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [popout, threadState]);

  if (popout === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        Popout chat is only available in the desktop app.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Routes>
        <Route index element={<PopoutQuickAskRoute />} />
        <Route path="threads/:threadId" element={<PopoutThreadRoute />} />
        <Route
          path="projects/:projectId/threads/:threadId"
          element={<PopoutThreadRoute />}
        />
        <Route
          path="*"
          element={<Navigate to={getPopoutRoutePath()} replace />}
        />
      </Routes>
    </div>
  );
}
