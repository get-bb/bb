import { describe, expect, it } from "vitest";
import type { RuntimeThreadExecutionOptions } from "@bb/domain";
import { classifySessionExecutionSettingsChange } from "./execution-options.js";

const baseOptions = {
  model: "claude-opus-5[1m]",
  serviceTier: "default",
  reasoningLevel: "high",
  workflowsEnabled: true,
  memoryEnabled: true,
  providerSubagentsEnabled: true,
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
  });
});
