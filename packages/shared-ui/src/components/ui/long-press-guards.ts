const MOVING_SCROLL_WINDOW_MS = 100;
const MOVING_SCROLL_MIN_PX_PER_MS = 0.05;
const LONG_PRESS_SHIFT_SLOP_PX = 10;

const SCROLL_SAMPLES_KEY = Symbol.for("bb.longPressGuards.scrollSamples");

interface ScrollSample {
  time: number;
  left: number;
  top: number;
}

interface ScrollSamples {
  previous: ScrollSample | null;
  latest: ScrollSample;
}

export interface LongPressOrigin {
  target: Element;
  x: number;
  y: number;
  left: number;
  top: number;
}

function scrollPosition(target: EventTarget): { left: number; top: number } {
  if (target instanceof Element) {
    return { left: target.scrollLeft, top: target.scrollTop };
  }
  if (target instanceof Document && target.scrollingElement !== null) {
    return {
      left: target.scrollingElement.scrollLeft,
      top: target.scrollingElement.scrollTop,
    };
  }
  return { left: 0, top: 0 };
}

function scrollSamples(view: Window): WeakMap<EventTarget, ScrollSamples> {
  const existing: unknown = Reflect.get(view, SCROLL_SAMPLES_KEY);
  if (existing instanceof WeakMap) {
    return existing;
  }
  const samples = new WeakMap<EventTarget, ScrollSamples>();
  Reflect.set(view, SCROLL_SAMPLES_KEY, samples);
  view.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (target === null) {
        return;
      }
      const latest = { time: view.performance.now(), ...scrollPosition(target) };
      samples.set(target, {
        previous: samples.get(target)?.latest ?? null,
        latest,
      });
    },
    { capture: true, passive: true },
  );
  return samples;
}

function isScrollerMoving(
  samples: ScrollSamples | undefined,
  now: number,
): boolean {
  if (samples === undefined || samples.previous === null) {
    return false;
  }
  const { previous, latest } = samples;
  if (now - latest.time > MOVING_SCROLL_WINDOW_MS) {
    return false;
  }
  const elapsed = latest.time - previous.time;
  if (elapsed <= 0 || elapsed > MOVING_SCROLL_WINDOW_MS) {
    return false;
  }
  const distance = Math.hypot(
    latest.left - previous.left,
    latest.top - previous.top,
  );
  return distance / elapsed >= MOVING_SCROLL_MIN_PX_PER_MS;
}

function isAncestorScrollerMoving(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    return false;
  }
  const samples = scrollSamples(view);
  const now = view.performance.now();
  if (isScrollerMoving(samples.get(element.ownerDocument), now)) {
    return true;
  }
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    if (isScrollerMoving(samples.get(node), now)) {
      return true;
    }
  }
  return false;
}

export function trackLongPressScrolls(view: Window): void {
  scrollSamples(view);
}

export function beginLongPress(
  target: Element,
  x: number,
  y: number,
): LongPressOrigin | null {
  if (isAncestorScrollerMoving(target)) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  return { target, x, y, left: rect.left, top: rect.top };
}

export function isLongPressStill(origin: LongPressOrigin): boolean {
  const rect = origin.target.getBoundingClientRect();
  return (
    Math.abs(rect.left - origin.left) <= LONG_PRESS_SHIFT_SLOP_PX &&
    Math.abs(rect.top - origin.top) <= LONG_PRESS_SHIFT_SLOP_PX
  );
}

export function isLongPressIntact(origin: LongPressOrigin): boolean {
  if (!isLongPressStill(origin)) {
    return false;
  }
  const hit = origin.target.ownerDocument.elementFromPoint(origin.x, origin.y);
  return hit !== null && origin.target.contains(hit);
}
