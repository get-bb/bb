import { describe, expect, it } from "vitest";
import {
  acpManualCompactionSchema,
  providerInfoSchema,
} from "../src/provider-types.js";

describe("ACP manual compaction schema", () => {
  it("accepts prompt and summarize-and-reseed strategies", () => {
    expect(
      acpManualCompactionSchema.parse({
        method: "prompt",
        prompt: "/compact",
      }),
    ).toEqual({ method: "prompt", prompt: "/compact" });
    expect(
      acpManualCompactionSchema.parse({
        method: "summarize-and-reseed",
        summaryPrompt: "Summarize.",
        reseedPrompt: "Restore.",
      }),
    ).toEqual({
      method: "summarize-and-reseed",
      summaryPrompt: "Summarize.",
      reseedPrompt: "Restore.",
    });
  });
});

describe("provider info schema", () => {
  const baseProviderInfo = {
    id: "codex",
    displayName: "Codex",
    logoUrl: null,
    capabilities: {
      supportsArchive: true,
      supportsManualCompaction: true,
      supportsRename: true,
      supportsServiceTier: true,
      supportsUserQuestion: false,
      supportsFork: true,
      supportedPermissionModes: ["accept-edits", "auto", "full"],
    },
    available: true,
  };

  it("requires provider-declared composer actions", () => {
    expect(() => providerInfoSchema.parse(baseProviderInfo)).toThrow();
  });

  it("accepts each composer action kind", () => {
    expect(
      providerInfoSchema.parse({
        ...baseProviderInfo,
        composerActions: [
          { kind: "skills", trigger: "/" },
          {
            kind: "plan",
            command: { trigger: "/", name: "plan", trailingText: " " },
          },
          {
            kind: "goal",
            command: { trigger: "/", name: "goal", trailingText: " " },
          },
        ],
      }).composerActions,
    ).toEqual([
      { kind: "skills", trigger: "/" },
      {
        kind: "plan",
        command: { trigger: "/", name: "plan", trailingText: " " },
      },
      {
        kind: "goal",
        command: { trigger: "/", name: "goal", trailingText: " " },
      },
    ]);
  });

  it("validates action-specific fields", () => {
    expect(() =>
      providerInfoSchema.parse({
        ...baseProviderInfo,
        composerActions: [{ kind: "skills", trigger: "$" }],
      }),
    ).toThrow();
    expect(() =>
      providerInfoSchema.parse({
        ...baseProviderInfo,
        composerActions: [
          {
            kind: "plan",
            command: { trigger: "/", name: "", trailingText: " " },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      providerInfoSchema.parse({
        ...baseProviderInfo,
        composerActions: [
          {
            kind: "goal",
            command: { trigger: "/", name: "goal now", trailingText: " " },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      providerInfoSchema.parse({
        ...baseProviderInfo,
        composerActions: [
          {
            kind: "goal",
            command: { trigger: "/", name: "goal", trailingText: " now" },
          },
        ],
      }),
    ).toThrow();
  });
});
