export const THREAD_ROUTE_PAINT_BACKSTOP_MS = 3_000;

let painted = false;
let resolvePainted: (() => void) | null = null;
let paintedPromise = new Promise<void>((resolve) => {
  resolvePainted = resolve;
});

export function markRouteContentPainted(): void {
  if (painted) return;
  painted = true;
  resolvePainted?.();
  resolvePainted = null;
}

export function markRouteContentPaintedForRoute(
  waitsForThreadTimeline: boolean,
): () => void {
  if (!waitsForThreadTimeline) {
    markRouteContentPainted();
    return () => {};
  }
  const timeoutId = setTimeout(
    markRouteContentPainted,
    THREAD_ROUTE_PAINT_BACKSTOP_MS,
  );
  return () => clearTimeout(timeoutId);
}

export function whenRouteContentPainted(): Promise<void> {
  return paintedPromise;
}

export function resetRouteContentPaintForTest(): void {
  painted = false;
  paintedPromise = new Promise<void>((resolve) => {
    resolvePainted = resolve;
  });
}
