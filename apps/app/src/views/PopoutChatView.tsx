import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  POPOUT_QUICK_ASK_HEIGHT,
  POPOUT_WINDOW_HEIGHT,
  type BbDesktopPopoutThreadChangedPayload,
} from "@bb/desktop-contract";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { RootComposeView } from "./RootComposeView";
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
import {
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  HEIGHT_TRANSITION_DURATION_MS,
  HEIGHT_TRANSITION_EASE_CSS,
} from "@/components/ui/height-transition";
import { Icon } from "@/components/ui/icon";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";

const ThreadDetailRoute = lazy(
  () => import("./thread-detail/ThreadDetailRoute"),
);

const POPOUT_ROUTE_DATA_ATTRIBUTE = "data-bb-popout-route";
const POPOUT_CARD_DATA_ATTRIBUTE = "data-bb-popout-card";
const POPOUT_PORTAL_SELECTOR =
  "[data-radix-popper-content-wrapper], [data-radix-portal]";

interface PopoutShellProps {
  children: ReactNode;
  isThreadOpen: boolean;
}

interface PopoutCardStyle extends CSSProperties {
  "--popout-card-height": string;
  "--popout-card-transition-duration": string;
  "--popout-card-transition-ease": string;
}

function PopoutLoadingCard() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
      <Icon name="Spinner" className="mr-2 size-4 animate-spin" />
      Loading...
    </div>
  );
}

function isPointerOverPopoutContent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const card = document.querySelector(`[${POPOUT_CARD_DATA_ATTRIBUTE}]`);
  if (card?.contains(target) === true) {
    return true;
  }
  return target.closest(POPOUT_PORTAL_SELECTOR) !== null;
}

function hasOpenPopoutPortal(): boolean {
  return document.querySelector(POPOUT_PORTAL_SELECTOR) !== null;
}

function usePopoutRouteTransparency() {
  useEffect(() => {
    document.documentElement.setAttribute(POPOUT_ROUTE_DATA_ATTRIBUTE, "");
    document.body.setAttribute(POPOUT_ROUTE_DATA_ATTRIBUTE, "");
    return () => {
      document.documentElement.removeAttribute(POPOUT_ROUTE_DATA_ATTRIBUTE);
      document.body.removeAttribute(POPOUT_ROUTE_DATA_ATTRIBUTE);
    };
  }, []);
}

function usePopoutMousePassthrough() {
  const desktop = getBbDesktopInfo();
  const popout = desktop?.popout ?? null;
  const isIgnoringMouseEventsRef = useRef(false);
  const isPointerOverContentRef = useRef(false);
  const hasOpenPortalRef = useRef(false);

  useEffect(() => {
    if (popout === null) {
      return;
    }
    isIgnoringMouseEventsRef.current = false;
    isPointerOverContentRef.current = false;
    hasOpenPortalRef.current = hasOpenPopoutPortal();

    function setIgnored(ignore: boolean): void {
      if (isIgnoringMouseEventsRef.current === ignore) {
        return;
      }
      isIgnoringMouseEventsRef.current = ignore;
      popout?.setMouseEventsIgnored({ ignore });
    }

    function setInitialPassthroughState(): void {
      const hasOpenPortal = hasOpenPopoutPortal();
      isPointerOverContentRef.current = false;
      hasOpenPortalRef.current = hasOpenPortal;
      setIgnored(!hasOpenPortal);
    }

    function updatePortalInteractivityLock(): void {
      const hasOpenPortal = hasOpenPopoutPortal();
      if (hasOpenPortal) {
        hasOpenPortalRef.current = true;
        setIgnored(false);
        return;
      }
      if (!hasOpenPortalRef.current) {
        return;
      }
      hasOpenPortalRef.current = false;
      setIgnored(!isPointerOverContentRef.current);
    }

    function handlePointerMove(event: MouseEvent): void {
      isPointerOverContentRef.current = isPointerOverPopoutContent(
        event.target,
      );
      if (hasOpenPortalRef.current) {
        setIgnored(false);
        return;
      }
      setIgnored(!isPointerOverContentRef.current);
    }

    function handlePointerLeave(): void {
      isPointerOverContentRef.current = false;
      if (hasOpenPortalRef.current) {
        setIgnored(false);
        return;
      }
      setIgnored(true);
    }

    const mutationObserver = new MutationObserver(
      updatePortalInteractivityLock,
    );
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    setInitialPassthroughState();
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseleave", handlePointerLeave);
    window.addEventListener("focus", setInitialPassthroughState);
    return () => {
      mutationObserver.disconnect();
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("focus", setInitialPassthroughState);
      if (isIgnoringMouseEventsRef.current) {
        popout.setMouseEventsIgnored({ ignore: false });
      }
    };
  }, [popout]);
}

function PopoutShell({ children, isThreadOpen }: PopoutShellProps) {
  const cardHeight = isThreadOpen
    ? POPOUT_WINDOW_HEIGHT
    : POPOUT_QUICK_ASK_HEIGHT;
  const cardStyle: PopoutCardStyle = {
    "--popout-card-height": `${cardHeight}px`,
    "--popout-card-transition-duration": `${HEIGHT_TRANSITION_DURATION_MS}ms`,
    "--popout-card-transition-ease": HEIGHT_TRANSITION_EASE_CSS,
  };

  return (
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <div
        className="h-screen overflow-visible bg-transparent text-foreground"
        data-bb-popout-transparent-region=""
      >
        <div
          className="flex h-[var(--popout-card-height)] min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.18)] transition-[height] duration-[var(--popout-card-transition-duration)] ease-[var(--popout-card-transition-ease)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_2px_8px_rgba(0,0,0,0.4),0_16px_48px_rgba(0,0,0,0.55)]"
          data-bb-popout-card=""
          style={cardStyle}
        >
          <Suspense fallback={<PopoutLoadingCard />}>{children}</Suspense>
        </div>
      </div>
    </CompactViewportOverrideProvider>
  );
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
  useProjectListRealtimeSubscription();
  useHostListRealtimeSubscription();
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
  const navigateRef = useRef(navigate);
  const bootSyncPopoutRef = useRef(popout);
  const bootSyncStartedRef = useRef(false);
  const bootSyncCompletedRef = useRef(false);
  const [hasLoadedCurrentThread, setHasLoadedCurrentThread] = useState(false);
  const { projectId, threadId } = useRouteState();
  const threadState = useMemo<BbDesktopPopoutThreadChangedPayload>(() => {
    if (projectId === undefined || threadId === undefined) {
      return null;
    }
    return { projectId, threadId };
  }, [projectId, threadId]);
  const isThreadOpen = threadState !== null;

  usePopoutRouteTransparency();
  usePopoutMousePassthrough();

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (bootSyncPopoutRef.current !== popout) {
      bootSyncPopoutRef.current = popout;
      bootSyncStartedRef.current = false;
      bootSyncCompletedRef.current = false;
      setHasLoadedCurrentThread(false);
    }

    if (popout === null) {
      return;
    }

    let cancelled = false;
    function navigateToThread(
      nextThread: BbDesktopPopoutThreadChangedPayload,
    ): void {
      navigateRef.current(
        nextThread === null
          ? getPopoutRoutePath()
          : getPopoutThreadRoutePath(nextThread),
        { replace: true },
      );
    }
    function completeBootSync(
      nextThread: BbDesktopPopoutThreadChangedPayload,
    ): void {
      if (bootSyncCompletedRef.current) {
        return;
      }
      bootSyncCompletedRef.current = true;
      navigateToThread(nextThread);
      setHasLoadedCurrentThread(true);
    }

    const unsubscribe = popout.onThreadChanged((nextThread) => {
      navigateToThread(nextThread);
      if (!bootSyncCompletedRef.current) {
        bootSyncCompletedRef.current = true;
        setHasLoadedCurrentThread(true);
      }
    });

    if (!bootSyncStartedRef.current) {
      bootSyncStartedRef.current = true;
      void popout.getCurrentThread().then((currentThread) => {
        if (cancelled) {
          return;
        }
        completeBootSync(currentThread);
      });
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [popout]);

  useEffect(() => {
    if (!hasLoadedCurrentThread) {
      return;
    }
    popout?.stateChanged(threadState);
  }, [hasLoadedCurrentThread, popout, threadState]);

  if (popout === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        Popout chat is only available in the desktop app.
      </div>
    );
  }

  return (
    <PopoutShell isThreadOpen={isThreadOpen}>
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
    </PopoutShell>
  );
}
