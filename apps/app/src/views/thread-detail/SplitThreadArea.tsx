import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { useAtom } from "jotai";
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
  findPane,
  listPanes,
  removePane,
  replacePaneContent,
  resizeSplit,
  setFocus,
} from "@/lib/split-layout";
import type {
  LayoutNode,
  PaneContent,
  SplitLayout,
  SplitPath,
} from "@/lib/split-layout";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";
import {
  createSinglePaneLayout,
  focusedThreadRoute,
  reconcileLayoutForRoute,
  threadPaneContent,
} from "./splitThreadNavigation";

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

  // Compact viewport disables splits entirely — render the route thread as the
  // single page surface (byte-identical to the pre-split page). The layout atom
  // is preserved so the arrangement returns when the viewport widens again.
  if (isCompact || layout === null) {
    return <ThreadDetailView surface="page" />;
  }

  const panes = listPanes(layout.root);
  const firstPane = panes[0];
  if (panes.length === 1 && firstPane !== undefined) {
    // Single pane: no wrapper chrome, no focus ring — DOM-identical to page.
    return (
      <ThreadPaneContent
        content={firstPane.content}
        paneId={firstPane.paneId}
        isFocused
        canShowSecondaryPanel
        onRequestClose={null}
        onNavigateInPane={navigateInPane}
      />
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
}

function ThreadPaneContent({
  content,
  paneId,
  isFocused,
  canShowSecondaryPanel,
  onRequestClose,
  onNavigateInPane,
}: ThreadPaneContentProps) {
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => onNavigateInPane(paneId, thread),
    [onNavigateInPane, paneId],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId,
      isFocused,
      canShowSecondaryPanel,
      onRequestClose,
      navigateInPane,
    }),
    [canShowSecondaryPanel, isFocused, navigateInPane, onRequestClose, paneId],
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
