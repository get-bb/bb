import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANE_FOCUS_APP_COMMAND_IDS } from "@bb/domain";
import { useAtom, useStore } from "jotai";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadRoutePath, type ThreadRoutePathArgs } from "@/lib/route-paths";
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
import {
  getAdjacentPaneId,
  getPaneIdAtReadingIndex,
} from "./splitPaneCommands";
import {
  createSinglePaneLayout,
  focusedThreadRoute,
  reconcileLayoutForRoute,
  threadPaneContent,
} from "./splitThreadNavigation";

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
export function SplitThreadArea() {
  const { projectId, threadId } = useRouteState();
  const isCompact = useIsCompactViewport();
  const navigate = useNavigate();
  const store = useStore();
  const [storedLayout, setLayout] = useAtom(splitLayoutAtom);

  const routeThread = useMemo<ThreadRoutePathArgs | null>(
    () => (projectId && threadId ? { projectId, threadId } : null),
    [projectId, threadId],
  );

  // Fold external navigation (initial load, sidebar click, deep link) into the
  // layout. The reconcile is idempotent, so a URL that already matches the
  // focused pane is a no-op — no history spam, no render loop.
  useEffect(() => {
    if (routeThread === null) {
      return;
    }
    setLayout((previous) => reconcileLayoutForRoute(previous, routeThread));
  }, [routeThread, setLayout]);

  // Effective layout for render/handlers before the effect seeds the atom.
  const layout: SplitLayout | null =
    storedLayout ?? (routeThread ? createSinglePaneLayout(routeThread) : null);
  const panes = layout === null ? [] : listPanes(layout.root);
  const isSplitActive = !isCompact && panes.length > 1;

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
      if (pane !== null && pane.content.kind === "thread") {
        navigate(
          getThreadRoutePath({
            projectId: pane.content.projectId,
            threadId: pane.content.threadId,
          }),
          { replace: true },
        );
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
        const route = focusedThreadRoute(next);
        if (route !== null) {
          navigate(getThreadRoutePath(route), { replace: true });
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
          const route = focusedThreadRoute(next);
          if (route !== null) {
            navigate(getThreadRoutePath(route), { replace: true });
          }
        },
      });
    },
    [navigate, store],
  );

  useAppCommandContext("splitActive", isSplitActive);
  useAppCommandHandler("pane.focus.previous", () => {
    if (!isSplitActive || layout === null) {
      return false;
    }
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, -1);
    if (paneId !== null) {
      focusPane(paneId);
    }
    return true;
  });
  useAppCommandHandler("pane.focus.next", () => {
    if (!isSplitActive || layout === null) {
      return false;
    }
    const paneId = getAdjacentPaneId(panes, layout.focusedPaneId, 1);
    if (paneId !== null) {
      focusPane(paneId);
    }
    return true;
  });
  useIndexedAppCommandHandlers(PANE_FOCUS_APP_COMMAND_IDS, (index) => {
    if (!isSplitActive) {
      return false;
    }
    const paneId = getPaneIdAtReadingIndex(panes, index);
    if (paneId !== null) {
      focusPane(paneId);
    }
    return true;
  });
  useAppCommandHandler("pane.close", () => {
    if (!isSplitActive || layout === null) {
      return false;
    }
    closePane(layout.focusedPaneId);
    return true;
  });

  // Compact viewport disables splits entirely — render the route thread as the
  // single page surface (byte-identical to the pre-split page). The layout atom
  // is preserved so the arrangement returns when the viewport widens again.
  if (isCompact || layout === null) {
    return <ThreadDetailView surface="page" />;
  }

  const firstPane = panes[0];
  if (panes.length === 1 && firstPane !== undefined) {
    // Single pane: no focus ring, no pane chrome. A bare, full-bleed wrapper
    // carries only the pane-id hit-test hook so a sidebar thread can be dropped
    // onto it to create the first split; it adds no visual chrome vs. the page.
    return (
      <div
        className="flex h-full min-h-0 w-full min-w-0"
        data-split-pane-id={firstPane.paneId}
      >
        <ThreadPaneContent
          content={firstPane.content}
          paneId={firstPane.paneId}
          isFocused
          canShowSecondaryPanel
          onRequestClose={null}
          onNavigateInPane={navigateInPane}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
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
      />
    </div>
  );
}

interface SplitTreeProps {
  node: LayoutNode;
  path: SplitPath;
  focusedPaneId: string;
  paneCount: number;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onResize: (splitPath: SplitPath, childIndex: number, fraction: number) => void;
  onNavigateInPane: NavigateInPane;
  onBeginPaneDrag: BeginPaneDrag;
}

function SplitTree(props: SplitTreeProps) {
  const { node, path, focusedPaneId, paneCount } = props;

  if (node.type === "pane") {
    const isFocused = node.paneId === focusedPaneId;
    return (
      <div
        onPointerDown={() => props.onFocusPane(node.paneId)}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
          isFocused && "ring-1 ring-inset ring-ring",
        )}
        data-split-pane-id={node.paneId}
      >
        <ThreadPaneContent
          content={node.content}
          paneId={node.paneId}
          isFocused={isFocused}
          // ≥3 panes have no room for two secondary panels: only the focused
          // pane may show its own; ≤2 panes keep per-pane panels.
          canShowSecondaryPanel={paneCount < 3 || isFocused}
          onRequestClose={() => props.onClosePane(node.paneId)}
          onNavigateInPane={props.onNavigateInPane}
          onBeginPaneDrag={props.onBeginPaneDrag}
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

interface ThreadPaneContentProps {
  content: PaneContent;
  paneId: string;
  isFocused: boolean;
  canShowSecondaryPanel: boolean;
  onRequestClose: (() => void) | null;
  onNavigateInPane: NavigateInPane;
  // Absent for the single-pane surface — a lone pane has nothing to reorder.
  onBeginPaneDrag?: BeginPaneDrag;
}

function ThreadPaneContent({
  content,
  paneId,
  isFocused,
  canShowSecondaryPanel,
  onRequestClose,
  onNavigateInPane,
  onBeginPaneDrag,
}: ThreadPaneContentProps) {
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
      navigateInPane,
      beginPaneDrag,
    }),
    [
      beginPaneDrag,
      canShowSecondaryPanel,
      isFocused,
      navigateInPane,
      onRequestClose,
      paneId,
    ],
  );

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
      if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) {
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
        "group relative z-[5] flex-shrink-0",
        horizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute rounded-full bg-transparent transition-colors",
          "group-hover:bg-border group-data-[dragging]:bg-border",
          horizontal ? "inset-x-[3px] inset-y-[20%]" : "inset-x-[20%] inset-y-[3px]",
        )}
      />
    </div>
  );
}

function paneKey(node: LayoutNode): string {
  return node.type === "pane"
    ? node.paneId
    : listPanes(node)
        .map((pane) => pane.paneId)
        .join("-");
}
