import { useEffect, useRef, type ReactNode } from "react";

export interface MessageProseSelection {
  text: string;
  rect: DOMRect;
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

function readSelectionWithinNode(
  node: HTMLElement | null,
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
    return text.length > 0 && rect !== null ? { text, rect } : null;
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
    const report = () => {
      frame = null;
      const next = readSelectionWithinNode(nodeRef.current);
      if (next === null && !hadSelection) return;
      hadSelection = next !== null;
      onSelectRef.current?.(next);
    };
    const cancelFrame = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(report);
    };
    const scheduleFresh = () => {
      cancelFrame();
      schedule();
    };
    const handleSelectionChange = () => {
      if (pointerIsDown) {
        return;
      }
      schedule();
    };
    const handlePointerDown = () => {
      pointerIsDown = true;
    };
    const handlePointerEnd = () => {
      pointerIsDown = false;
      schedule();
    };
    const handleMultiClick = (event: MouseEvent) => {
      if (event.detail < 2) {
        return;
      }
      // Multi-click selection can be finalized after pointerup. Replace any
      // stale pointerup read with one explicitly tied to the completed click.
      scheduleFresh();
    };
    const node = nodeRef.current;

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    document.addEventListener("mouseup", handlePointerEnd);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keyup", schedule);
    node?.addEventListener("click", handleMultiClick);
    node?.addEventListener("dblclick", scheduleFresh);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      document.removeEventListener("mouseup", handlePointerEnd);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keyup", schedule);
      node?.removeEventListener("click", handleMultiClick);
      node?.removeEventListener("dblclick", scheduleFresh);
    };
  }, []);

  return (
    <div ref={nodeRef} className={className}>
      {children}
    </div>
  );
}
