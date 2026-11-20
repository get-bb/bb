import { describe, expect, it } from "vitest";
import {
  decideProviderFallback,
  findExhaustedUsageWindow,
} from "../src/provider-fallback.js";

const NOW = Date.parse("2026-11-21T10:00:00.000Z");
const LATER = "2026-11-21T12:00:00.000Z";
const EARLIER = "2026-11-21T09:00:00.000Z";

describe("findExhaustedUsageWindow", () => {
  it.each<[string, unknown[], string | null, string | null]>([
    [
      "a full window that resets later",
      [{ label: "Weekly limit", usedPercent: 100, resetsAt: LATER }],
      null,
      "Weekly limit",
    ],
    [
      "a full window with an unknown reset",
      [{ label: "Weekly limit", usedPercent: 100, resetsAt: null }],
      null,
      "Weekly limit",
    ],
    [
      "a window below 100%",
      [{ label: "Weekly limit", usedPercent: 99, resetsAt: LATER }],
      null,
      null,
    ],
    [
      "a full window that already reset",
      [{ label: "Current session", usedPercent: 100, resetsAt: EARLIER }],
      null,
      null,
    ],
    [
      "a full model window for another model",
      [{ label: "Fable", model: "fable", usedPercent: 100, resetsAt: LATER }],
      "claude-opus-5-5",
      null,
    ],
    [
      "a full model window for this model",
      [{ label: "Fable", model: "fable", usedPercent: 100, resetsAt: LATER }],
      "claude-fable-5-2",
      "Fable",
    ],
    [
      "a full model window when the model is unknown",
      [{ label: "Fable", model: "fable", usedPercent: 100, resetsAt: LATER }],
      null,
      null,
    ],
    ["a malformed window", [{ label: "Weekly limit" }], null, null],
  ])("%s", (_, windows, model, expected) => {
    expect(
      findExhaustedUsageWindow(windows, { model, now: NOW })?.label ?? null,
    ).toBe(expected);
  });

  it("returns the reset time of the full window", () => {
    expect(
      findExhaustedUsageWindow(
        [
          { label: "Current session", usedPercent: 40, resetsAt: LATER },
          { label: "Weekly limit", usedPercent: 100, resetsAt: LATER },
        ],
        { model: null, now: NOW },
      ),
    ).toEqual({ label: "Weekly limit", resetsAt: LATER });
  });
});

describe("decideProviderFallback", () => {
  const full = {
    status: "ok",
    windows: [{ label: "Weekly limit", usedPercent: 100, resetsAt: LATER }],
  };
  const fine = {
    status: "ok",
    windows: [{ label: "Weekly limit", usedPercent: 10, resetsAt: LATER }],
  };
  const base = {
    providerId: "claude-code",
    model: "claude-opus-5-5",
    fallbackProviderId: "codex",
    fallbackSelectable: true,
    providerUsage: full,
    fallbackUsage: fine,
    now: NOW,
  };

  it("picks the fallback when the default is out of usage", () => {
    expect(decideProviderFallback(base)).toEqual({
      providerId: "codex",
      fromProviderId: "claude-code",
      exhausted: { label: "Weekly limit", resetsAt: LATER },
    });
  });

  it("allows a fallback that reports no usage", () => {
    expect(
      decideProviderFallback({ ...base, fallbackUsage: null })?.providerId,
    ).toBe("codex");
  });

  it.each([
    ["no fallback is set", { fallbackProviderId: null }],
    ["the fallback is the default", { fallbackProviderId: "claude-code" }],
    ["the fallback is not selectable", { fallbackSelectable: false }],
    ["the default has usage left", { providerUsage: fine }],
    ["the default usage is unknown", { providerUsage: { status: "error" } }],
    ["the fallback is out of usage too", { fallbackUsage: full }],
  ])("keeps the default when %s", (_, change) => {
    expect(decideProviderFallback({ ...base, ...change })).toBeNull();
  });
});
