import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export interface SelectionAnchorPoint {
  x: number;
  y: number;
}

export type SelectionAnchorSide = "top" | "bottom";

export interface SelectionAnchor {
  point: SelectionAnchorPoint;
  side: SelectionAnchorSide;
}

export interface MessageProseSelection {
  text: string;
  rect: DOMRect;
  anchorPoint?: SelectionAnchorPoint;
  anchorSide?: SelectionAnchorSide;
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
const SELECTION_DRAG_DIRECTION_THRESHOLD_PX = 4;

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
  anchor,
  rect,
  text,
}: {
  anchor: SelectionAnchor | null;
  rect: DOMRect | null;
  text: string;
}): MessageProseSelection | null {
  if (text.length === 0 || rect === null) return null;
  const selection: MessageProseSelection = { text, rect };
  if (anchor !== null) {
    selection.anchorPoint = anchor.point;
    selection.anchorSide = anchor.side;
  }
  return selection;
}

export function anchorPointFromMouseEvent(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): SelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

export function usesLiveSelectionRange(
  pointerType: string | undefined,
): boolean {
  return (
    pointerType !== undefined && pointerType !== "" && pointerType !== "mouse"
  );
}

export function selectionAnchorFromPointerRelease(
  startPoint: SelectionAnchorPoint | null,
  releaseEvent: Pick<MouseEvent, "clientX" | "clientY"> & {
    pointerType?: string;
  },
): SelectionAnchor | null {
  // Touch and pen selection handles can keep moving after the initial pointer
  // release. Anchor those selections from the live Range rect instead of a
  // release coordinate that becomes stale as the user adjusts the handles.
  if (usesLiveSelectionRange(releaseEvent.pointerType)) {
    return null;
  }
  const releasePoint = anchorPointFromMouseEvent(releaseEvent);
  if (releasePoint === null) {
    return null;
  }

  return {
    point: releasePoint,
    side:
      startPoint !== null &&
      releasePoint.y - startPoint.y > SELECTION_DRAG_DIRECTION_THRESHOLD_PX
        ? "bottom"
        : "top",
  };
}

function readSelectionWithinNode(
  node: HTMLElement | null,
  anchor: SelectionAnchor | null,
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
    return toMessageProseSelection({ anchor, rect, text });
  }

  const text = selection.toString().trim();
  if (isSelectionBoundarySpillWithinNode(node, range, text)) {
    const rect = firstClientRect(range);
    return toMessageProseSelection({ anchor, rect, text });
  }

  return null;
}

// Every assistant message mounts one SelectableMessageProse, so per-instance
// document listeners made each tap and selectionchange dispatch O(N messages)
// handlers. The registry below keeps the per-message selection state machine
// but shares one set of document listeners and one report frame across all
// mounted instances. Node-scoped click/dblclick listeners stay per instance —
// they only fire for their own message.
interface SelectableProseInstance {
  node: HTMLElement;
  onSelectRef: {
    readonly current:
      | ((selection: MessageProseSelection | null) => void)
      | undefined;
  };
  // Only emit `null` once, after this node had reported a real selection, so
  // N messages don't thrash a shared controller.
  hadSelection: boolean;
  pendingReportAnchor: SelectionAnchor | null;
  lastPointerReleaseAnchor: SelectionAnchor | null;
  multiClickTimer: number | null;
}

const proseInstances = new Set<SelectableProseInstance>();
const instanceByNode = new Map<HTMLElement, SelectableProseInstance>();
let sharedFrame: number | null = null;
let pointerIsDown = false;
let pointerUsesLiveSelectionRange = false;
// The instance whose node contained the current pointer-down target. At most
// one instance can contain it (prose wrappers don't nest), so the registry
// tracks it once instead of a per-instance flag.
let pointerActiveInstance: SelectableProseInstance | null = null;
let pointerStartPoint: SelectionAnchorPoint | null = null;

function findInstanceContaining(
  target: EventTarget | null,
): SelectableProseInstance | null {
  if (!(target instanceof Node)) return null;
  let element = target instanceof Element ? target : target.parentElement;
  // One walk up the ancestor chain replaces a `node.contains(target)` probe
  // per mounted message on every pointerdown.
  while (element !== null) {
    const instance = instanceByNode.get(element as HTMLElement);
    if (instance !== undefined) return instance;
    element = element.parentElement;
  }
  return null;
}

function reportInstanceSelection(instance: SelectableProseInstance): void {
  const anchor = instance.pendingReportAnchor;
  instance.pendingReportAnchor = null;
  const next = readSelectionWithinNode(instance.node, anchor);
  if (next === null && !instance.hadSelection) return;
  instance.hadSelection = next !== null;
  instance.onSelectRef.current?.(next);
}

function reportInstanceNull(instance: SelectableProseInstance): void {
  instance.pendingReportAnchor = null;
  if (!instance.hadSelection) return;
  instance.hadSelection = false;
  instance.onSelectRef.current?.(null);
}

function reportAllInstances(): void {
  sharedFrame = null;
  // Read the live range once. An instance can only own or spill into the
  // selection when the range intersects its node (both acceptance paths in
  // readSelectionWithinNode require containment or intersection), so every
  // other instance takes the cheap null path without its own selection read.
  const selection = window.getSelection();
  const range =
    selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : null;
  const canPreFilter =
    range !== null && typeof range.intersectsNode === "function";
  for (const instance of proseInstances) {
    // An instance inside its multi-click delay reports when its own timer
    // fires; interleaved global triggers must not read its selection early.
    if (instance.multiClickTimer !== null) continue;
    if (
      range === null ||
      (canPreFilter && !range.intersectsNode(instance.node))
    ) {
      reportInstanceNull(instance);
      continue;
    }
    reportInstanceSelection(instance);
  }
}

function scheduleSharedReport(): void {
  if (sharedFrame !== null || proseInstances.size === 0) return;
  sharedFrame = window.requestAnimationFrame(reportAllInstances);
}

function cancelSharedFrame(): void {
  if (sharedFrame === null) return;
  window.cancelAnimationFrame(sharedFrame);
  sharedFrame = null;
}

function cancelMultiClickTimer(instance: SelectableProseInstance): void {
  if (instance.multiClickTimer === null) return;
  window.clearTimeout(instance.multiClickTimer);
  instance.multiClickTimer = null;
}

function scheduleInstanceWithAnchor(
  instance: SelectableProseInstance,
  anchor: SelectionAnchor | null,
): void {
  if (anchor !== null) {
    instance.pendingReportAnchor = anchor;
  }
  scheduleSharedReport();
}

function scheduleInstanceAfterMultiClickDelay(
  instance: SelectableProseInstance,
  anchor: SelectionAnchor | null,
): void {
  cancelMultiClickTimer(instance);
  instance.multiClickTimer = window.setTimeout(() => {
    instance.multiClickTimer = null;
    scheduleInstanceWithAnchor(instance, anchor);
  }, MULTI_CLICK_SELECTION_REPORT_DELAY_MS);
}

function handleInstanceMultiClick(
  instance: SelectableProseInstance,
  event: MouseEvent,
): void {
  if (event.detail < 2) {
    return;
  }
  const clickAnchor =
    selectionAnchorFromPointerRelease(null, event) ??
    instance.lastPointerReleaseAnchor;
  if (event.detail === 2) {
    scheduleInstanceAfterMultiClickDelay(instance, clickAnchor);
    return;
  }
  // Multi-click selection can be finalized after pointerup. Replace any
  // stale pointerup anchor with one explicitly tied to the completed click.
  cancelMultiClickTimer(instance);
  scheduleInstanceWithAnchor(instance, clickAnchor);
}

function handleInstanceDoubleClick(instance: SelectableProseInstance): void {
  scheduleInstanceAfterMultiClickDelay(
    instance,
    instance.lastPointerReleaseAnchor,
  );
}

function handleSharedSelectionChange(): void {
  // Mouse drag selections wait for release so the menu does not chase the
  // cursor. Mobile long-press selection is finalized while the touch is
  // still down, and iOS may cancel rather than release that pointer, so
  // read touch/pen ranges as soon as Selection reports them.
  if (pointerIsDown && !pointerUsesLiveSelectionRange) {
    return;
  }
  scheduleSharedReport();
}

function handleSharedPointerDown(event: PointerEvent): void {
  cancelSharedFrame();
  for (const instance of proseInstances) {
    cancelMultiClickTimer(instance);
    instance.pendingReportAnchor = null;
  }
  pointerActiveInstance = findInstanceContaining(event.target);
  pointerStartPoint =
    pointerActiveInstance !== null ? anchorPointFromMouseEvent(event) : null;
  pointerUsesLiveSelectionRange = usesLiveSelectionRange(event.pointerType);
  pointerIsDown = true;
}

function handleSharedPointerRelease(event: PointerEvent | MouseEvent): void {
  const instance = pointerActiveInstance;
  pointerActiveInstance = null;
  if (instance !== null) {
    const anchor = selectionAnchorFromPointerRelease(pointerStartPoint, event);
    if (anchor !== null) {
      instance.lastPointerReleaseAnchor = anchor;
      instance.pendingReportAnchor = anchor;
    }
  }
  pointerIsDown = false;
  pointerUsesLiveSelectionRange = false;
  pointerStartPoint = null;
  scheduleSharedReport();
}

function handleSharedPointerCancel(): void {
  pointerActiveInstance = null;
  pointerIsDown = false;
  pointerUsesLiveSelectionRange = false;
  pointerStartPoint = null;
  scheduleSharedReport();
}

function handleSharedKeyUp(): void {
  scheduleSharedReport();
}

function attachSharedDocumentListeners(): void {
  document.addEventListener("pointerdown", handleSharedPointerDown);
  document.addEventListener("pointerup", handleSharedPointerRelease);
  document.addEventListener("pointercancel", handleSharedPointerCancel);
  document.addEventListener("mouseup", handleSharedPointerRelease);
  document.addEventListener("selectionchange", handleSharedSelectionChange);
  document.addEventListener("keyup", handleSharedKeyUp);
}

function detachSharedDocumentListeners(): void {
  document.removeEventListener("pointerdown", handleSharedPointerDown);
  document.removeEventListener("pointerup", handleSharedPointerRelease);
  document.removeEventListener("pointercancel", handleSharedPointerCancel);
  document.removeEventListener("mouseup", handleSharedPointerRelease);
  document.removeEventListener("selectionchange", handleSharedSelectionChange);
  document.removeEventListener("keyup", handleSharedKeyUp);
}

function registerSelectableProseInstance(
  instance: SelectableProseInstance,
): void {
  if (proseInstances.size === 0) {
    attachSharedDocumentListeners();
  }
  proseInstances.add(instance);
  instanceByNode.set(instance.node, instance);
}

function unregisterSelectableProseInstance(
  instance: SelectableProseInstance,
): void {
  proseInstances.delete(instance);
  instanceByNode.delete(instance.node);
  cancelMultiClickTimer(instance);
  if (pointerActiveInstance === instance) {
    pointerActiveInstance = null;
  }
  if (proseInstances.size === 0) {
    detachSharedDocumentListeners();
    cancelSharedFrame();
    pointerIsDown = false;
    pointerUsesLiveSelectionRange = false;
    pointerStartPoint = null;
  }
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
    const node = nodeRef.current;
    if (node === null) return;

    const instance: SelectableProseInstance = {
      node,
      onSelectRef,
      hadSelection: false,
      pendingReportAnchor: null,
      lastPointerReleaseAnchor: null,
      multiClickTimer: null,
    };
    const handleMultiClick = (event: MouseEvent) =>
      handleInstanceMultiClick(instance, event);
    const handleDoubleClick = () => handleInstanceDoubleClick(instance);

    registerSelectableProseInstance(instance);
    node.addEventListener("click", handleMultiClick);
    node.addEventListener("dblclick", handleDoubleClick);
    return () => {
      node.removeEventListener("click", handleMultiClick);
      node.removeEventListener("dblclick", handleDoubleClick);
      unregisterSelectableProseInstance(instance);
    };
  }, []);

  return (
    <div
      ref={nodeRef}
      className={cn("select-text", className)}
      // Let compact-sidebar swipes begin over message prose, but give an
      // expanded native text selection priority over the same touch sequence.
      data-sidebar-swipe-selectable
    >
      {children}
    </div>
  );
}
