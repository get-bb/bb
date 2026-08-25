import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForRuntimeConditionUnsafe } from "./runtime-wait-helpers.js";

describe("waitForRuntimeConditionUnsafe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rechecks the condition after polling resumes past the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let ready = false;
    const waiting = expect(
      waitForRuntimeConditionUnsafe(() => ready, {
        label: "ready state",
        timeoutMs: 50,
        intervalMs: 10,
      }),
    ).resolves.toBeUndefined();

    ready = true;
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    await vi.runOnlyPendingTimersAsync();

    await waiting;
  });
});
