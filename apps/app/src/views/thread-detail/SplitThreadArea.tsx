import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANE_FOCUS_APP_COMMAND_IDS } from "@bb/domain";
import { useAtom, useStore } from "jotai";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useRouteState } from "@/hooks/useRouteState";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { useIsMutating } from "@tanstack/react-query";
import { HttpError } from "@/lib/api";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
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
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";
import { RootComposeView } from "@/views/RootComposeView";
import { PluginPanelView } from "@/views/PluginPanelView";
import {
  AppPageHeader,
  HEADER_ICON_BUTTON_CLASS,
} from "@/components/layout/AppPageHeader";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import {
  getAdjacentPaneId,
  getPaneIdAtReadingIndex,
} from "./splitPaneCommands";
import {
  createSinglePaneLayout,
  focusedPaneRoute,
  paneContentRoute,
  reconcileLayoutForContent,
  threadPaneContent,
} from "./splitThreadNavigation";
import { ThreadDetailWorkerPoolProvider } from "./ThreadDetailWorkerPoolProvider";

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
 * Renders the 1–4 thread panes that live in the main content area. It bridges
 * the URL-follows-focus and external-navigation policies between the global
 * split-layout atom and the route, then recursively draws the layout tree.
 * A single pane renders identically to the pre-split page surface (no wrapper,
 * no focus ring); compact viewports disable splits entirely.
 */
interface SplitThreadAreaProps {
  routeContent?: PaneContent;
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
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const navigate = useNavigate();
  const store = useStore();
  const [storedLayout, setLayout] = useAtom(splitLayoutAtom);

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
  const isSplitActive = threadSplitsEnabled && !isCompact && panes.length > 1;

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
      if (pane !== null) {
        navigate(paneContentRoute(pane.content), { replace: true });
      }
    },
    [layout, navigate, setLayout],
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
      if (next.focusedPaneId !== layout.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) {
          navigate(route, { replace: true });
        }
      }
    },
    [layout, navigate, setLayout],
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
      if (next.focusedPaneId !== current.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) {
          navigate(route, { replace: true });
        }
      }
    },
    [navigate, store],
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
    [navigate, store],
  );

  // A disabled experiment and compact viewports both render the route thread as
  // single page surface (byte-identical to the pre-split page). The layout atom
  // is preserved so the arrangement returns when the gate opens again.
  if (
    !threadSplitsEnabled ||
    isCompact ||
    layout === null ||
    currentContent === null
  ) {
    return currentContent ? (
      <StandalonePaneContent content={currentContent} />
    ) : null;
  }

  const commandHandlers = (
    <SplitPaneCommandHandlers
      closePane={closePane}
      focusPane={focusPane}
      isSplitActive={isSplitActive}
      layout={layout}
      panes={panes}
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
          canShowSecondaryPanel
          onRequestClose={null}
          isBoundedPane={false}
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
      <div className="-m-4 flex min-h-0 min-w-0 flex-1 overflow-hidden md:-m-5">
        <SplitTree
          node={layout.root}
          path={EMPTY_PATH}
          focusedPaneId={layout.focusedPaneId}
          paneCount={panes.length}
          onFocusPane={focusPane}
          onClosePane={closePane}
          onResize={resize}
          onNavigateInPane={navigateInPane}
          onBeginPaneDrag={beginPaneDrag}
          onPruneStalePane={pruneStalePane}
        />
      </div>
    </>
  );
}

interface SplitPaneCommandHandlersProps {
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  isSplitActive: boolean;
  layout: SplitLayout;
  panes: readonly PaneNode[];
}

/** Mounted only while the experiment is enabled, so OFF unregisters commands. */
function SplitPaneCommandHandlers({
  closePane,
  focusPane,
  isSplitActive,
  layout,
  panes,
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
  return null;
}

interface SplitTreeProps {
  node: LayoutNode;
  path: SplitPath;
  focusedPaneId: string;
  paneCount: number;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
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
  const { node, path, focusedPaneId, paneCount } = props;

  if (node.type === "pane") {
    const isFocused = node.paneId === focusedPaneId;
    return (
      <div
        onPointerDown={() => props.onFocusPane(node.paneId)}
        // Flush tiles: no rounding, outer edges flush; a straight recessed
        // gutter separates panes (see SplitDivider). Bounded panes suppress
        // the content's page-bleed negative margins (see
        // PaneContextValue.isBoundedPane) so content fills the tile exactly.
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-split-pane-id={node.paneId}
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
          // ≥3 panes have no room for two secondary panels: only the focused
          // pane may show its own; ≤2 panes keep per-pane panels.
          canShowSecondaryPanel={paneCount < 3 || isFocused}
          onRequestClose={() => props.onClosePane(node.paneId)}
          isBoundedPane
          onNavigateInPane={props.onNavigateInPane}
          onBeginPaneDrag={props.onBeginPaneDrag}
        />
        {/* The inactive-pane scrim lives on an overlay ABOVE the pane's content
            because styles painted on the pane element itself get covered by
            children with opaque backgrounds (header scrim, composer). */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-20 transition-colors",
            isFocused ? "bg-transparent" : "bg-background/40",
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
              onResize={(fraction) => props.onResize(path, index - 1, fraction)}
            />
          ) : null}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${node.sizes[index] ?? 1} 1 0` }}
          >
            <SplitTree {...props} node={child} path={[...path, index]} />
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
  canShowSecondaryPanel: boolean;
  onRequestClose: (() => void) | null;
  // True inside multi-pane split cards; suppresses the page-bleed margins so
  // content fills the card exactly (see PaneContextValue.isBoundedPane).
  isBoundedPane: boolean;
  onNavigateInPane: NavigateInPane;
  // Absent for the single-pane surface — a lone pane has nothing to reorder.
  onBeginPaneDrag?: BeginPaneDrag;
}

function WorkspacePaneContent({
  content,
  paneId,
  isFocused,
  canShowSecondaryPanel,
  onRequestClose,
  isBoundedPane,
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
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId,
      isFocused,
      canShowSecondaryPanel,
      onRequestClose,
      isBoundedPane,
      navigateInPane,
      beginPaneDrag,
    }),
    [
      beginPaneDrag,
      canShowSecondaryPanel,
      isBoundedPane,
      isFocused,
      navigateInPane,
      onRequestClose,
      paneId,
    ],
  );

  if (content.kind !== "thread") {
    return (
      <NonThreadPaneContent
        content={content}
        onRequestClose={onRequestClose}
        beginPaneDrag={beginPaneDrag}
        isBoundedPane={isBoundedPane}
      />
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

function StandalonePaneContent({ content }: { content: PaneContent }) {
  if (content.kind === "thread") {
    return <ThreadDetailView surface="page" />;
  }
  if (content.kind === "new-thread") {
    return <RootComposeView isBoundedPane={false} surface="page" />;
  }
  return (
    <PluginPanelView
      pluginId={content.pluginId}
      panelPath={content.panelPath}
      subPath={content.subPath}
    />
  );
}

function NonThreadPaneContent({
  content,
  onRequestClose,
  beginPaneDrag,
  isBoundedPane,
}: {
  content: Exclude<PaneContent, { kind: "thread" }>;
  onRequestClose: (() => void) | null;
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
  isBoundedPane: boolean;
}) {
  const { navPanels } = usePluginSlots();
  const panel =
    content.kind === "plugin-panel"
      ? navPanels.find(
          (candidate) =>
            candidate.pluginId === content.pluginId &&
            candidate.path === content.panelPath,
        )
      : undefined;
  const label = panel?.title ?? "New thread";
  const handlePointerDown = (event: ReactPointerEvent) => {
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
      {onRequestClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={HEADER_ICON_BUTTON_CLASS}
          aria-label="Close pane"
          onClick={onRequestClose}
        >
          <Icon name="X" />
        </Button>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        content.kind === "plugin-panel" && !isBoundedPane && "-m-4 md:-m-5",
      )}
    >
      {isBoundedPane || panel ? (
        <AppPageHeader
          bordered={false}
          className="border-b border-border-seam-vertical/60"
          center={
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center",
                beginPaneDrag && "cursor-grab touch-none select-none",
              )}
              onPointerDown={beginPaneDrag ? handlePointerDown : undefined}
            >
              {panel ? (
                <PluginPanelHeaderCenter panel={panel} />
              ) : (
                <p className="truncate text-sm font-medium">New thread</p>
              )}
            </div>
          }
          actions={actions}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-5">
        {content.kind === "new-thread" ? (
          <RootComposeView isBoundedPane={isBoundedPane} surface="page" />
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
}

interface SplitDividerProps {
  dir: "row" | "col";
  onResize: (fraction: number) => void;
}

function SplitDivider({ dir, onResize }: SplitDividerProps) {
  const horizontal = dir === "row";

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const divider = event.currentTarget;
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      divider.setPointerCapture(event.pointerId);
      divider.dataset.dragging = "true";

      const onMove = (moveEvent: PointerEvent) => {
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const start = horizontal ? previousRect.left : previousRect.top;
        const end = horizontal ? nextRect.right : nextRect.bottom;
        const span = end - start;
        if (span <= 0) {
          return;
        }
        const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
        // Fraction of the adjacent pair claimed by the first child; resizeSplit
        // clamps it into [0.15, 0.85].
        onResize((pointer - start) / span);
      };
      const onUp = () => {
        delete divider.dataset.dragging;
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
      };
      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
    },
    [horizontal, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={handlePointerDown}
      className={cn(
        // A straight 6px gutter between flush tiles — squared ends, no
        // rounding, only BETWEEN splits (outer edges stay flush). The gutter
        // is softly recessed so it reads against the identical pane
        // backgrounds; hover/drag warms it as the resize affordance. The
        // absolutely-positioned child widens the grab target without
        // consuming layout space.
        "group relative z-[5] flex-shrink-0 bg-muted/60 transition-colors",
        "hover:bg-ring/40 data-[dragging]:bg-ring/40",
        horizontal ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "absolute",
          horizontal ? "-inset-x-1 inset-y-0" : "inset-x-0 -inset-y-1",
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
  const isGone = isError && error instanceof HttpError && error.status === 404;
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
