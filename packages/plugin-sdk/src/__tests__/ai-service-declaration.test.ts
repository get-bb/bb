import { describe, expect, it } from "vitest";
import { validatePluginAiServiceDeclaration } from "../internal/host-policy.js";

const complete = async () => "a title";
const transcribe = async () => "some words";
const status = async () => ({ ready: true as const });

describe("validatePluginAiServiceDeclaration", () => {
  it("normalizes a valid declaration to a frozen copy of the contract fields", () => {
    const normalized = validatePluginAiServiceDeclaration({
      id: "acme-ai",
      displayName: "  Acme AI  ",
      complete,
      status,
      // @ts-expect-error — a non-contract field is dropped, not carried.
      extra: true,
    });
    expect(normalized).toEqual({
      id: "acme-ai",
      displayName: "Acme AI",
      complete,
      transcribe: null,
      status,
    });
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("accepts a transcribe-only service", () => {
    expect(
      validatePluginAiServiceDeclaration({
        id: "acme-voice",
        displayName: "Acme Voice",
        transcribe,
      }),
    ).toMatchObject({ complete: null, transcribe, status: null });
  });

  it.each([
    ["OpenAI", "uppercase"],
    ["a", "too short"],
    ["-acme", "leading dash"],
    ["acme_ai", "underscore"],
    ["a".repeat(65), "too long"],
  ])("rejects the id %j (%s)", (id) => {
    expect(() =>
      validatePluginAiServiceDeclaration({
        id,
        displayName: "Acme",
        complete,
      }),
    ).toThrow(/invalid AI service id/u);
  });

  it("rejects an empty or oversized displayName", () => {
    expect(() =>
      validatePluginAiServiceDeclaration({
        id: "acme-ai",
        displayName: "   ",
        complete,
      }),
    ).toThrow(/displayName must be 1-64 characters/u);
    expect(() =>
      validatePluginAiServiceDeclaration({
        id: "acme-ai",
        displayName: "x".repeat(65),
        complete,
      }),
    ).toThrow(/displayName must be 1-64 characters/u);
  });

  it("requires complete or transcribe, and functions where declared", () => {
    expect(() =>
      validatePluginAiServiceDeclaration({
        id: "acme-ai",
        displayName: "Acme",
        status,
      }),
    ).toThrow(/must declare complete, transcribe, or both/u);
    expect(() =>
      validatePluginAiServiceDeclaration({
        id: "acme-ai",
        displayName: "Acme",
        // @ts-expect-error — complete must be a function.
        complete: "nope",
      }),
    ).toThrow(/complete must be a function/u);
    expect(() =>
      validatePluginAiServiceDeclaration({
        id: "acme-ai",
        displayName: "Acme",
        complete,
        // @ts-expect-error — status must be a function.
        status: { ready: true },
      }),
    ).toThrow(/status must be a function/u);
  });
});
