import { isInsideNativeShell } from "@/lib/native-shell/native-shell";

const BROWSER_NAVIGATION_EDGE_PX = 24;

export function browserNavigationEdgeGuardPx(): number {
  return isInsideNativeShell() ? 0 : BROWSER_NAVIGATION_EDGE_PX;
}

export function findTouchById(touches: TouchList, id: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === id) return touch;
  }
  return null;
}

export function isHorizontallyScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) return false;
  const overflowX = view.getComputedStyle(element).overflowX;
  return (
    (overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay") &&
    element.scrollWidth > element.clientWidth + 1
  );
}

export function hasTextSelectionWithin(root: Element): boolean {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  return (
    (selection.anchorNode !== null && root.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && root.contains(selection.focusNode))
  );
}

export function listenToGesture<K extends keyof GlobalEventHandlersEventMap>(
  origin: EventTarget | null,
  type: K,
  listener: (event: GlobalEventHandlersEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  let lastEvent: Event | null = null;
  const handle = (event: GlobalEventHandlersEventMap[K]) => {
    if (event === lastEvent) return;
    lastEvent = event;
    listener(event);
  };
  const targets: GlobalEventHandlers[] = [window];
  if (origin instanceof HTMLElement || origin instanceof SVGElement) {
    targets.push(origin);
  }
  for (const target of targets) {
    target.addEventListener(type, handle, options);
  }
  return () => {
    for (const target of targets) {
      target.removeEventListener(type, handle, options);
    }
  };
}
