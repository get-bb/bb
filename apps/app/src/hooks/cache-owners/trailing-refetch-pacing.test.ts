import { describe, expect, it } from "vitest";
import { resolveTrailingRefetchDelayMs } from "./realtime-cache-registry";

describe("resolveTrailingRefetchDelayMs", () => {
  it("keeps fast threads responsive", () => {
    // A cheap build must not be penalized: the floor is what the debounce
    // already imposed before pacing existed.
    expect(resolveTrailingRefetchDelayMs(0)).toBe(50);
    expect(resolveTrailingRefetchDelayMs(12)).toBe(50);
  });

  it("waits out an expensive build so the duty cycle stays near half", () => {
    // The server rebuilds the window synchronously and blocks its event loop
    // for the duration, so refetching immediately would pin the loop at ~100%
    // and starve the daemon endpoints the agent awaits between tool calls.
    expect(resolveTrailingRefetchDelayMs(240)).toBe(240);
  });

  it("caps the delay so a pathological build cannot freeze updates", () => {
    expect(resolveTrailingRefetchDelayMs(30_000)).toBe(1_000);
  });
});
