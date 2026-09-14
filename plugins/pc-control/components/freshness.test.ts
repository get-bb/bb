import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS,
  freshnessDotClass,
  freshnessLabel,
  snapshotFreshness,
} from "./freshness.js";

describe("snapshot freshness", () => {
  const collectedIso = "2026-09-11T10:00:00.000Z";
  const collectedMs = Date.parse(collectedIso);

  it("is fresh while younger than the stale window", () => {
    expect(snapshotFreshness(collectedIso, collectedMs + 1)).toBe("fresh");
    expect(snapshotFreshness(collectedIso, collectedMs + STALE_AFTER_MS - 1)).toBe(
      "fresh",
    );
  });

  it("turns stale exactly at the boundary", () => {
    expect(snapshotFreshness(collectedIso, collectedMs + STALE_AFTER_MS)).toBe(
      "stale",
    );
    expect(
      snapshotFreshness(collectedIso, collectedMs + 10 * STALE_AFTER_MS),
    ).toBe("stale");
  });

  it("is stale when the timestamp is missing or malformed", () => {
    expect(snapshotFreshness(null, collectedMs)).toBe("stale");
    expect(snapshotFreshness("not-a-date", collectedMs)).toBe("stale");
  });

  it("distinguishes all reading states visually and textually", () => {
    const states = ["fresh", "stale", "error", "measuring"] as const;
    const dots = new Set(states.map((state) => freshnessDotClass(state)));
    const labels = new Set(states.map((state) => freshnessLabel(state)));
    expect(dots.size).toBe(4);
    expect(labels.size).toBe(4);
    expect(freshnessDotClass("fresh")).toBe("bg-emerald-500");
    expect(freshnessDotClass("error")).toBe("bg-destructive");
  });
});
