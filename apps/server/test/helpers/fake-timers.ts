import { expect, vi } from "vitest";

const MAX_ADVANCE_STEPS = 50;

export async function advanceUntilSettled<T>(
  promise: Promise<T>,
  stepMs: number,
): Promise<T> {
  let settled = false;
  const tracked = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  for (let step = 0; step < MAX_ADVANCE_STEPS && !settled; step += 1) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  expect(
    settled,
    "The promise never settled while the fake clock advanced",
  ).toBe(true);
  return tracked;
}

export async function advanceUntilTrue(
  predicate: () => boolean,
  stepMs: number,
): Promise<void> {
  for (let step = 0; step < MAX_ADVANCE_STEPS && !predicate(); step += 1) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  expect(
    predicate(),
    "The expected state never arrived while the fake clock advanced",
  ).toBe(true);
}
