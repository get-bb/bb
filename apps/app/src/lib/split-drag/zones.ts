import type { SplitSide } from "@/lib/split-layout";

/** A pane drop zone: one of the four edges (split there) or the center. */
export type SplitZone = SplitSide | "center";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ZoneDecision {
  zone: SplitZone;
  label: string;
}

// Nearest-edge thresholds, mirroring the prototype: the outer 28% of the width
// on either side is a left/right split, the outer 30% of the height is a
// top/bottom split, and the remaining middle is a center (replace/swap) target.
// Left/right win over top/bottom, matching the prototype's decision order.
const EDGE_X_FRACTION = 0.28;
const EDGE_Y_FRACTION = 0.3;
const ZONE_MARGIN_PX = 5;

/**
 * Picks the drop zone for a pointer over a pane rect. Pure so the thresholds
 * and precedence can be unit-tested without a DOM.
 */
export function pickZone(rect: Rect, clientX: number, clientY: number): SplitZone {
  const px = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const py = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  if (px < EDGE_X_FRACTION) {
    return "left";
  }
  if (px > 1 - EDGE_X_FRACTION) {
    return "right";
  }
  if (py < EDGE_Y_FRACTION) {
    return "top";
  }
  if (py > 1 - EDGE_Y_FRACTION) {
    return "bottom";
  }
  return "center";
}

/** Viewport-space rectangle the drop overlay should cover for a given zone. */
export function zoneBox(rect: Rect, zone: SplitZone): Rect {
  const m = ZONE_MARGIN_PX;
  switch (zone) {
    case "left":
      return {
        left: rect.left + m,
        top: rect.top + m,
        width: rect.width / 2 - m,
        height: rect.height - 2 * m,
      };
    case "right":
      return {
        left: rect.left + rect.width / 2,
        top: rect.top + m,
        width: rect.width / 2 - m,
        height: rect.height - 2 * m,
      };
    case "top":
      return {
        left: rect.left + m,
        top: rect.top + m,
        width: rect.width - 2 * m,
        height: rect.height / 2 - m,
      };
    case "bottom":
      return {
        left: rect.left + m,
        top: rect.top + rect.height / 2,
        width: rect.width - 2 * m,
        height: rect.height / 2 - m,
      };
    case "center":
      return {
        left: rect.left + m,
        top: rect.top + m,
        width: rect.width - 2 * m,
        height: rect.height - 2 * m,
      };
  }
}

interface ThreadDropInput {
  zone: SplitZone;
  /** The dragged thread is already open in some pane. */
  threadAlreadyOpen: boolean;
  /** The layout already holds {@link MAX_PANES} panes. */
  atMaxPanes: boolean;
}

/**
 * Resolves what a sidebar-thread drop does over a pane, coercing the raw zone
 * to what the layout ops will actually allow:
 *  - already-open thread => center only, "focus that pane" (never duplicated);
 *  - at the pane cap => center only, edges can't add a pane so they replace;
 *  - otherwise => the picked zone (edge splits, center replaces).
 * The ops still enforce these invariants on drop; this only drives the label
 * and the highlighted region.
 */
export function decideThreadDrop({
  zone,
  threadAlreadyOpen,
  atMaxPanes,
}: ThreadDropInput): ZoneDecision {
  if (threadAlreadyOpen) {
    return { zone: "center", label: "Already open — focus pane" };
  }
  if (atMaxPanes) {
    return { zone: "center", label: "Replace this chat" };
  }
  return {
    zone,
    label: zone === "center" ? "Replace this chat" : `Split ${zone}`,
  };
}

interface PaneDropInput {
  zone: SplitZone;
  /** The hovered pane is the pane being dragged. */
  isSelf: boolean;
}

/**
 * Resolves what a pane-header drop does over another pane: center swaps the two
 * threads, an edge moves the dragged pane to that side (allowed even at the
 * cap — moves never change pane count). Dropping on itself is a no-op (null).
 */
export function decidePaneDrop({
  zone,
  isSelf,
}: PaneDropInput): ZoneDecision | null {
  if (isSelf) {
    return null;
  }
  return zone === "center"
    ? { zone, label: "Swap chats" }
    : { zone, label: `Move ${zone}` };
}

interface SidebarSplitDragEngageInput {
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Right edge (viewport x) of the sidebar the drag started in. */
  sidebarRightEdge: number;
  /** Minimum travel before a drag hands off to the split layer. */
  distance?: number;
}

const DEFAULT_ENGAGE_DISTANCE_PX = 12;

/**
 * Whether a sidebar-row pointer drag has crossed into the main area and should
 * hand off from dnd-kit reorder to the split-drag layer. Reorder wins until the
 * pointer both leaves the sidebar's right edge and has travelled mostly
 * horizontally past the activation distance — "when in doubt, reorder wins
 * inside the sidebar" (plan §3). Pure for unit testing the disambiguation.
 */
export function shouldEngageSidebarSplitDrag({
  startX,
  startY,
  x,
  y,
  sidebarRightEdge,
  distance = DEFAULT_ENGAGE_DISTANCE_PX,
}: SidebarSplitDragEngageInput): boolean {
  if (x <= sidebarRightEdge) {
    return false;
  }
  const dx = x - startX;
  const dy = y - startY;
  if (Math.abs(dx) <= Math.abs(dy)) {
    return false;
  }
  return Math.hypot(dx, dy) > distance;
}
