import { useEffect, useRef, type ReactNode } from "react";

interface SelectionAnchorPoint {
  x: number;
  y: number;
}

export interface MessageProseSelection {
  text: string;
  rect: DOMRect;
  anchorPoint?: SelectionAnchorPoint;
  sourceSeqEnd?: number;
}

export interface SelectableMessageProseProps {
  children: ReactNode;
  className?: string;
  /**
   * Reports the current in-bounds selection (or `null` when the selection is
   * empty/collapsed/outside this node). Optional so the timeline can mount
   * this wrapper before the controller that consumes selections is wired in.
   */
  onSelect?: (selection: MessageProseSelection | null) => void;
}

export const MULTI_CLICK_SELECTION_REPORT_DELAY_MS = 180;

/**
 * Pure predicate: does `selection` fall entirely within `node`?
 *
 * Extracted so it is unit-testable without a DOM/selection harness. `node`
 * and the selection nodes only need a `contains(other)` method, so this also
 * accepts lightweight fakes in tests.
 */
export function isSelectionWithinNode(
  node: Pick<Node, "contains"> | null,
  selection: {
    isCollapsed: boolean;
    anchorNode: Node | null;
    focusNode: Node | null;
    commonAncestorContainer: Node | null;
  } | null,
): boolean {
  if (node === null || selection === null) return false;
  if (selection.isCollapsed) return false;

  const { anchorNode, focusNode, commonAncestorContainer } = selection;
  if (anchorNode === null || focusNode === null) return false;

  return (
    node.contains(anchorNode) &&
    node.contains(focusNode) &&
    (commonAncestorContainer === null || node.contains(commonAncestorContainer))
  );
}

function firstClientRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect === null) {
      continue;
    }
    if (rect.width > 0 || rect.height > 0) {
      return rect;
    }
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isSelectionBoundarySpillWithinNode(
  node: HTMLElement,
  range: Range,
  selectionText: string,
): boolean {
  if (typeof range.intersectsNode !== "function") {
    return false;
  }
  if (!range.intersectsNode(node)) {
    return false;
  }

  const normalizedSelectionText = normalizeSelectionText(selectionText);
  if (normalizedSelectionText.length === 0) {
    return false;
  }

  // Triple-clicking a final paragraph can place the focus/common nodes just
  // outside this wrapper while selecting only this node's text plus newlines.
  return normalizeSelectionText(node.textContent ?? "").includes(
    normalizedSelectionText,
  );
}

function toMessageProseSelection({
  anchorPoint,
  rect,
  text,
}: {
  anchorPoint: SelectionAnchorPoint | null;
  rect: DOMRect | null;
  text: string;
}): MessageProseSelection | null {
  if (text.length === 0 || rect === null) return null;
  const selection: MessageProseSelection = { text, rect };
  if (anchorPoint !== null) {
    selection.anchorPoint = anchorPoint;
  }
  return selection;
}

function anchorPointFromMouseEvent(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): SelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

function isEventTargetWithinNode(event: Event, node: HTMLElement | null): boolean {
  if (node === null || !(event.target instanceof Node)) return false;
  return node.contains(event.target);
}

function readSelectionWithinNode(
  node: HTMLElement | null,
  anchorPoint: SelectionAnchorPoint | null,
): MessageProseSelection | null {
  if (node === null || typeof window === "undefined") return null;

  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);

  const accepted = isSelectionWithinNode(node, {
    isCollapsed: selection.isCollapsed,
    anchorNode: selection.anchorNode,
    focusNode: selection.focusNode,
    commonAncestorContainer: range.commonAncestorContainer,
  });
  if (accepted) {
    const text = selection.toString().trim();
    const rect = firstClientRect(range);
    return toMessageProseSelection({ anchorPoint, rect, text });
  }

  const text = selection.toString().trim();
  if (isSelectionBoundarySpillWithinNode(node, range, text)) {
    const rect = firstClientRect(range);
    return toMessageProseSelection({ anchorPoint, rect, text });
  }

  return null;
}

/**
 * Wraps agent prose and reports text selections whose endpoints both fall
 * inside the wrapped node. Selections that escape the node (or are collapsed)
 * report `null` so a consumer can dismiss any floating affordance.
 */
export function SelectableMessageProse({
  children,
  className,
  onSelect,
}: SelectableMessageProseProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: number | null = null;
    // Read pointer selections only after release so the floating menu does not
    // block the cursor or chase the range while the user is still dragging.
    // Only emit `null` once, after this node had reported a real selection, so
    // N messages don't thrash a shared controller.
    let hadSelection = false;
    let pointerIsDown = false;
    let pointerStartedInNode = false;
    let pendingReportAnchorPoint: SelectionAnchorPoint | null = null;
    let lastPointerReleaseAnchorPoint: SelectionAnchorPoint | null = null;
    let multiClickTimer: number | null = null;
    const report = () => {
      frame = null;
      const anchorPoint = pendingReportAnchorPoint;
      pendingReportAnchorPoint = null;
      const next = readSelectionWithinNode(nodeRef.current, anchorPoint);
      if (next === null && !hadSelection) return;
      hadSelection = next !== null;
      onSelectRef.current?.(next);
    };
    const cancelFrame = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const cancelMultiClickTimer = () => {
      if (multiClickTimer === null) return;
      window.clearTimeout(multiClickTimer);
      multiClickTimer = null;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(report);
    };
    const scheduleWithAnchorPoint = (
      anchorPoint: SelectionAnchorPoint | null,
    ) => {
      if (anchorPoint !== null) {
        pendingReportAnchorPoint = anchorPoint;
      }
      schedule();
    };
    const scheduleFresh = (anchorPoint: SelectionAnchorPoint | null = null) => {
      cancelMultiClickTimer();
      cancelFrame();
      scheduleWithAnchorPoint(anchorPoint);
    };
    const scheduleAfterMultiClickDelay = (
      anchorPoint: SelectionAnchorPoint | null = null,
    ) => {
      cancelFrame();
      cancelMultiClickTimer();
      multiClickTimer = window.setTimeout(() => {
        multiClickTimer = null;
        scheduleWithAnchorPoint(anchorPoint);
      }, MULTI_CLICK_SELECTION_REPORT_DELAY_MS);
    };
    const handleSelectionChange = () => {
      if (pointerIsDown) {
        return;
      }
      if (multiClickTimer !== null) {
        return;
      }
      schedule();
    };
    const handlePointerDown = (event: PointerEvent) => {
      cancelMultiClickTimer();
      cancelFrame();
      pendingReportAnchorPoint = null;
      pointerStartedInNode = isEventTargetWithinNode(event, nodeRef.current);
      pointerIsDown = true;
    };
    const handlePointerRelease = (event: PointerEvent | MouseEvent) => {
      const anchorPoint = pointerStartedInNode
        ? anchorPointFromMouseEvent(event)
        : null;
      if (anchorPoint !== null) {
        lastPointerReleaseAnchorPoint = anchorPoint;
      }
      pointerIsDown = false;
      pointerStartedInNode = false;
      scheduleWithAnchorPoint(anchorPoint);
    };
    const handlePointerCancel = () => {
      pointerIsDown = false;
      pointerStartedInNode = false;
      schedule();
    };
    const handleMultiClick = (event: MouseEvent) => {
      if (event.detail < 2) {
        return;
      }
      const anchorPoint =
        anchorPointFromMouseEvent(event) ?? lastPointerReleaseAnchorPoint;
      if (event.detail === 2) {
        scheduleAfterMultiClickDelay(anchorPoint);
        return;
      }
      // Multi-click selection can be finalized after pointerup. Replace any
      // stale pointerup read with one explicitly tied to the completed click.
      scheduleFresh(anchorPoint);
    };
    const handleDoubleClick = () => {
      scheduleAfterMultiClickDelay(lastPointerReleaseAnchorPoint);
    };
    const node = nodeRef.current;

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerRelease);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("mouseup", handlePointerRelease);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keyup", schedule);
    node?.addEventListener("click", handleMultiClick);
    node?.addEventListener("dblclick", handleDoubleClick);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      cancelMultiClickTimer();
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerRelease);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("mouseup", handlePointerRelease);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keyup", schedule);
      node?.removeEventListener("click", handleMultiClick);
      node?.removeEventListener("dblclick", handleDoubleClick);
    };
  }, []);

  return (
    <div ref={nodeRef} className={className}>
      {children}
    </div>
  );
}
