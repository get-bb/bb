import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { matchPath } from "react-router-dom";
import { prefetchThreadOpen } from "@/hooks/queries/thread-queries";
import { resolveRouteHref } from "@/lib/route-paths";

export const THREAD_OPEN_HOVER_INTENT_MS = 80;
const THREAD_OPEN_INTENT_DEDUPE_MS = 1_000;
const THREAD_OPEN_ROUTE_PATTERNS = [
  "/projects/:projectId/threads/:threadId",
  "/threads/:threadId",
] as const;

type PrefetchThreadOpen = (threadId: string) => void;

interface ThreadOpenIntentDeps {
  prefetch: PrefetchThreadOpen;
}

interface ThreadOpenIntent {
  commit: (threadId: string) => void;
  dispose: () => void;
  focus: (threadId: string) => void;
  hover: (threadId: string | null) => void;
}

export function resolveThreadIdFromRoutePath(path: string): string | null {
  const pathname = path.split(/[?#]/)[0] ?? path;
  for (const pattern of THREAD_OPEN_ROUTE_PATTERNS) {
    const threadId = matchPath({ path: pattern, end: false }, pathname)?.params
      .threadId;
    if (threadId) {
      return threadId;
    }
  }
  return null;
}

export function resolveThreadIdFromAnchor(
  anchor: HTMLAnchorElement,
  currentOrigin: string,
): string | null {
  const route = resolveRouteHref({
    currentOrigin,
    href: anchor.getAttribute("href") ?? "",
  });
  return route === null ? null : resolveThreadIdFromRoutePath(route.path);
}

function isSaveDataEnabled(): boolean {
  if (typeof navigator === "undefined" || !("connection" in navigator)) {
    return false;
  }
  const connection: unknown = navigator.connection;
  return (
    typeof connection === "object" &&
    connection !== null &&
    "saveData" in connection &&
    connection.saveData === true
  );
}

function createThreadOpenIntent({
  prefetch,
}: ThreadOpenIntentDeps): ThreadOpenIntent {
  let hoveredThreadId: string | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPrefetchedThreadId: string | null = null;
  let lastPrefetchedAt = 0;

  const cancelHover = () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const fire = (threadId: string, speculative: boolean) => {
    if (speculative && isSaveDataEnabled()) {
      return;
    }
    const now = Date.now();
    if (
      threadId === lastPrefetchedThreadId &&
      now - lastPrefetchedAt < THREAD_OPEN_INTENT_DEDUPE_MS
    ) {
      return;
    }
    lastPrefetchedThreadId = threadId;
    lastPrefetchedAt = now;
    prefetch(threadId);
  };

  return {
    commit: (threadId) => {
      cancelHover();
      fire(threadId, false);
    },
    dispose: () => {
      cancelHover();
      hoveredThreadId = null;
    },
    focus: (threadId) => {
      fire(threadId, true);
    },
    hover: (threadId) => {
      if (threadId === hoveredThreadId) {
        return;
      }
      cancelHover();
      hoveredThreadId = threadId;
      if (threadId === null) {
        return;
      }
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        fire(threadId, true);
      }, THREAD_OPEN_HOVER_INTENT_MS);
    },
  };
}

function anchorFromEventTarget(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  return target instanceof Element
    ? target.closest<HTMLAnchorElement>("a[href]")
    : null;
}

export function installThreadOpenIntentPrefetch(
  root: HTMLElement,
  deps: ThreadOpenIntentDeps,
): () => void {
  const intent = createThreadOpenIntent(deps);
  const threadIdForTarget = (target: EventTarget | null): string | null => {
    const anchor = anchorFromEventTarget(target);
    if (anchor === null || !root.contains(anchor)) {
      return null;
    }
    return resolveThreadIdFromAnchor(anchor, window.location.origin);
  };
  const handlePointerOver = (event: PointerEvent) => {
    intent.hover(threadIdForTarget(event.target));
  };
  const handlePointerOut = (event: PointerEvent) => {
    intent.hover(threadIdForTarget(event.relatedTarget));
  };
  const handlePointerDown = (event: PointerEvent) => {
    const threadId = threadIdForTarget(event.target);
    if (threadId !== null) {
      intent.commit(threadId);
    }
  };
  const handleFocusIn = (event: FocusEvent) => {
    const threadId = threadIdForTarget(event.target);
    if (threadId !== null) {
      intent.focus(threadId);
    }
  };
  root.addEventListener("pointerover", handlePointerOver);
  root.addEventListener("pointerout", handlePointerOut);
  root.addEventListener("pointerdown", handlePointerDown);
  root.addEventListener("focusin", handleFocusIn);
  return () => {
    root.removeEventListener("pointerover", handlePointerOver);
    root.removeEventListener("pointerout", handlePointerOut);
    root.removeEventListener("pointerdown", handlePointerDown);
    root.removeEventListener("focusin", handleFocusIn);
    intent.dispose();
  };
}

export function useThreadOpenPrefetch(): PrefetchThreadOpen | null {
  const queryClient = useContext(QueryClientContext);
  return useMemo(
    () =>
      queryClient === undefined
        ? null
        : (threadId: string) => prefetchThreadOpen(queryClient, threadId),
    [queryClient],
  );
}

export function useThreadOpenIntentPrefetchRoot(): (
  root: HTMLElement | null,
) => (() => void) | undefined {
  const prefetch = useThreadOpenPrefetch();
  return useCallback(
    (root: HTMLElement | null) => {
      if (root === null || prefetch === null) {
        return undefined;
      }
      return installThreadOpenIntentPrefetch(root, { prefetch });
    },
    [prefetch],
  );
}

export function useThreadOpenHoverIntentPrefetch(
  threadId: string | null,
): void {
  const prefetch = useThreadOpenPrefetch();
  useEffect(() => {
    if (threadId === null || prefetch === null) {
      return;
    }
    const intent = createThreadOpenIntent({ prefetch });
    intent.hover(threadId);
    return intent.dispose;
  }, [prefetch, threadId]);
}
