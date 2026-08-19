/**
 * One-shot "the first route content has committed" latch.
 *
 * `App.tsx` renders `RouteContentPaintSignal` inside the same Suspense
 * boundary as the lazy route views. React commits nothing inside a suspended
 * boundary on the initial mount, so the signal's effect runs exactly when the
 * first route chunk has resolved and its content is on screen. Deferred work
 * that must not compete with that first paint (plugin frontend boot) waits on
 * this instead of on system config alone.
 */
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

/** Resolves once the first route content has committed (never rejects). */
export function whenRouteContentPainted(): Promise<void> {
  return paintedPromise;
}

export function resetRouteContentPaintForTest(): void {
  painted = false;
  paintedPromise = new Promise<void>((resolve) => {
    resolvePainted = resolve;
  });
}
