import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { NODE_STATE_LABELS, type NodeKind, type TreeNode } from "../src/model";
import { formatRelativeTime } from "../src/time";
import { DRAFT_HEIGHT, NodeDraftCard, type NodeDraft } from "./node-draft-card";
import {
  KIND_LABELS,
  STATE_CARD_CLASS,
  STATE_DOT_CLASS,
  kindChipClass,
  stateChipClass,
} from "./node-visuals";

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 92;
const CANVAS_PADDING = 48;
const LINK_HANDLE_SIZE = 14;
const CLICK_SLOP = 4;
const DRAFT_GAP_X = 32;
const DRAFT_GAP_Y = 32;

const HANDLE_CLASS =
  "absolute z-10 rounded-full border border-border bg-card text-2xs leading-none text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Position {
  x: number;
  y: number;
}

type DragState =
  | {
      kind: "move";
      nodeId: string;
      pointerId: number;
      grabX: number;
      grabY: number;
      position: Position;
    }
  | {
      kind: "link";
      parentId: string;
      pointerId: number;
      origin: Position;
      position: Position;
    }
  | {
      kind: "pan";
      pointerId: number;
      clientX: number;
      clientY: number;
      scrollLeft: number;
      scrollTop: number;
    };

const MIDDLE_BUTTON = 1;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest(
      "input, textarea, select, button, [role='button'], [contenteditable='true']",
    ) !== null
  );
}

export interface GraphCanvasProps {
  nodes: readonly TreeNode[];
  now: number;
  selectedNodeId: string | null;
  draft: NodeDraft | null;
  busy: boolean;
  onSelect: (nodeId: string) => void;
  onMove: (args: { nodeId: string; x: number; y: number }) => void;
  onConnect: (args: { parentId: string; childId: string }) => void;
  onDisconnect: (args: { parentId: string; childId: string }) => void;
  onDraftOpen: (draft: NodeDraft) => void;
  onDraftCancel: () => void;
  onDraftSubmit: (args: { title: string; kind: NodeKind }) => void;
}

function edgePath(from: Position, to: Position): string {
  const startX = from.x + NODE_WIDTH / 2;
  const startY = from.y + NODE_HEIGHT;
  const endX = to.x + NODE_WIDTH / 2;
  const endY = to.y;
  const midY = (startY + endY) / 2;
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

export function GraphCanvas({
  nodes,
  now,
  selectedNodeId,
  draft,
  busy,
  onSelect,
  onMove,
  onConnect,
  onDisconnect,
  onDraftOpen,
  onDraftCancel,
  onDraftSubmit,
}: GraphCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const movedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [grabMode, setGrabMode] = useState(false);

  /*
   * Holding space turns the whole canvas into a hand, the way Figma and
   * Excalidraw do it, so a big tree can be dragged around even where cards
   * cover the background.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setGrabMode(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setGrabMode(false);
    };
    const onBlur = () => setGrabMode(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const basePositions = useMemo(() => {
    const positions = new Map<string, Position>();
    for (const node of nodes) positions.set(node.id, { x: node.x, y: node.y });
    return positions;
  }, [nodes]);

  const positionOf = useCallback(
    (nodeId: string): Position => {
      if (drag?.kind === "move" && drag.nodeId === nodeId) return drag.position;
      return basePositions.get(nodeId) ?? { x: 0, y: 0 };
    },
    [basePositions, drag],
  );

  const anchorNode = useMemo(() => {
    if (draft === null || draft.anchor === "canvas") return null;
    return nodes.find((node) => node.id === draft.nodeId) ?? null;
  }, [draft, nodes]);

  /*
   * A parent belongs above its child, and the canvas has no room above the top
   * row, so everything slides down by the shortfall for as long as the draft is
   * open. The shift is only a preview; the layout that runs once the task is
   * added is what makes the room real.
   */
  const draftShiftY = useMemo(() => {
    if (draft?.anchor !== "parent" || anchorNode === null) return 0;
    const top = positionOf(anchorNode.id).y - DRAFT_HEIGHT - DRAFT_GAP_Y;
    return Math.max(0, -top);
  }, [anchorNode, draft, positionOf]);

  /**
   * Where the draft card sits, in node coordinates. It shows the relationship
   * being drawn rather than where the task will end up, because the layout runs
   * as soon as it is added.
   */
  const draftPlacement = useMemo((): { left: number; top: number } | null => {
    if (draft === null) return null;
    if (draft.anchor === "canvas") {
      let bottom = 0;
      for (const node of nodes) {
        bottom = Math.max(bottom, positionOf(node.id).y + NODE_HEIGHT);
      }
      return { left: 0, top: bottom === 0 ? 0 : bottom + DRAFT_GAP_Y };
    }
    if (anchorNode === null) return null;
    const anchor = positionOf(anchorNode.id);
    if (draft.anchor === "child") {
      return { left: anchor.x, top: anchor.y + NODE_HEIGHT + DRAFT_GAP_Y };
    }
    if (draft.anchor === "sibling") {
      return { left: anchor.x + NODE_WIDTH + DRAFT_GAP_X, top: anchor.y };
    }
    return {
      left: anchor.x,
      top: anchor.y - DRAFT_HEIGHT - DRAFT_GAP_Y + draftShiftY,
    };
  }, [anchorNode, draft, draftShiftY, nodes, positionOf]);

  const bounds = useMemo(() => {
    let width = NODE_WIDTH;
    let height = NODE_HEIGHT;
    for (const node of nodes) {
      const position = positionOf(node.id);
      width = Math.max(width, position.x + NODE_WIDTH);
      height = Math.max(height, position.y + NODE_HEIGHT + draftShiftY);
    }
    if (draftPlacement !== null) {
      width = Math.max(width, draftPlacement.left + NODE_WIDTH);
      height = Math.max(
        height,
        draftPlacement.top + DRAFT_HEIGHT + draftShiftY,
      );
    }
    return {
      width: width + CANVAS_PADDING,
      height: height + CANVAS_PADDING,
    };
  }, [draftPlacement, draftShiftY, nodes, positionOf]);

  const pointerPosition = useCallback(
    (event: ReactPointerEvent<HTMLElement>): Position => {
      const rect = contentRef.current?.getBoundingClientRect();
      if (rect === undefined) return { x: 0, y: 0 };
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top - draftShiftY,
      };
    },
    [draftShiftY],
  );

  const nodeAt = useCallback(
    (point: Position): TreeNode | null => {
      for (const node of nodes) {
        const position = positionOf(node.id);
        if (
          point.x >= position.x &&
          point.x <= position.x + NODE_WIDTH &&
          point.y >= position.y &&
          point.y <= position.y + NODE_HEIGHT
        ) {
          return node;
        }
      }
      return null;
    },
    [nodes, positionOf],
  );

  const capturePointer = useCallback((pointerId: number) => {
    const content = contentRef.current;
    if (content === null || typeof content.setPointerCapture !== "function") {
      return;
    }
    try {
      content.setPointerCapture(pointerId);
    } catch {
      return;
    }
  }, []);

  const releasePointer = useCallback((pointerId: number) => {
    const content = contentRef.current;
    if (
      content === null ||
      typeof content.releasePointerCapture !== "function"
    ) {
      return;
    }
    try {
      content.releasePointerCapture(pointerId);
    } catch {
      return;
    }
  }, []);

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: TreeNode) => {
      if (event.button !== 0 || grabMode) return;
      event.stopPropagation();
      const point = pointerPosition(event);
      const position = positionOf(node.id);
      movedRef.current = false;
      capturePointer(event.pointerId);
      setDrag({
        kind: "move",
        nodeId: node.id,
        pointerId: event.pointerId,
        grabX: point.x - position.x,
        grabY: point.y - position.y,
        position,
      });
    },
    [capturePointer, grabMode, pointerPosition, positionOf],
  );

  /*
   * A press that reaches the surface itself is a press on nothing: empty
   * canvas, the middle button, or any card while space is held. All three mean
   * "drag the view", which is the scroll container moving under the content.
   */
  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") return;
      if (event.button !== 0 && event.button !== MIDDLE_BUTTON) return;
      const viewport = viewportRef.current;
      if (viewport === null) return;
      if (event.button === MIDDLE_BUTTON) event.preventDefault();
      capturePointer(event.pointerId);
      setDrag({
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      });
    },
    [capturePointer],
  );

  const handleLinkPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, node: TreeNode) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointerPosition(event);
      movedRef.current = false;
      capturePointer(event.pointerId);
      setDrag({
        kind: "link",
        parentId: node.id,
        pointerId: event.pointerId,
        origin: point,
        position: point,
      });
    },
    [capturePointer, pointerPosition],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag === null || drag.pointerId !== event.pointerId) return;
      if (drag.kind === "pan") {
        const viewport = viewportRef.current;
        if (viewport === null) return;
        viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX);
        viewport.scrollTop = drag.scrollTop - (event.clientY - drag.clientY);
        return;
      }
      const point = pointerPosition(event);
      if (drag.kind === "move") {
        const next = {
          x: Math.max(0, point.x - drag.grabX),
          y: Math.max(0, point.y - drag.grabY),
        };
        const base = basePositions.get(drag.nodeId);
        if (
          base !== undefined &&
          (Math.abs(base.x - next.x) > CLICK_SLOP ||
            Math.abs(base.y - next.y) > CLICK_SLOP)
        ) {
          movedRef.current = true;
        }
        setDrag({ ...drag, position: next });
        return;
      }
      if (
        Math.abs(point.x - drag.origin.x) > CLICK_SLOP ||
        Math.abs(point.y - drag.origin.y) > CLICK_SLOP
      ) {
        movedRef.current = true;
      }
      setDrag({ ...drag, position: point });
    },
    [basePositions, drag, pointerPosition],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag === null || drag.pointerId !== event.pointerId) return;
      releasePointer(event.pointerId);
      if (drag.kind === "pan") {
        setDrag(null);
        return;
      }
      if (drag.kind === "move") {
        if (movedRef.current) {
          onMove({
            nodeId: drag.nodeId,
            x: Math.round(drag.position.x),
            y: Math.round(drag.position.y),
          });
        } else {
          onSelect(drag.nodeId);
        }
        setDrag(null);
        return;
      }
      /*
       * The handle under a task does double duty: dragged onto another task it
       * makes that task a dependent, and pressed without travelling it opens a
       * draft for a new one.
       */
      if (!movedRef.current) {
        onDraftOpen({ anchor: "child", nodeId: drag.parentId });
        setDrag(null);
        return;
      }
      const target = nodeAt(pointerPosition(event));
      if (target !== null && target.id !== drag.parentId) {
        onConnect({ parentId: drag.parentId, childId: target.id });
      }
      setDrag(null);
    },
    [
      drag,
      nodeAt,
      onConnect,
      onDraftOpen,
      onMove,
      onSelect,
      pointerPosition,
      releasePointer,
    ],
  );

  const edges = useMemo(
    () =>
      nodes.flatMap((node) =>
        node.dependsOn.map((parentId) => ({ parentId, childId: node.id })),
      ),
    [nodes],
  );

  const draftCard =
    draft === null || draftPlacement === null ? null : (
      <NodeDraftCard
        draft={draft}
        anchorTitle={anchorNode?.title ?? null}
        disabled={busy}
        onCancel={onDraftCancel}
        onSubmit={onDraftSubmit}
      />
    );

  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center overflow-auto p-6">
        <div style={{ width: NODE_WIDTH }}>
          {draftCard === null ? (
            <button
              type="button"
              onClick={() => onDraftOpen({ anchor: "canvas" })}
              style={{ height: NODE_HEIGHT }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:border-ring hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="Plus" className="size-3.5" aria-hidden />
              New task
            </button>
          ) : (
            draftCard
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="h-full min-h-0 w-full overflow-auto">
      <div
        ref={contentRef}
        role="presentation"
        className={cn(
          "relative select-none",
          drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ width: bounds.width, height: bounds.height }}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translateY(${draftShiftY}px)` }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={bounds.width}
            height={bounds.height}
            aria-hidden
          >
            {edges.map((edge) => (
              <path
                key={`${edge.parentId}-${edge.childId}`}
                d={edgePath(
                  positionOf(edge.parentId),
                  positionOf(edge.childId),
                )}
                className="fill-none stroke-border"
                strokeWidth={2}
              />
            ))}
            {drag?.kind === "link" && movedRef.current ? (
              <path
                d={edgePath(positionOf(drag.parentId), {
                  x: drag.position.x - NODE_WIDTH / 2,
                  y: drag.position.y,
                })}
                className="fill-none stroke-primary"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            ) : null}
            {draftPlacement !== null &&
            anchorNode !== null &&
            draft !== null &&
            draft.anchor !== "sibling" ? (
              <path
                d={
                  draft.anchor === "child"
                    ? edgePath(positionOf(anchorNode.id), {
                        x: draftPlacement.left,
                        y: draftPlacement.top,
                      })
                    : edgePath(
                        {
                          x: draftPlacement.left,
                          y: draftPlacement.top + DRAFT_HEIGHT - NODE_HEIGHT,
                        },
                        positionOf(anchorNode.id),
                      )
                }
                className="fill-none stroke-ring"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            ) : null}
          </svg>

          {edges.map((edge) => {
            if (
              selectedNodeId !== edge.parentId &&
              selectedNodeId !== edge.childId
            ) {
              return null;
            }
            const from = positionOf(edge.parentId);
            const to = positionOf(edge.childId);
            const left = (from.x + to.x) / 2 + NODE_WIDTH / 2 - 10;
            const top = (from.y + NODE_HEIGHT + to.y) / 2 - 10;
            const parent = nodes.find((node) => node.id === edge.parentId);
            const child = nodes.find((node) => node.id === edge.childId);
            return (
              <button
                key={`remove-${edge.parentId}-${edge.childId}`}
                type="button"
                className="absolute z-10 flex size-5 items-center justify-center rounded-full border border-border bg-card text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
                style={{ left, top }}
                aria-label={`Remove the dependency from ${parent?.title ?? edge.parentId} to ${child?.title ?? edge.childId}`}
                onPointerDown={(event) => {
                  if (!grabMode) event.stopPropagation();
                }}
                onClick={() =>
                  onDisconnect({
                    parentId: edge.parentId,
                    childId: edge.childId,
                  })
                }
              >
                ×
              </button>
            );
          })}

          {nodes.map((node) => {
            const position = positionOf(node.id);
            const isSelected = node.id === selectedNodeId;
            return (
              <div
                key={node.id}
                className={cn(
                  "absolute rounded-md border shadow-xs",
                  grabMode ? "cursor-grab" : "cursor-pointer",
                  STATE_CARD_CLASS[node.state],
                  isSelected && "ring-2 ring-ring",
                  ((drag?.kind === "move" && drag.nodeId === node.id) ||
                    drag?.kind === "pan") &&
                    "cursor-grabbing",
                )}
                style={{
                  left: position.x,
                  top: position.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                }}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
              >
                <button
                  type="button"
                  aria-label={node.title}
                  aria-current={isSelected ? "true" : undefined}
                  className="block h-full w-full p-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelect(node.id);
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        node.state === "blocked"
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {node.title}
                    </span>
                    <span className={kindChipClass(node.kind)}>
                      {KIND_LABELS[node.kind]}
                    </span>
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <span className={cn("flex", stateChipClass(node.state))}>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          STATE_DOT_CLASS[node.state],
                        )}
                        aria-hidden
                      />
                      {NODE_STATE_LABELS[node.state]}
                    </span>
                    <span className="shrink-0 text-2xs text-subtle-foreground">
                      {formatRelativeTime({ timestamp: node.updatedAt, now })}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-2xs text-subtle-foreground">
                    {node.artifactFile}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`New parent task for ${node.title}`}
                  className={cn(
                    HANDLE_CLASS,
                    "-top-2 left-1/2 -translate-x-1/2",
                  )}
                  style={{ width: LINK_HANDLE_SIZE, height: LINK_HANDLE_SIZE }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() =>
                    onDraftOpen({ anchor: "parent", nodeId: node.id })
                  }
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label={`New task depending on ${node.title}, or drag onto another task`}
                  className={cn(
                    HANDLE_CLASS,
                    "-bottom-2 left-1/2 -translate-x-1/2 cursor-crosshair",
                  )}
                  style={{ width: LINK_HANDLE_SIZE, height: LINK_HANDLE_SIZE }}
                  onPointerDown={(event) => handleLinkPointerDown(event, node)}
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label={`New task beside ${node.title}`}
                  className={cn(
                    HANDLE_CLASS,
                    "-right-2 top-1/2 -translate-y-1/2",
                  )}
                  style={{ width: LINK_HANDLE_SIZE, height: LINK_HANDLE_SIZE }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() =>
                    onDraftOpen({ anchor: "sibling", nodeId: node.id })
                  }
                >
                  +
                </button>
              </div>
            );
          })}

          {draftPlacement === null || draftCard === null ? null : (
            <div
              className="absolute z-20 cursor-auto"
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                left: draftPlacement.left,
                top: draftPlacement.top,
                width: NODE_WIDTH,
              }}
            >
              {draftCard}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
