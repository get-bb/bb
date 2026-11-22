import { isIOSWebKit } from "./ios-webkit";

export const TOUCH_TEXT_SELECTION_ATTRIBUTE = "data-touch-text-selection";
export const TOUCH_SELECTION_TAP_SETTLE_MS = 400;

export function installTouchSelectionPassthrough(doc: Document): () => void {
  const view = doc.defaultView;
  if (view === null || isIOSWebKit(view.navigator)) return () => {};
  const root = doc.documentElement;
  const pointersDown = new Set<number>();
  let lastPointerIsTouch = false;
  let settleTimer: number | null = null;

  const clearSettleTimer = () => {
    if (settleTimer === null) return;
    view.clearTimeout(settleTimer);
    settleTimer = null;
  };
  const sync = () => {
    const selection = doc.getSelection();
    root.toggleAttribute(
      TOUCH_TEXT_SELECTION_ATTRIBUTE,
      lastPointerIsTouch &&
        pointersDown.size === 0 &&
        settleTimer === null &&
        selection !== null &&
        !selection.isCollapsed,
    );
  };
  const onPointerDown = (event: PointerEvent) => {
    pointersDown.add(event.pointerId);
    lastPointerIsTouch =
      event.pointerType !== "" && event.pointerType !== "mouse";
    clearSettleTimer();
    root.removeAttribute(TOUCH_TEXT_SELECTION_ATTRIBUTE);
  };
  const onPointerRelease = (event: PointerEvent) => {
    if (!pointersDown.delete(event.pointerId) || pointersDown.size > 0) return;
    clearSettleTimer();
    settleTimer = view.setTimeout(() => {
      settleTimer = null;
      sync();
    }, TOUCH_SELECTION_TAP_SETTLE_MS);
  };
  const onSelectionChange = () => {
    if (pointersDown.size === 0 && settleTimer === null) sync();
  };

  const capture = { capture: true, passive: true } as const;
  view.addEventListener("pointerdown", onPointerDown, capture);
  view.addEventListener("pointerup", onPointerRelease, capture);
  view.addEventListener("pointercancel", onPointerRelease, capture);
  doc.addEventListener("selectionchange", onSelectionChange);
  return () => {
    view.removeEventListener("pointerdown", onPointerDown, capture);
    view.removeEventListener("pointerup", onPointerRelease, capture);
    view.removeEventListener("pointercancel", onPointerRelease, capture);
    doc.removeEventListener("selectionchange", onSelectionChange);
    clearSettleTimer();
    root.removeAttribute(TOUCH_TEXT_SELECTION_ATTRIBUTE);
  };
}
