import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import { cn } from "@bb/shared-ui/lib/utils";
import { beginSplitDrag, type SplitDropTarget } from "@/lib/split-drag";
import {
  clampSplitPairFraction,
  computePaneRects,
  countPanes,
  listPanes,
  MAX_PANES,
  type LayoutNode,
  type SplitPath,
  type SplitSide,
} from "@/lib/split-layout";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { MACOS_APP_REGION_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import {
  createSidebarSplitState,
  focusSidebarPane,
  getSidebarGroupForPane,
  isCanonicalSidebarSplitState,
  moveSidebarPaneToSide,
  moveSidebarTab,
  parseSidebarSplitState,
  pruneSidebarSplitStorage,
  reconcileSidebarSplitState,
  reorderSidebarTab,
  replaceSidebarTab,
  resizeSidebarSplit,
  selectSidebarTab,
  serializeSidebarSplitState,
  sidebarPaneGroupId,
  sidebarSplitStorageKey,
  type SidebarSplitState,
  type SidebarTabGroup,
} from "./sidebarSplitLayout";
import type { SecondaryPanelTabReorderRequest } from "./secondaryPanelTab";

const PANE_DRAG_ENGAGE_DISTANCE_PX = 7;
type SidebarSplitResizeCursor = "col-resize" | "row-resize";

export interface SidebarSplitTabDescriptor {
  id: string;
  label: string;
}

export interface SidebarSplitPaneRenderArgs {
  group: SidebarTabGroup;
  isFocused: boolean;
  isLeftEdge: boolean;
  isTopRow: boolean;
  onBeginTabDrag: (
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onReorderTab: (request: SecondaryPanelTabReorderRequest) => void;
  onFocusPane: () => void;
  onMoveActiveTabToSide?: (side: SplitSide) => void;
  onSelectTab: (tabId: string) => void;
  paneId: string;
  showOuterControls: boolean;
}

interface SidebarSplitContainerProps {
  activeTabId: string;
  onActivateTab: (tabId: string) => void;
  onGlobalTabReorder: (request: SecondaryPanelTabReorderRequest) => void;
  panelStateId: string;
  renderPane: (args: SidebarSplitPaneRenderArgs) => ReactNode;
  tabs: readonly SidebarSplitTabDescriptor[];
}

export function SidebarSplitContainer({
  activeTabId,
  onActivateTab,
  onGlobalTabReorder,
  panelStateId,
  renderPane,
  tabs,
}: SidebarSplitContainerProps) {
  const availableTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const storageKey = sidebarSplitStorageKey(panelStateId);
  const [initialStorageValue] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(storageKey),
  );
  const [state, setState] = useState<SidebarSplitState>(() =>
    typeof window === "undefined"
      ? createSidebarSplitState(availableTabIds, activeTabId)
      : parseSidebarSplitState(
          initialStorageValue,
          availableTabIds,
          activeTabId,
        ),
  );
  const stateRef = useRef(state);
  const lastPersistedValueRef = useRef({
    storageKey,
    value: initialStorageValue,
  });
  const previousActiveTabId = useRef(activeTabId);
  const dimsInactiveSplits = useAtomValue(dimInactiveSplitsAtom);
  const [resizeCursor, setResizeCursor] =
    useState<SidebarSplitResizeCursor | null>(null);
  const paneCount = countPanes(state.layout.root);
  const hasMultiplePanes = paneCount > 1;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const previousExternalActiveTabId = previousActiveTabId.current;
    const shouldFollowExternalSelection =
      previousExternalActiveTabId !== activeTabId;
    previousActiveTabId.current = activeTabId;
    const current = stateRef.current;
    const withActiveTabReplacement =
      shouldFollowExternalSelection &&
      !availableTabIds.includes(previousExternalActiveTabId)
        ? replaceSidebarTab(current, previousExternalActiveTabId, activeTabId)
        : current;
    const reconciled = reconcileSidebarSplitState(
      withActiveTabReplacement,
      availableTabIds,
      activeTabId,
    );
    const activePane = shouldFollowExternalSelection
      ? listPanes(reconciled.layout.root).find((pane) =>
          getSidebarGroupForPane(reconciled, pane.paneId)?.tabIds.includes(
            activeTabId,
          ),
        )
      : undefined;
    const next =
      activePane === undefined
        ? reconciled
        : selectSidebarTab(reconciled, activePane.paneId, activeTabId);
    if (next !== current) {
      stateRef.current = next;
      setState(next);
    }
  }, [activeTabId, availableTabIds]);

  useEffect(() => {
    pruneSidebarSplitStorage({
      storage: window.localStorage,
      now: Date.now(),
    });
    lastPersistedValueRef.current = {
      storageKey,
      value: window.localStorage.getItem(storageKey),
    };
  }, [storageKey]);

  useEffect(() => {
    const persistedValue = isCanonicalSidebarSplitState(
      state,
      availableTabIds,
      activeTabId,
    )
      ? null
      : serializeSidebarSplitState(state);
    const previous = lastPersistedValueRef.current;
    if (
      previous.storageKey === storageKey &&
      previous.value === persistedValue
    ) {
      return;
    }
    if (persistedValue === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, persistedValue);
    }
    lastPersistedValueRef.current = { storageKey, value: persistedValue };
  }, [activeTabId, availableTabIds, state, storageKey]);

  const commitState = useCallback(
    (
      update: (current: SidebarSplitState) => SidebarSplitState,
      activateFocusedTab = false,
    ) => {
      const current = stateRef.current;
      const next = update(current);
      if (next === current) return current;
      stateRef.current = next;
      setState(next);
      if (activateFocusedTab) {
        const focusedGroup = getSidebarGroupForPane(
          next,
          next.layout.focusedPaneId,
        );
        if (focusedGroup !== null && focusedGroup.activeTabId !== activeTabId) {
          onActivateTab(focusedGroup.activeTabId);
        }
      }
      return next;
    },
    [activeTabId, onActivateTab],
  );

  const selectTab = useCallback(
    (paneId: string, tabId: string) => {
      commitState((current) => selectSidebarTab(current, paneId, tabId));
      if (tabId !== activeTabId) onActivateTab(tabId);
    },
    [activeTabId, commitState, onActivateTab],
  );

  const focusPane = useCallback(
    (paneId: string) => {
      commitState((current) => focusSidebarPane(current, paneId), true);
    },
    [commitState],
  );

  const moveActiveTabToSide = useCallback(
    (side: SplitSide) => {
      commitState((current) => {
        const paneId = current.layout.focusedPaneId;
        const sourceGroup = getSidebarGroupForPane(current, paneId);
        if (sourceGroup === null) return current;
        if (sourceGroup.tabIds.length > 1) {
          if (countPanes(current.layout.root) >= MAX_PANES) return current;
          return moveSidebarTab(
            current,
            paneId,
            sourceGroup.activeTabId,
            { paneId, zone: side },
            { groupId: nextSidebarSplitGroupId(current) },
          );
        }
        const rects = computePaneRects(current.layout.root);
        const target = listPanes(current.layout.root)
          .filter((pane) => pane.paneId !== paneId)
          .sort((first, second) => {
            const a = rects.get(first.paneId);
            const b = rects.get(second.paneId);
            if (a === undefined || b === undefined) return 0;
            const edge = (rect: typeof a) => {
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
            return edge(a) - edge(b);
          })[0];
        return target === undefined
          ? current
          : moveSidebarPaneToSide(current, paneId, target.paneId, side);
      }, true);
    },
    [commitState],
  );

  const moveTab = useCallback(
    (sourcePaneId: string, tabId: string, target: SplitDropTarget) => {
      const groupId = nextSidebarSplitGroupId(stateRef.current);
      commitState(
        (current) =>
          moveSidebarTab(current, sourcePaneId, tabId, target, {
            groupId,
          }),
        true,
      );
    },
    [commitState],
  );

  const beginTabDrag = useCallback(
    (
      sourcePaneId: string,
      tabId: string,
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) return;
      const sourceGroup = getSidebarGroupForPane(state, sourcePaneId);
      const sourceElement = event.currentTarget;
      const chrome = sourceElement.closest<HTMLElement>(
        '[data-testid="thread-secondary-panel-top-chrome"]',
      );
      const chromeRect = chrome?.getBoundingClientRect() ?? null;
      const startX = event.clientX;
      const startY = event.clientY;
      const label = tabs.find((tab) => tab.id === tabId)?.label ?? "Panel tab";
      beginSplitDrag({
        ghostLabel: label,
        sourceEl: sourceElement,
        fallback: {
          paneId: sourcePaneId,
          container: sourceElement.closest<HTMLElement>("aside"),
        },
        cancelSidebarReorderOnEngage: true,
        shouldEngage: (x, y) => {
          const dx = x - startX;
          const dy = y - startY;
          if (Math.hypot(dx, dy) <= PANE_DRAG_ENGAGE_DISTANCE_PX) return false;
          // Horizontal motion inside the tab row remains the existing reorder
          // gesture. Pulling the tab into pane content hands off to split drag.
          return (
            Math.abs(dy) > Math.abs(dx) ||
            chromeRect === null ||
            y < chromeRect.top ||
            y > chromeRect.bottom
          );
        },
        decide: (targetPaneId, zone) => {
          if (targetPaneId === sourcePaneId) {
            if (zone === "center" || (sourceGroup?.tabIds.length ?? 0) <= 1) {
              return null;
            }
          }
          if (
            zone !== "center" &&
            (sourceGroup?.tabIds.length ?? 0) > 1 &&
            countPanes(state.layout.root) >= MAX_PANES
          ) {
            return null;
          }
          return {
            zone,
            label: zone === "center" ? "Group tab here" : `Split ${zone}`,
          };
        },
        onDrop: (target) => moveTab(sourcePaneId, tabId, target),
      });
    },
    [moveTab, state, tabs],
  );

  const reorderTab = useCallback(
    (paneId: string, request: SecondaryPanelTabReorderRequest) => {
      commitState((current) =>
        reorderSidebarTab(
          current,
          paneId,
          request.activeTabId,
          request.overTabId,
        ),
      );
      onGlobalTabReorder(request);
    },
    [commitState, onGlobalTabReorder],
  );

  const resize = useCallback(
    (path: SplitPath, childIndex: number, fraction: number) => {
      commitState((current) =>
        resizeSidebarSplit(current, path, childIndex, fraction),
      );
    },
    [commitState],
  );

  const firstPane = listPanes(state.layout.root)[0];
  const focusedGroup = getSidebarGroupForPane(
    state,
    state.layout.focusedPaneId,
  );
  const canMoveActiveTabToSide =
    focusedGroup !== null &&
    (focusedGroup.tabIds.length > 1 ? paneCount < MAX_PANES : paneCount > 1);
  const activeTabPositionHandler = canMoveActiveTabToSide
    ? moveActiveTabToSide
    : undefined;
  if (!hasMultiplePanes && firstPane !== undefined) {
    const group = getSidebarGroupForPane(state, firstPane.paneId);
    if (group === null) return null;
    // renderPane is a synchronous React render callback; its handlers read refs only after pointer events.
    // oxlint-disable-next-line react/refs
    return renderPane({
      group,
      isFocused: true,
      isLeftEdge: true,
      isTopRow: true,
      onBeginTabDrag: (tabId, event) =>
        beginTabDrag(firstPane.paneId, tabId, event),
      onReorderTab: (request) => reorderTab(firstPane.paneId, request),
      onFocusPane: () => focusPane(firstPane.paneId),
      onMoveActiveTabToSide: activeTabPositionHandler,
      onSelectTab: (tabId) => selectTab(firstPane.paneId, tabId),
      paneId: firstPane.paneId,
      showOuterControls: true,
    });
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-sidebar-split-container=""
    >
      <SidebarSplitTree
        node={state.layout.root}
        path={[]}
        isLeftEdge
        isTopRow
        isRightEdge
        dimsInactiveSplits={dimsInactiveSplits}
        focusedPaneId={state.layout.focusedPaneId}
        renderPane={renderPane}
        state={state}
        onBeginTabDrag={beginTabDrag}
        onFocusPane={focusPane}
        onMoveActiveTabToSide={activeTabPositionHandler}
        onReorderTab={reorderTab}
        onResize={resize}
        onResizeDragChange={setResizeCursor}
        onSelectTab={selectTab}
      />
      <IframeDragGuardOverlay
        active={resizeCursor !== null}
        cursor={resizeCursor ?? "col-resize"}
      />
    </div>
  );
}

interface SidebarSplitTreeProps {
  dimsInactiveSplits: boolean;
  focusedPaneId: string;
  isLeftEdge: boolean;
  isRightEdge: boolean;
  isTopRow: boolean;
  node: LayoutNode;
  onBeginTabDrag: (
    paneId: string,
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onFocusPane: (paneId: string) => void;
  onMoveActiveTabToSide?: (side: SplitSide) => void;
  onReorderTab: (
    paneId: string,
    request: SecondaryPanelTabReorderRequest,
  ) => void;
  onResize: (path: SplitPath, childIndex: number, fraction: number) => void;
  onResizeDragChange: (cursor: SidebarSplitResizeCursor | null) => void;
  onSelectTab: (paneId: string, tabId: string) => void;
  path: number[];
  renderPane: (args: SidebarSplitPaneRenderArgs) => ReactNode;
  state: SidebarSplitState;
}

function SidebarSplitTree(props: SidebarSplitTreeProps) {
  if (props.node.type === "pane") {
    return <SidebarSplitLeaf {...props} pane={props.node} />;
  }
  const node = props.node;
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        node.dir === "row" ? "flex-row" : "flex-col",
      )}
    >
      {node.children.map((child, index) => (
        <Fragment key={sidebarSplitSubtreeKey(child)}>
          {index > 0 ? (
            <SidebarSplitDivider
              dir={node.dir}
              onResize={(fraction) =>
                props.onResize(props.path, index - 1, fraction)
              }
              onResizeDragChange={props.onResizeDragChange}
            />
          ) : null}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flex: `${node.sizes[index] ?? 1} 1 0px` }}
          >
            <SidebarSplitTree
              {...props}
              node={child}
              path={[...props.path, index]}
              isLeftEdge={
                props.isLeftEdge && (node.dir === "col" || index === 0)
              }
              isTopRow={props.isTopRow && (node.dir === "row" || index === 0)}
              isRightEdge={
                props.isRightEdge &&
                (node.dir === "col" || index === node.children.length - 1)
              }
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function SidebarSplitLeaf(
  props: SidebarSplitTreeProps & {
    pane: Extract<LayoutNode, { type: "pane" }>;
  },
) {
  const { pane } = props;
  const groupId = sidebarPaneGroupId(pane);
  const group = groupId === null ? undefined : props.state.groups[groupId];
  if (group === undefined) return null;
  const isFocused = pane.paneId === props.focusedPaneId;
  const showOuterControls = props.isTopRow && props.isRightEdge;
  const context: PaneContextValue = {
    paneId: pane.paneId,
    isFocused,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: showOuterControls,
    onRequestClose: null,
    isMaximized: false,
    onToggleMaximize: null,
    isBoundedPane: true,
    isTopRow: props.isTopRow,
    ownsWindowTopLeft: false,
    navigateInPane: () => {},
  };
  return (
    <PaneContext.Provider value={context}>
      <div
        onPointerDown={() => props.onFocusPane(pane.paneId)}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-split-pane-id={pane.paneId}
        data-focused={isFocused ? "true" : "false"}
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar">
          {props.renderPane({
            group,
            isFocused,
            isLeftEdge: props.isLeftEdge,
            isTopRow: props.isTopRow,
            onBeginTabDrag: (tabId, event) =>
              props.onBeginTabDrag(pane.paneId, tabId, event),
            onReorderTab: (request) => props.onReorderTab(pane.paneId, request),
            onFocusPane: () => props.onFocusPane(pane.paneId),
            onMoveActiveTabToSide: props.onMoveActiveTabToSide,
            onSelectTab: (tabId) => props.onSelectTab(pane.paneId, tabId),
            paneId: pane.paneId,
            showOuterControls,
          })}
        </section>
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
    </PaneContext.Provider>
  );
}

function SidebarSplitDivider({
  dir,
  onResize,
  onResizeDragChange,
}: {
  dir: "row" | "col";
  onResize: (fraction: number) => void;
  onResizeDragChange: (cursor: SidebarSplitResizeCursor | null) => void;
}) {
  const horizontal = dir === "row";
  const finishResizeRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      finishResizeRef.current?.();
    },
    [],
  );
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      finishResizeRef.current?.();
      const hitTarget = event.currentTarget;
      const divider = hitTarget.parentElement;
      const previous = divider?.previousElementSibling;
      const next = divider?.nextElementSibling;
      if (
        !(divider instanceof HTMLElement) ||
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      const previousRect = previous.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const pointerId = event.pointerId;
      const start = horizontal ? previousRect.left : previousRect.top;
      const end = horizontal ? nextRect.right : nextRect.bottom;
      const pointerDownPosition = horizontal ? event.clientX : event.clientY;
      const span = end - start;
      if (span <= 0) return;
      const pair = createSidebarSplitResizePair(previous, next);
      hitTarget.setPointerCapture(pointerId);
      divider.dataset.dragging = "true";
      let pendingFraction: number | null = null;
      let receivedPointerMove = false;
      let finished = false;
      const applyPointerPosition = (pointerEvent: PointerEvent) => {
        const pointer = horizontal
          ? pointerEvent.clientX
          : pointerEvent.clientY;
        const fraction = clampSplitPairFraction((pointer - start) / span);
        pendingFraction = fraction;
        pair.previous.style.flex = `${pair.total * fraction} 1 0px`;
        pair.next.style.flex = `${pair.total * (1 - fraction)} 1 0px`;
      };
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        receivedPointerMove = true;
        applyPointerPosition(moveEvent);
      };
      const finish = (commit: boolean) => {
        if (finished) return;
        finished = true;
        finishResizeRef.current = null;
        delete divider.dataset.dragging;
        hitTarget.removeEventListener("pointermove", move);
        hitTarget.removeEventListener("pointerup", onUp);
        hitTarget.removeEventListener("pointercancel", cancel);
        if (hitTarget.hasPointerCapture?.(pointerId)) {
          hitTarget.releasePointerCapture(pointerId);
        }
        onResizeDragChange(null);
        if (commit && pendingFraction !== null) {
          onResize(pendingFraction);
          return;
        }
        pair.previous.style.flex = pair.previousFlex;
        pair.next.style.flex = pair.nextFlex;
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const pointerUpPosition = horizontal
          ? upEvent.clientX
          : upEvent.clientY;
        if (!receivedPointerMove && pointerUpPosition === pointerDownPosition) {
          finish(false);
          return;
        }
        applyPointerPosition(upEvent);
        finish(true);
      };
      const cancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(false);
      };
      hitTarget.addEventListener("pointermove", move);
      hitTarget.addEventListener("pointerup", onUp);
      hitTarget.addEventListener("pointercancel", cancel);
      finishResizeRef.current = () => finish(false);
      onResizeDragChange(horizontal ? "col-resize" : "row-resize");
    },
    [horizontal, onResize, onResizeDragChange],
  );
  return (
    <div
      role="separator"
      aria-label={
        horizontal
          ? "Resize right panel panes"
          : "Resize stacked right panel panes"
      }
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      className={cn(
        "group relative z-[25] shrink-0 bg-border-seam transition-colors hover:bg-ring/40 data-[dragging]:bg-ring/40",
        MACOS_APP_REGION_NO_DRAG_CLASS,
        horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
    >
      <div
        aria-hidden
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

interface SidebarSplitResizePair {
  next: HTMLElement;
  nextFlex: string;
  previous: HTMLElement;
  previousFlex: string;
  total: number;
}

function createSidebarSplitResizePair(
  previous: HTMLElement,
  next: HTMLElement,
): SidebarSplitResizePair {
  const previousGrow = Number.parseFloat(
    window.getComputedStyle(previous).flexGrow,
  );
  const nextGrow = Number.parseFloat(window.getComputedStyle(next).flexGrow);
  return {
    next,
    nextFlex: next.style.flex,
    previous,
    previousFlex: previous.style.flex,
    total:
      Number.isFinite(previousGrow) &&
      Number.isFinite(nextGrow) &&
      previousGrow + nextGrow > 0
        ? previousGrow + nextGrow
        : 1,
  };
}

function nextSidebarSplitGroupId(state: SidebarSplitState): string {
  let sequence = 1;
  while (state.groups[`group-split-${sequence}`] !== undefined) sequence += 1;
  return `group-split-${sequence}`;
}

function sidebarSplitSubtreeKey(node: LayoutNode): string {
  return listPanes(node)
    .map((pane) => `${pane.paneId}:${sidebarPaneGroupId(pane) ?? "unknown"}`)
    .join("|");
}
