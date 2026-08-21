import { describe, expect, it } from "vitest";
import type { RuntimeThreadExecutionOptions } from "@bb/domain";
import {
  classifySessionExecutionSettingsChange,
  sameExecutionSettings,
  sameProviderOptions,
} from "./execution-options.js";

const baseOptions = {
  model: "claude-opus-5[1m]",
  serviceTier: "default",
  reasoningLevel: "high",
  providerOptions: { memoryEnabled: true, workflowsEnabled: true },
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} satisfies RuntimeThreadExecutionOptions;

describe("execution setting classification", () => {
  it("keeps setting changes session-scoped for adapters without live controls", () => {
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, model: "another-model" },
      }),
    ).toBe("session");
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions },
      }),
    ).toBe("unchanged");
  });

  it("treats a changed provider-options bag or prompt mode as a settings change", () => {
    expect(
      sameExecutionSettings({
        left: baseOptions,
        right: {
          ...baseOptions,
          providerOptions: { memoryEnabled: false, workflowsEnabled: true },
        },
      }),
    ).toBe(false);
    expect(
      sameExecutionSettings({
        left: baseOptions,
        right: { ...baseOptions, promptMode: "plan" },
      }),
    ).toBe(false);
  });

  it("compares provider-options bags structurally, not by key order", () => {
    // A plugin's hook may build its bag in any order; the runtime must not
    // rebuild a session because two equal bags serialize differently.
    expect(
      sameProviderOptions(
        { a: 1, nested: { x: [1, { y: "z" }], w: null } },
        { nested: { w: null, x: [1, { y: "z" }] }, a: 1 },
      ),
    ).toBe(true);
    expect(sameProviderOptions({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
