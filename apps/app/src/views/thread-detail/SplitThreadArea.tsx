import { cn } from "@bb/shared-ui/lib/utils";
import { PANE_FOCUS_APP_COMMAND_IDS } from "@bb/domain";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router-dom";
import { useRouteState } from "@/hooks/useRouteState";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useIsMutating } from "@tanstack/react-query";
import { BbHttpError } from "@/lib/sdk";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useSplitWorkspaceActive } from "@/hooks/useSplitWorkspaceActive";
import {
  dimInactiveSplitsAtom,
  maximizedPaneIdAtom,
  splitLayoutAtom,
} from "@/lib/split-layout/atoms";
import {
  clampSplitPairFraction,
  computePaneRects,
  countPanes,
  findPane,
  listPanes,
  movePane,
  removePane,
  replacePaneContent,
  resizeSplit,
  setFocus,
  swapPanes,
} from "@/lib/split-layout";
import type {
  LayoutNode,
  PaneContent,
  PaneNode,
  SplitLayout,
  SplitPath,
  SplitSide,
} from "@/lib/split-layout";
import {
  beginSplitDrag,
  decidePaneDrop,
  SPLIT_PANE_DATA_ATTR,
} from "@/lib/split-drag";
import {
  useAppCommandContext,
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import {
  PaneContext,
  createPaneSecondaryPanelRegistry,
  useOptionalPaneContext,
  type PaneContextValue,
  type PaneSecondaryPanelRegistration,
  type PaneSecondaryPanelRegistry,
} from "./PaneContext";
// ThreadDetailView stays a static import even though it is the largest pane
// view. Wrapping it in React.lazy does not just add a request: the Suspense
// retry mounts the pane at transition priority, slicing the mount across
// thousands of scheduler tasks. Measured on the production build, the first
// thread opened in a session took 469 ms lazy versus 242 ms static (−48%),
// and prefetching the chunk during idle recovered only ~7 ms — the cost is
// the suspend, not the bytes. The tradeoff is that a session which never
// opens a thread still downloads and parses this view (~899 KB raw) as part
// of the workspace route chunk.
import { ThreadDetailView } from "./ThreadDetailView";
import { RootComposeView } from "@/views/RootComposeView";
import { PluginPanelView } from "@/views/PluginPanelView";
import {
  AppPageHeader,
  HEADER_ICON_BUTTON_CLASS,
  HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
} from "@/components/layout/AppPageHeader";
import { AppBreadcrumbs } from "@/components/layout/AppBreadcrumbs";
import { resourceRouteLabelAtom } from "@/components/layout/resourceRouteLabelAtom";
import { resolveAutomationBreadcrumbs } from "@/components/tools/tools-navigation";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import {
  getAdjacentPaneId,
  getPaneIdAtReadingIndex,
} from "./splitPaneCommands";
import {
  applyThreadPaneActionToLayout,
  createSinglePaneLayout,
  focusedPaneRoute,
  paneContentRoute,
  reconcileLayoutForContent,
  threadPaneContent,
} from "./splitThreadNavigation";
import { ThreadDetailWorkerPoolProvider } from "./ThreadDetailWorkerPoolProvider";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { SplitWorkspaceSecondaryPanelHost } from "./SplitWorkspaceSecondaryPanelHost";
import { SecondaryPanelHostLayoutContext } from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import {
  CONTEXT_INACTIVE_TEXT_CLASS,
  CONTEXT_SELECTION_SURFACE_CLASS,
} from "@/components/ui/context-selection";
import { PaneMaximizeButton } from "./PaneMaximizeButton";
import { wsManager } from "@/lib/ws";

const LazyPluginPanelRightPanelHost = lazy(() =>
  import("@/components/plugin/PluginPanelRightPanelHost").then(
    ({ PluginPanelRightPanelHost }) => ({ default: PluginPanelRightPanelHost }),
  ),
);

function PluginPagePanelHost({
  children,
  ...props
}: {
  children: ReactNode;
  flushPageInsets?: boolean;
  paneId?: string;
  panelPath: string;
  pluginId: string;
  subPath: string;
}) {
  return (
    <Suspense fallback={null}>
      <LazyPluginPanelRightPanelHost {...props}>
        {children}
      </LazyPluginPanelRightPanelHost>
    </Suspense>
  );
}

// A `pointerdown`-relative move threshold before a pane-header drag engages.
const PANE_DRAG_ENGAGE_DISTANCE_PX = 7;

type BeginPaneDrag = (
  paneId: string,
  event: ReactPointerEvent,
  label: string,
) => void;

const EMPTY_PATH: SplitPath = [];

type NavigateInPane = (paneId: string, thread: ThreadRoutePathArgs) => void;

/**
 * Renders the 1–8 thread panes that live in the main content area. It bridges
 * the URL-follows-focus and external-navigation policies between the global
 * split-layout atom and the route, then recursively draws the layout tree.
 * A single pane renders identically to the pre-split page surface (no wrapper,
 * no focus ring); compact viewports disable splits entirely.
 */
interface SplitThreadAreaProps {
  routeContent?: PaneContent;
}

interface PreservedScrollPosition {
  left: number;
  top: number;
}

/**
 * Browsers and virtualized timelines can normalize an invisible scroller back
 * to zero during the maximize layout transition. Record user-visible pane
 * scrollers as they move, ignore normalization events from hidden panes, and
 * restore the same mounted elements after each maximize/restore transition.
 */
function usePreservedSplitScrollPositions(maximizedPaneId: string | null) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef(new Map<HTMLElement, PreservedScrollPosition>());
  const previousMaximizedPaneIdRef = useRef(maximizedPaneId);

  const captureVisibleScrollPositions = useCallback(() => {
    const workspace = workspaceRef.current;
    if (workspace === null) {
      return;
    }
    for (const pane of workspace.querySelectorAll<HTMLElement>(
      `[${SPLIT_PANE_DATA_ATTR}]:not([aria-hidden="true"])`,
    )) {
      for (const element of pane.querySelectorAll<HTMLElement>("*")) {
        if (element.scrollLeft === 0 && element.scrollTop === 0) {
          positionsRef.current.delete(element);
          continue;
        }
        positionsRef.current.set(element, {
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (previousMaximizedPaneIdRef.current === maximizedPaneId) {
      return;
    }
    previousMaximizedPaneIdRef.current = maximizedPaneId;

    const restore = () => {
      const workspace = workspaceRef.current;
      for (const [element, position] of positionsRef.current) {
        if (workspace === null || !workspace.contains(element)) {
          positionsRef.current.delete(element);
          continue;
        }
        element.scrollLeft = position.left;
        element.scrollTop = position.top;
      }
    };

    // Restore before paint, then briefly across animation frames so passive
    // timeline effects, virtualization, and browser scroll anchoring cannot
    // overwrite the saved position while pane visibility settles.
    restore();
    let frame: number | null = null;
    let framesRemaining = 30;
    const restoreUntilSettled = () => {
      restore();
      framesRemaining -= 1;
      if (framesRemaining > 0) {
        frame = window.requestAnimationFrame(restoreUntilSettled);
      }
    };
    frame = window.requestAnimationFrame(restoreUntilSettled);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [maximizedPaneId]);

  return { captureVisibleScrollPositions, workspaceRef };
}

export function SplitThreadArea(props: SplitThreadAreaProps = {}) {
  return (
    <ThreadDetailWorkerPoolProvider>
      <SplitThreadAreaContent {...props} />
    </ThreadDetailWorkerPoolProvider>
  );
}

function SplitThreadAreaContent({ routeContent }: SplitThreadAreaProps) {
  const { projectId, threadId } = useRouteState();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const splitWorkspaceActive = useSplitWorkspaceActive();
  const navigate = useNavigate();
  const store = useStore();
  const [storedLayout, setLayout] = useAtom(splitLayoutAtom);
  const dimsInactiveSplits = useAtomValue(dimInactiveSplitsAtom);
  const [maximizedPaneId, setMaximizedPaneIdAtom] =
    useAtom(maximizedPaneIdAtom);
  const secondaryPanelRegistry = useMemo(
    () => createPaneSecondaryPanelRegistry(),
    [],
  );

  const routeThread = useMemo<ThreadRoutePathArgs | null>(
    () => (projectId && threadId ? { projectId, threadId } : null),
    [projectId, threadId],
  );
  const currentContent = useMemo<PaneContent | null>(
    () => routeContent ?? (routeThread ? threadPaneContent(routeThread) : null),
    [routeContent, routeThread],
  );

  // Fold external navigation (initial load, sidebar click, deep link) into the
  // layout. The reconcile is idempotent, so a URL that already matches the
  // focused pane is a no-op — no history spam, no render loop.
  useEffect(() => {
    if (!threadSplitsEnabled || currentContent === null) {
      return;
    }
    setLayout((previous) =>
      reconcileLayoutForContent(previous, currentContent),
    );
  }, [currentContent, setLayout, threadSplitsEnabled]);

  // Effective layout for render/handlers before the effect seeds the atom.
  const layout: SplitLayout | null =
    storedLayout ??
    (currentContent?.kind === "thread" && routeThread
      ? createSinglePaneLayout(routeThread)
      : currentContent
        ? reconcileLayoutForContent(null, currentContent)
        : null);
  const panes = layout === null ? [] : listPanes(layout.root);
  const isSplitActive = splitWorkspaceActive && panes.length > 1;
  const maximizedPane =
    layout !== null && maximizedPaneId !== null
      ? findPane(layout.root, maximizedPaneId)
      : null;
  const effectiveMaximizedPaneId =
    layout !== null &&
    countPanes(layout.root) > 1 &&
    maximizedPaneId !== null &&
    maximizedPane !== null
      ? maximizedPaneId
      : null;
  const {
    captureVisibleScrollPositions,
    workspaceRef: preservedScrollWorkspaceRef,
  } = usePreservedSplitScrollPositions(effectiveMaximizedPaneId);
  const setMaximizedPaneId = useCallback(
    (next: SetStateAction<string | null>) => {
      captureVisibleScrollPositions();
      setMaximizedPaneIdAtom(next);
    },
    [captureVisibleScrollPositions, setMaximizedPaneIdAtom],
  );

  // CLI/SDK pane actions arrive as ephemeral server broadcasts. This split
  // owner applies them so agent-driven transitions share the local control's
  // scroll snapshot and focus/URL policy.
  useEffect(
    () =>
      wsManager.onThreadPaneAction((signal) => {
        if (!threadSplitsEnabled) {
          return;
        }
        const current = store.get(splitLayoutAtom);
        if (current === null) {
          return;
        }
        const previousMaximizedPaneId = store.get(maximizedPaneIdAtom);
        const next = applyThreadPaneActionToLayout(
          current,
          previousMaximizedPaneId,
          { projectId: signal.projectId, threadId: signal.threadId },
          signal.action,
        );
        if (next.layout !== current) {
          store.set(splitLayoutAtom, next.layout);
          const route = focusedPaneRoute(next.layout);
          if (route !== null) {
            navigate(route, { replace: true });
          }
        }
        if (next.maximizedPaneId !== previousMaximizedPaneId) {
          setMaximizedPaneId(next.maximizedPaneId);
        }
        if (next.dimInactiveSplits !== null) {
          store.set(dimInactiveSplitsAtom, next.dimInactiveSplits);
        }
      }),
    [navigate, setMaximizedPaneId, store, threadSplitsEnabled],
  );

  // A maximized pane is always the focused/address-bar owner. External opens
  // and keyboard focus commands can change focus without going through the
  // local callbacks below, so carry maximization to that newly focused pane.
  // Stale persisted ids fail safe by restoring the whole split.
  useEffect(() => {
    if (maximizedPaneId === null) return;
    if (
      layout === null ||
      countPanes(layout.root) < 2 ||
      maximizedPane === null
    ) {
      setMaximizedPaneId(null);
      return;
    }
    if (layout.focusedPaneId !== maximizedPaneId) {
      setMaximizedPaneId(layout.focusedPaneId);
    }
  }, [layout, maximizedPane, maximizedPaneId, setMaximizedPaneId]);

  // Content navigation inside a pane pushes history like the page surface does
  // today. replacePaneContent focuses the pane, so the pushed URL matches it.
  const navigateInPane = useCallback<NavigateInPane>(
    (paneId, thread) => {
      setLayout((previous) =>
        previous === null
          ? previous
          : replacePaneContent(previous, paneId, threadPaneContent(thread)),
      );
      navigate(getThreadRoutePath(thread));
    },
    [navigate, setLayout],
  );

  // Focusing a pane rewrites the URL with replace (focus changes shouldn't spam
  // history), and the focused pane becomes the address bar's owner.
  const focusPane = useCallback(
    (paneId: string) => {
      if (layout === null || layout.focusedPaneId === paneId) {
        return;
      }
      const pane = findPane(layout.root, paneId);
      setLayout(setFocus(layout, paneId));
      if (maximizedPaneId !== null) {
        setMaximizedPaneId(paneId);
      }
      if (pane !== null) {
        navigate(paneContentRoute(pane.content), { replace: true });
      }
    },
    [layout, maximizedPaneId, navigate, setLayout, setMaximizedPaneId],
  );

  const closePane = useCallback(
    (paneId: string) => {
      if (layout === null) {
        return;
      }
      const next = removePane(layout, paneId);
      if (next === layout) {
        return;
      }
      setLayout(next);
      if (maximizedPaneId === paneId) {
        setMaximizedPaneId(null);
      }
      if (next.focusedPaneId !== layout.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) {
          navigate(route, { replace: true });
        }
      }
    },
    [layout, maximizedPaneId, navigate, setLayout, setMaximizedPaneId],
  );

  const toggleMaximizePane = useCallback(
    (paneId: string) => {
      const current = store.get(splitLayoutAtom);
      const pane = current === null ? null : findPane(current.root, paneId);
      if (current === null || countPanes(current.root) < 2 || pane === null) {
        return;
      }
      if (current.focusedPaneId !== paneId) {
        const next = setFocus(current, paneId);
        store.set(splitLayoutAtom, next);
        const route = focusedPaneRoute(next);
        if (route !== null) navigate(route, { replace: true });
      }
      setMaximizedPaneId((previous) => (previous === paneId ? null : paneId));
    },
    [navigate, setMaximizedPaneId, store],
  );

  const movePaneToSide = useCallback(
    (paneId: string, side: SplitSide) => {
      const current = store.get(splitLayoutAtom);
      if (current === null || countPanes(current.root) < 2) return;

      const rects = computePaneRects(current.root);
      const candidates = listPanes(current.root).filter(
        (pane) => pane.paneId !== paneId,
      );
      const edgePosition = (candidateId: string) => {
        const rect = rects.get(candidateId);
        if (rect === undefined) return 0;
        switch (side) {
          case "left":
            return rect.x;
          case "right":
            return -(rect.x + rect.w);
          case "top":
            return rect.y;
          case "bottom":
            return -(rect.y + rect.h);
        }
      };
      const target = candidates.sort(
        (first, second) =>
          edgePosition(first.paneId) - edgePosition(second.paneId),
      )[0];
      if (target === undefined) return;

      const next = movePane(current, paneId, target.paneId, side);
      if (next === current) return;
      store.set(splitLayoutAtom, next);
      const route = focusedPaneRoute(next);
      if (route !== null) navigate(route, { replace: true });
    },
    [navigate, store],
  );

  const resize = useCallback(
    (splitPath: SplitPath, childIndex: number, fraction: number) => {
      setLayout((previous) =>
        previous === null
          ? previous
          : resizeSplit(previous, splitPath, childIndex, fraction),
      );
    },
    [setLayout],
  );

  // Prune a pane whose thread turned out to be deleted or archived (a restored
  // layout can reference a stale thread; archived threads don't belong in split
  // panes). Reuses the close navigation sync: focus falls to a survivor and the
  // URL follows. The last pane is left as-is so single-pane viewing of a stale
  // thread stays at parity with the pre-split page (a bare "Not found"). Reads
  // the store imperatively so concurrent per-pane signals act on fresh state.
  const pruneStalePane = useCallback(
    (paneId: string) => {
      const current = store.get(splitLayoutAtom);
      if (current === null) {
        return;
      }
      const next = removePane(current, paneId);
      if (next === current) {
        return;
      }
      store.set(splitLayoutAtom, next);
      if (maximizedPaneId === paneId) {
        setMaximizedPaneId(null);
      }
      if (next.focusedPaneId !== current.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) {
          navigate(route, { replace: true });
        }
      }
    },
    [maximizedPaneId, navigate, setMaximizedPaneId, store],
  );

  // Pane reorder: dragging a pane header through the shared split-drag layer.
  // Edge drop = movePane (allowed at the cap — moves never add a pane), center
  // drop = swapPanes. Both ops set the layout's focus, and the URL follows it.
  // Read the layout imperatively from the store so a drop always acts on the
  // latest arrangement, not the value captured when the drag began.
  const beginPaneDrag = useCallback<BeginPaneDrag>(
    (paneId, event, label) => {
      const startLayout = store.get(splitLayoutAtom);
      if (startLayout === null || countPanes(startLayout.root) < 2) {
        return;
      }
      const restoreMaximizeAfterDrag =
        store.get(maximizedPaneIdAtom) === paneId;
      const sourceEl =
        event.currentTarget instanceof Element
          ? event.currentTarget.closest<HTMLElement>(
              `[${SPLIT_PANE_DATA_ATTR}]`,
            )
          : null;
      const startX = event.clientX;
      const startY = event.clientY;
      beginSplitDrag(startX, startY, {
        ghostLabel: label,
        sourceEl,
        shouldEngage: (x, y) =>
          Math.hypot(x - startX, y - startY) > PANE_DRAG_ENGAGE_DISTANCE_PX,
        // A maximized pane is the only hit-testable pane. Reveal the preserved
        // tree once the drag owns the gesture so move/swap targets are usable,
        // then restore the dragged pane's maximized presentation on every end
        // path. The layout tree and pane instances remain untouched here.
        onEngage: restoreMaximizeAfterDrag
          ? () => setMaximizedPaneId(null)
          : undefined,
        onEnd: restoreMaximizeAfterDrag
          ? () => {
              const current = store.get(splitLayoutAtom);
              if (
                current !== null &&
                findPane(current.root, current.focusedPaneId) !== null
              ) {
                // Edge moves preserve the pane id; center swaps move its
                // content into the target pane id. Both operations focus the
                // dragged content's destination, which is what must remain
                // maximized.
                setMaximizedPaneId(current.focusedPaneId);
              }
            }
          : undefined,
        decide: (targetPaneId, zone) =>
          decidePaneDrop({ zone, isSelf: targetPaneId === paneId }),
        onDrop: (target) => {
          const current = store.get(splitLayoutAtom);
          if (current === null) {
            return;
          }
          const next =
            target.zone === "center"
              ? swapPanes(current, paneId, target.paneId)
              : movePane(current, paneId, target.paneId, target.zone);
          if (next === current) {
            return;
          }
          store.set(splitLayoutAtom, next);
          const route = focusedPaneRoute(next);
          if (route !== null) {
            navigate(route, { replace: true });
          }
        },
      });
    },
    [navigate, setMaximizedPaneId, store],
  );

  // A disabled experiment and compact viewports both render the route thread as
  // single page surface (byte-identical to the pre-split page). The layout atom
  // is preserved so the arrangement returns when the gate opens again. AppLayout
  // reads the same predicate to decide whether it owns the header — see
  // useSplitWorkspaceActive.
  if (!splitWorkspaceActive || layout === null || currentContent === null) {
    return currentContent ? (
      <StandalonePaneContent
        content={currentContent}
        paneId={layout?.focusedPaneId}
      />
    ) : null;
  }

  const commandHandlers = (
    <SplitPaneCommandHandlers
      closePane={closePane}
      focusPane={focusPane}
      isSplitActive={isSplitActive}
      layout={layout}
      maximizedPaneId={effectiveMaximizedPaneId}
      panes={panes}
      toggleMaximizePane={toggleMaximizePane}
    />
  );

  const firstPane = panes[0];
  if (panes.length === 1 && firstPane !== undefined) {
    // Single pane: DOM-identical to the pre-split page surface — no wrapper, no
    // focus ring, no pane chrome. Sidebar drops still create the first split by
    // hit-testing the main content region (see useThreadRowSplitDrag's
    // single-pane fallback), so no wrapper element is needed here.
    return (
      <>
        {commandHandlers}
        <WorkspacePaneContent
          content={firstPane.content}
          paneId={firstPane.paneId}
          isFocused
          isSplitPane={false}
          secondaryPanelRegistry={null}
          reservesWindowPanelToggle={false}
          onRequestClose={null}
          isMaximized={false}
          onToggleMaximize={null}
          isBoundedPane={false}
          isTopRow
          ownsWindowTopLeft
          onNavigateInPane={navigateInPane}
        />
      </>
    );
  }

  return (
    <>
      {commandHandlers}
      {/* Full-bleed like the single-pane page surface: outer edges stay flush,
          so the top pane headers share the chrome axis with the pinned sidebar
          trigger exactly like the unsplit page. overflow-hidden keeps short
          windows from scrolling the whole split when stacked panes hit their
          min content height. */}
      <div
        ref={preservedScrollWorkspaceRef}
        className="relative -m-4 flex min-h-0 min-w-0 flex-1 overflow-hidden md:-m-5"
      >
        <SplitWorkspaceSecondaryPanelHost
          focusedPaneId={effectiveMaximizedPaneId ?? layout.focusedPaneId}
          isPaneMaximized={effectiveMaximizedPaneId !== null}
          registry={secondaryPanelRegistry}
        >
          <SplitTree
            node={layout.root}
            path={EMPTY_PATH}
            isTopRow
            isLeftEdge
            isRightEdge
            dimsInactiveSplits={dimsInactiveSplits}
            focusedPaneId={effectiveMaximizedPaneId ?? layout.focusedPaneId}
            maximizedPaneId={effectiveMaximizedPaneId}
            secondaryPanelRegistry={secondaryPanelRegistry}
            onFocusPane={focusPane}
            onClosePane={closePane}
            onToggleMaximizePane={toggleMaximizePane}
            onMovePaneToSide={movePaneToSide}
            onResize={resize}
            onNavigateInPane={navigateInPane}
            onBeginPaneDrag={beginPaneDrag}
            onPruneStalePane={pruneStalePane}
          />
        </SplitWorkspaceSecondaryPanelHost>
      </div>
    </>
  );
}

interface SplitPaneCommandHandlersProps {
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  isSplitActive: boolean;
  layout: SplitLayout;
  maximizedPaneId: string | null;
  panes: readonly PaneNode[];
  toggleMaximizePane: (paneId: string) => void;
}

/** Mounted only while the experiment is enabled, so OFF unregisters commands. */
function SplitPaneCommandHandlers({
  closePane,
  focusPane,
  isSplitActive,
  layout,
  maximizedPaneId,
  panes,
  toggleMaximizePane,
}: SplitPaneCommandHandlersProps) {
  useAppCommandContext("splitActive", isSplitActive);
  useAppCommandHandler("pane.focus.previous", () => {
    if (!isSplitActive) return false;
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, -1);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useAppCommandHandler("pane.focus.next", () => {
    if (!isSplitActive) return false;
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, 1);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useIndexedAppCommandHandlers(PANE_FOCUS_APP_COMMAND_IDS, (index) => {
    if (!isSplitActive) return false;
    const paneId = getPaneIdAtReadingIndex(panes, index);
    if (paneId !== null) focusPane(paneId);
    return true;
  });
  useAppCommandHandler("pane.close", () => {
    if (!isSplitActive) return false;
    closePane(layout.focusedPaneId);
    return true;
  });
  useAppCommandHandler("pane.maximize.toggle", () => {
    if (!isSplitActive) return false;
    toggleMaximizePane(maximizedPaneId ?? layout.focusedPaneId);
    return true;
  });
  return null;
}

interface SplitTreeProps {
  node: LayoutNode;
  path: SplitPath;
  dimsInactiveSplits: boolean;
  /** Whether this subtree touches the workspace's top edge. */
  isTopRow: boolean;
  /** Whether this subtree touches the workspace's left edge. */
  isLeftEdge: boolean;
  /** Whether this subtree touches the workspace's right edge. */
  isRightEdge: boolean;
  focusedPaneId: string;
  maximizedPaneId: string | null;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onToggleMaximizePane: (paneId: string) => void;
  onMovePaneToSide: (paneId: string, side: SplitSide) => void;
  onResize: (
    splitPath: SplitPath,
    childIndex: number,
    fraction: number,
  ) => void;
  onNavigateInPane: NavigateInPane;
  onBeginPaneDrag: BeginPaneDrag;
  onPruneStalePane: (paneId: string) => void;
}

function SplitTree(props: SplitTreeProps) {
  const { node, path, isTopRow, isLeftEdge, isRightEdge, focusedPaneId } =
    props;

  if (node.type === "pane") {
    const isFocused = node.paneId === focusedPaneId;
    const isMaximized = node.paneId === props.maximizedPaneId;
    const isHiddenByMaximize = props.maximizedPaneId !== null && !isMaximized;
    return (
      <div
        onPointerDown={() => props.onFocusPane(node.paneId)}
        // Flush tiles: no rounding, outer edges flush; a straight hairline
        // seam separates panes (see SplitDivider). Bounded panes suppress
        // the content's page-bleed negative margins (see
        // PaneContextValue.isBoundedPane) so content fills the tile exactly.
        aria-hidden={isHiddenByMaximize || undefined}
        // Electron can retain a composited frame from animated descendants
        // (notably the New Thread welcome mark) after visibility changes.
        // Skip subtree painting while preserving the mounted pane and its box.
        style={isHiddenByMaximize ? { contentVisibility: "hidden" } : undefined}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
          isHiddenByMaximize && "invisible pointer-events-none",
          isMaximized && "absolute inset-0 z-30",
        )}
        data-split-pane-id={node.paneId}
        data-focused={isFocused ? "true" : "false"}
        data-maximized={isMaximized ? "true" : undefined}
      >
        {/* Only mounted in split mode, so single panes never pay for the extra
            thread subscription (and never prune the last pane). */}
        {node.content.kind === "thread" ? (
          <PaneStaleWatcher
            threadId={node.content.threadId}
            onStale={() => props.onPruneStalePane(node.paneId)}
          />
        ) : null}
        <WorkspacePaneContent
          content={node.content}
          paneId={node.paneId}
          isFocused={isFocused}
          isSplitPane
          secondaryPanelRegistry={props.secondaryPanelRegistry}
          // Position alone decides this: the host pins its toggle over the
          // workspace corner, so a plugin pane sitting there must reserve the
          // same footprint or the toggle lands on its Close pane button.
          reservesWindowPanelToggle={isMaximized || (isTopRow && isRightEdge)}
          onRequestClose={() => props.onClosePane(node.paneId)}
          isMaximized={isMaximized}
          onToggleMaximize={() => props.onToggleMaximizePane(node.paneId)}
          onMoveToSide={(side) => props.onMovePaneToSide(node.paneId, side)}
          isBoundedPane
          isTopRow={isMaximized || isTopRow}
          ownsWindowTopLeft={
            props.maximizedPaneId !== null
              ? isMaximized
              : isTopRow && isLeftEdge
          }
          onNavigateInPane={props.onNavigateInPane}
          onBeginPaneDrag={props.onBeginPaneDrag}
        />
        {/* Recede inactive pane bodies without adding another boundary. Pane
            headers sit above this layer so titles, selected tabs, and controls
            stay crisp while the timeline and composer step back. */}
        <div
          aria-hidden
          data-pane-focus-scrim=""
          className={cn(
            "pointer-events-none absolute inset-0 z-20 transition-colors",
            isFocused || !props.dimsInactiveSplits
              ? "bg-transparent"
              : "bg-background/30",
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        node.dir === "col" ? "flex-col" : "flex-row",
      )}
    >
      {node.children.map((child, index) => (
        <Fragment key={paneKey(child)}>
          {index > 0 ? (
            <SplitDivider
              dir={node.dir}
              hidden={props.maximizedPaneId !== null}
              onResize={(fraction) => props.onResize(path, index - 1, fraction)}
            />
          ) : null}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${node.sizes[index] ?? 1} 1 0` }}
          >
            <SplitTree
              {...props}
              node={child}
              path={[...path, index]}
              // Horizontal siblings all remain on the same top row. In a
              // vertical stack, only the first child can inherit the parent
              // subtree's contact with the workspace top edge.
              isTopRow={isTopRow && (node.dir === "row" || index === 0)}
              // Vertical siblings share the parent's left edge. In a
              // horizontal row, only the first child can inherit it.
              isLeftEdge={isLeftEdge && (node.dir === "col" || index === 0)}
              isRightEdge={
                isRightEdge &&
                (node.dir === "col" || index === node.children.length - 1)
              }
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

interface WorkspacePaneContentProps {
  content: PaneContent;
  paneId: string;
  isFocused: boolean;
  isSplitPane: boolean;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry | null;
  reservesWindowPanelToggle: boolean;
  onRequestClose: (() => void) | null;
  isMaximized: boolean;
  onToggleMaximize: (() => void) | null;
  onMoveToSide?: (side: SplitSide) => void;
  // True inside multi-pane split cards; suppresses the page-bleed margins so
  // content fills the card exactly (see PaneContextValue.isBoundedPane).
  isBoundedPane: boolean;
  isTopRow: boolean;
  ownsWindowTopLeft: boolean;
  onNavigateInPane: NavigateInPane;
  // Absent for the single-pane surface — a lone pane has nothing to reorder.
  onBeginPaneDrag?: BeginPaneDrag;
}

function WorkspacePaneContent({
  content,
  paneId,
  isFocused,
  isSplitPane,
  secondaryPanelRegistry,
  reservesWindowPanelToggle,
  onRequestClose,
  isMaximized,
  onToggleMaximize,
  onMoveToSide,
  isBoundedPane,
  isTopRow,
  ownsWindowTopLeft,
  onNavigateInPane,
  onBeginPaneDrag,
}: WorkspacePaneContentProps) {
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => onNavigateInPane(paneId, thread),
    [onNavigateInPane, paneId],
  );
  const beginPaneDrag = useMemo(
    () =>
      onBeginPaneDrag
        ? (event: ReactPointerEvent, label: string) =>
            onBeginPaneDrag(paneId, event, label)
        : undefined,
    [onBeginPaneDrag, paneId],
  );
  const secondaryPanelHost = useMemo<PaneSecondaryPanelRegistration | null>(
    () =>
      secondaryPanelRegistry === null
        ? null
        : {
            publish: (model) => secondaryPanelRegistry.publish(paneId, model),
            clear: () => secondaryPanelRegistry.clear(paneId),
          },
    [paneId, secondaryPanelRegistry],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId,
      isFocused,
      isSplitPane,
      secondaryPanelHost,
      reservesWindowPanelToggle,
      onRequestClose,
      isMaximized,
      onToggleMaximize,
      onMoveToSide,
      isBoundedPane,
      isTopRow,
      ownsWindowTopLeft,
      navigateInPane,
      beginPaneDrag,
    }),
    [
      beginPaneDrag,
      isBoundedPane,
      isFocused,
      isSplitPane,
      isTopRow,
      ownsWindowTopLeft,
      navigateInPane,
      onRequestClose,
      isMaximized,
      onToggleMaximize,
      onMoveToSide,
      paneId,
      reservesWindowPanelToggle,
      secondaryPanelHost,
    ],
  );

  if (content.kind !== "thread") {
    return (
      <PaneContext.Provider value={value}>
        <NonThreadPaneContent
          content={content}
          onRequestClose={onRequestClose}
          beginPaneDrag={beginPaneDrag}
          isBoundedPane={isBoundedPane}
          isTopRow={isTopRow}
          ownsWindowTopLeft={ownsWindowTopLeft}
        />
      </PaneContext.Provider>
    );
  }

  return (
    <PaneContext.Provider value={value}>
      <ThreadDetailView
        surface="pane"
        projectId={content.projectId}
        threadId={content.threadId}
      />
    </PaneContext.Provider>
  );
}

function StandalonePaneContent({
  content,
  paneId,
}: {
  content: PaneContent;
  paneId?: string;
}) {
  const navPanelChrome = usePluginNavPanelChrome();
  if (content.kind === "thread") {
    return <ThreadDetailView surface="page" />;
  }
  if (content.kind === "new-thread") {
    return <RootComposeView />;
  }
  const panelEntry = navPanelChrome.find(
    (candidate) =>
      candidate.chrome.pluginId === content.pluginId &&
      candidate.chrome.path === content.panelPath,
  );
  const panel = panelEntry?.panel ?? undefined;
  const panelChrome = panelEntry?.chrome;
  const body = (
    <PluginPanelView
      pluginId={content.pluginId}
      panelPath={content.panelPath}
      subPath={content.subPath}
    />
  );
  return (
    <PluginPagePanelHost
      flushPageInsets
      pluginId={content.pluginId}
      panelPath={content.panelPath}
      paneId={paneId}
      subPath={content.subPath}
    >
      {panelChrome ? (
        <div className="flex h-full min-h-0 flex-col">
          <AppPageHeader
            center={<PluginPanelHeaderCenter chrome={panelChrome} />}
            actions={
              panel ? (
                <PluginPanelHeaderActions
                  panel={panel}
                  paneId={paneId}
                  subPath={content.subPath}
                />
              ) : undefined
            }
          />
          <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">{body}</div>
        </div>
      ) : (
        body
      )}
    </PluginPagePanelHost>
  );
}

function NonThreadPaneContent({
  content,
  onRequestClose,
  beginPaneDrag,
  isBoundedPane,
  isTopRow,
  ownsWindowTopLeft,
}: {
  content: Exclude<PaneContent, { kind: "thread" }>;
  onRequestClose: (() => void) | null;
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
  isBoundedPane: boolean;
  isTopRow: boolean;
  ownsWindowTopLeft: boolean;
}) {
  const navPanelChrome = usePluginNavPanelChrome();
  const resourceRouteLabel = useAtomValue(resourceRouteLabelAtom);
  const dimsInactiveSplits = useAtomValue(dimInactiveSplitsAtom);
  const { reservesWindowPanelToggle, isFocused } = useOptionalPaneContext() ?? {
    reservesWindowPanelToggle: false,
    isFocused: true,
  };
  const hostLayout = useContext(SecondaryPanelHostLayoutContext);
  // The corner belongs to the pane unless the host paints its toggle there.
  const showsWindowPanelToggle = hostLayout?.pinsCornerToggle === true;
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const panelEntry =
    content.kind === "plugin-panel"
      ? navPanelChrome.find(
          (candidate) =>
            candidate.chrome.pluginId === content.pluginId &&
            candidate.chrome.path === content.panelPath,
        )
      : undefined;
  const panel = panelEntry?.panel ?? undefined;
  const panelChrome = panelEntry?.chrome;
  const automationBreadcrumbs =
    content.kind === "plugin-panel"
      ? resolveAutomationBreadcrumbs(
          paneContentRoute(content),
          isFocused ? resourceRouteLabel : null,
        )
      : null;
  const label = panelChrome?.title ?? "New thread";
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest("a, button") !== null
    ) {
      return;
    }
    if (event.button === 0) beginPaneDrag?.(event, label);
  };
  const actions = (
    <>
      {panel ? (
        <PluginPanelHeaderActions
          panel={panel}
          subPath={content.kind === "plugin-panel" ? content.subPath : ""}
        />
      ) : null}
      <PaneMaximizeButton />
      {onRequestClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
          )}
          aria-label="Close pane"
          onClick={onRequestClose}
        >
          <Icon
            name={
              content.kind === "new-thread"
                ? "CloseThreadPane"
                : "ClosePluginPane"
            }
          />
        </Button>
      ) : null}
      {reservesWindowPanelToggle && showsWindowPanelToggle ? (
        // The host's shortcut hint drops below the chrome row; reserve only
        // its stable 28px corner button beside these pane actions. Whenever
        // the host hides that toggle, the pane actions sit flush at the pane
        // edge instead of trailing an empty slot.
        <span aria-hidden className={HEADER_ICON_BUTTON_CLASS} />
      ) : null}
    </>
  );

  const contentMarkup = (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        // Single-pane surfaces own their own padding (the compose page and
        // plugin panels both re-apply it inside). Compose cancels the app
        // layout's page padding here. Plugin pages leave that to
        // PluginPagePanelHost so its main and secondary panels share the same
        // full-bleed bounds instead of cancelling the inset twice.
        !isBoundedPane && content.kind === "new-thread" && "-m-4 md:-m-5",
      )}
    >
      {isBoundedPane || panel ? (
        <AppPageHeader
          isWindowDragRegion={isTopRow}
          ownsWindowTopLeft={ownsWindowTopLeft}
          className={isBoundedPane ? "z-[21]" : undefined}
          center={
            <div
              data-pane-header-focus-tab={
                isBoundedPane && isFocused ? "" : undefined
              }
              className={cn(
                "relative flex min-w-0 flex-1 items-center",
                isBoundedPane && "-mx-2 -my-1 rounded-md px-2 py-1",
                isBoundedPane && isFocused && CONTEXT_SELECTION_SURFACE_CLASS,
                beginPaneDrag &&
                  cn(
                    "cursor-grab touch-none select-none",
                    // AppPageHeader is an OS window-drag region on macOS.
                    // Carve this pane-reorder handle out so Electron routes
                    // the pointer gesture to the split drag layer, matching
                    // the thread-title handle in ThreadDetailHeader.
                    usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                  ),
              )}
              onPointerDown={beginPaneDrag ? handlePointerDown : undefined}
            >
              {automationBreadcrumbs ? (
                <AppBreadcrumbs
                  breadcrumbs={automationBreadcrumbs}
                  usesDesktopChrome={usesDesktopChrome}
                />
              ) : panelChrome ? (
                <PluginPanelHeaderCenter chrome={panelChrome} />
              ) : (
                <p
                  className={cn(
                    "relative truncate text-sm font-normal transition-colors",
                    isBoundedPane &&
                      !isFocused &&
                      dimsInactiveSplits &&
                      CONTEXT_INACTIVE_TEXT_CLASS,
                  )}
                >
                  New thread
                </p>
              )}
            </div>
          }
          actions={actions}
        />
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-5",
          // Keep plugin-owned z-index layers inside the plugin surface. The
          // split host's focus scrim can then treat the pane atomically instead
          // of landing between a plugin's main content and internal drawer.
          isBoundedPane && content.kind === "plugin-panel" && "isolate",
        )}
      >
        {content.kind === "new-thread" ? (
          <RootComposeView />
        ) : (
          <PluginPanelView
            pluginId={content.pluginId}
            panelPath={content.panelPath}
            subPath={content.subPath}
          />
        )}
      </div>
    </div>
  );

  return content.kind === "plugin-panel" ? (
    <PluginPagePanelHost
      flushPageInsets={!isBoundedPane}
      pluginId={content.pluginId}
      panelPath={content.panelPath}
      subPath={content.subPath}
    >
      {contentMarkup}
    </PluginPagePanelHost>
  ) : (
    contentMarkup
  );
}

interface SplitDividerProps {
  dir: "row" | "col";
  hidden: boolean;
  onResize: (fraction: number) => void;
}

interface FrozenTimelineRow {
  containIntrinsicBlockSize: string;
  contentVisibility: string;
  element: HTMLElement;
  height: string;
}

function findVerticalScrollViewport(element: HTMLElement): HTMLElement | null {
  let candidate = element.parentElement;
  while (candidate !== null) {
    const overflowY = window.getComputedStyle(candidate).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      candidate.scrollHeight > candidate.clientHeight
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function freezeOffscreenTimelineRows(
  previous: HTMLElement,
  next: HTMLElement,
): () => void {
  const rows = [
    ...previous.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
    ...next.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
  ];
  const frozenRows: FrozenTimelineRow[] = [];
  const viewportRects = new Map<HTMLElement, DOMRect>();

  // Batch every geometry read before writing styles so this setup incurs at
  // most one layout pass. Keep one viewport of overscan on each side; only
  // rows far outside the clipped pane are skipped during the drag.
  for (const row of rows) {
    const viewport = findVerticalScrollViewport(row);
    if (viewport === null) continue;
    const rowRect = row.getBoundingClientRect();
    let viewportRect = viewportRects.get(viewport);
    if (viewportRect === undefined) {
      viewportRect = viewport.getBoundingClientRect();
      viewportRects.set(viewport, viewportRect);
    }
    const overscan = viewportRect.height;
    const isOffscreen =
      rowRect.bottom < viewportRect.top - overscan ||
      rowRect.top > viewportRect.bottom + overscan;
    if (!isOffscreen || rowRect.height <= 0) continue;
    frozenRows.push({
      containIntrinsicBlockSize: row.style.containIntrinsicBlockSize,
      contentVisibility: row.style.contentVisibility,
      element: row,
      height: `${rowRect.height}px`,
    });
  }

  for (const { element, height } of frozenRows) {
    element.style.containIntrinsicBlockSize = height;
    element.style.contentVisibility = "hidden";
  }

  return () => {
    for (const {
      containIntrinsicBlockSize,
      contentVisibility,
      element,
    } of frozenRows) {
      element.style.containIntrinsicBlockSize = containIntrinsicBlockSize;
      element.style.contentVisibility = contentVisibility;
    }
  };
}

function SplitDivider({ dir, hidden, onResize }: SplitDividerProps) {
  const horizontal = dir === "row";

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const hitTarget = event.currentTarget;
      const divider = hitTarget.parentElement;
      if (!(divider instanceof HTMLDivElement)) {
        return;
      }
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      // The adjacent pair's outer bounds do not move during this drag. Read
      // them once instead of forcing layout twice for every pointer event.
      const previousRect = previous.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const start = horizontal ? previousRect.left : previousRect.top;
      const end = horizontal ? nextRect.right : nextRect.bottom;
      const span = end - start;
      if (span <= 0) {
        return;
      }

      hitTarget.setPointerCapture(event.pointerId);
      divider.dataset.dragging = "true";

      const previousGrow = Number.parseFloat(
        window.getComputedStyle(previous).flexGrow,
      );
      const nextGrow = Number.parseFloat(
        window.getComputedStyle(next).flexGrow,
      );
      const pairTotal =
        Number.isFinite(previousGrow) &&
        Number.isFinite(nextGrow) &&
        previousGrow + nextGrow > 0
          ? previousGrow + nextGrow
          : 1;
      const previousFlex = previous.style.flex;
      const nextFlex = next.style.flex;
      const restoreTimelineRows = freezeOffscreenTimelineRows(previous, next);
      let pendingFraction: number | null = null;
      let finished = false;

      const onMove = (moveEvent: PointerEvent) => {
        const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
        const fraction = clampSplitPairFraction((pointer - start) / span);
        pendingFraction = fraction;

        // Keep high-frequency drag state local to the two flex items. Writing
        // the persisted split-layout atom here would rerender every pane and
        // sidebar split indicator, and serialize localStorage, on every move.
        previous.style.flex = `${pairTotal * fraction} 1 0px`;
        next.style.flex = `${pairTotal * (1 - fraction)} 1 0px`;
      };
      const finish = (commit: boolean) => {
        if (finished) return;
        finished = true;
        delete divider.dataset.dragging;
        hitTarget.removeEventListener("pointermove", onMove);
        hitTarget.removeEventListener("pointerup", onUp);
        hitTarget.removeEventListener("pointercancel", onCancel);
        restoreTimelineRows();
        if (commit && pendingFraction !== null) {
          // Commit once so the imperative flex values above become the
          // canonical persisted layout without a visual jump.
          onResize(pendingFraction);
          return;
        }
        previous.style.flex = previousFlex;
        next.style.flex = nextFlex;
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      hitTarget.addEventListener("pointermove", onMove);
      hitTarget.addEventListener("pointerup", onUp);
      hitTarget.addEventListener("pointercancel", onCancel);
    },
    [horizontal, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      className={cn(
        // A one-pixel seam between flush tiles — squared ends, no rounding,
        // only BETWEEN splits (outer edges stay flush). Hover/drag warms it as
        // the resize affordance. The absolutely-positioned child preserves a
        // generous grab target without consuming layout space.
        //
        // Stay above the pane focus scrim (z-20) and the pane headers (z-[21]).
        // In a column split, the lower pane's header touches the seam, so a
        // lower divider layer loses the grab target to that header.
        "group relative z-[25] flex-shrink-0 transition-colors",
        "bg-border-seam",
        "hover:bg-ring/40 data-[dragging]:bg-ring/40",
        hidden && "invisible pointer-events-none",
        horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
    >
      <div
        aria-hidden
        data-split-divider-hit-target=""
        onPointerDown={handlePointerDown}
        className={cn(
          "absolute z-10 touch-none bg-transparent",
          horizontal
            ? "-left-1.5 top-0 h-full w-3 cursor-col-resize"
            : "left-0 -top-1.5 h-3 w-full cursor-row-resize",
        )}
      />
    </div>
  );
}

interface PaneStaleWatcherProps {
  threadId: string;
  onStale: () => void;
}

/**
 * Watches a split pane's thread and signals when it becomes deleted (a 404 once
 * the query settles) or archived, so the pane can be pruned. Shares the same
 * react-query cache entry the pane's own view already subscribes to, so it adds
 * a subscriber, not a fetch. Renders nothing.
 */
function PaneStaleWatcher({ threadId, onStale }: PaneStaleWatcherProps) {
  const { data: thread, isSuccess, isError, error } = useThread(threadId);
  // Archive optimistically stamps `archivedAt` before the server confirms, and a
  // failed archive rolls it back — but the rollback can't restore a pane already
  // pruned from the layout. So only treat "archived" as stale when no archive
  // mutation is in flight (i.e. the archived state is server-settled). Delete,
  // by contrast, drops the query and refetches, so its 404 / `deletedAt` are
  // already server-confirmed and need no gate.
  const archivesInFlight = useIsMutating({
    predicate: (mutation) =>
      mutation.options.meta?.lifecycleOperation === "archive_thread",
  });
  const isGone =
    isError && error instanceof BbHttpError && error.status === 404;
  const isDeleted =
    isSuccess && thread !== undefined && thread.deletedAt !== null;
  const isConfirmedArchived =
    isSuccess &&
    thread !== undefined &&
    thread.archivedAt !== null &&
    archivesInFlight === 0;
  const isStale = isGone || isDeleted || isConfirmedArchived;

  // Keep the latest callback without re-arming the fire effect: it fires once
  // when staleness is first observed. Pruning unmounts this watcher (or is a
  // no-op on the last pane), so a single fire is enough.
  const onStaleRef = useRef(onStale);
  useEffect(() => {
    onStaleRef.current = onStale;
  }, [onStale]);
  useEffect(() => {
    if (isStale) {
      onStaleRef.current();
    }
  }, [isStale]);

  return null;
}

function paneKey(node: LayoutNode): string {
  return node.type === "pane"
    ? node.paneId
    : listPanes(node)
        .map((pane) => pane.paneId)
        .join("-");
}
