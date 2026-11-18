export const SCREEN_PAINT_DEADLINE_MS = 3_000;

let painted = false;
let deadline: ReturnType<typeof setTimeout> | null = null;
let resolvePainted: (() => void) | null = null;
let paintedPromise = new Promise<void>((resolve) => {
  resolvePainted = resolve;
});

export function markScreenPainted(): void {
  if (painted) return;
  painted = true;
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  resolvePainted?.();
  resolvePainted = null;
}

export function whenScreenPainted(): Promise<void> {
  if (!painted && deadline === null) {
    deadline = setTimeout(
      markScreenPainted,
      Math.max(0, SCREEN_PAINT_DEADLINE_MS - performance.now()),
    );
  }
  return paintedPromise;
}

export function resetScreenPaintForTest(): void {
  painted = false;
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  paintedPromise = new Promise<void>((resolve) => {
    resolvePainted = resolve;
  });
}
