import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PluginProviderDeclaration } from "../backend-contract.js";
import { validatePluginProviderDeclaration } from "../internal/host-policy.js";

function declaration(
  overrides: Partial<PluginProviderDeclaration> = {},
): PluginProviderDeclaration {
  return {
    id: "my-agent",
    displayName: "My Agent",
    capabilities: {
      experimental_providerHealth: false,
      experimental_providerUsage: false,
      experimental_providerInstallation: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["medium"],
    },
    composerActions: [],
    ...overrides,
  };
}

describe("provider declaration target-state fields", () => {
  it("carries strings, option descriptors and extension kinds through validation", () => {
    const goalSchema = z.object({ objective: z.string() });
    const normalized = validatePluginProviderDeclaration(
      declaration({
        experimental_strings: {
          signInHint: "Run `my-agent login`.",
          expiredHint: "Session expired; run `my-agent login` again.",
          installUrl: "https://example.com/install",
          brandPrefix: "My ",
          iconTint: { light: "#123456", dark: "#abcdef" },
        },
        experimental_serviceTiers: [
          { id: "fast", label: "Fast", description: "Priority routing" },
          { id: "flex", label: "Flex" },
        ],
        experimental_reasoningLevels: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
        experimental_extensionKinds: {
          goal: { item: goalSchema, state: goalSchema },
          "permission-profile": { item: goalSchema },
        },
      }),
    );
    expect(normalized.experimental_strings).toEqual({
      signInHint: "Run `my-agent login`.",
      expiredHint: "Session expired; run `my-agent login` again.",
      installUrl: "https://example.com/install",
      brandPrefix: "My ",
      iconTint: { light: "#123456", dark: "#abcdef" },
    });
    expect(normalized.experimental_serviceTiers).toEqual([
      { id: "fast", label: "Fast", description: "Priority routing" },
      { id: "flex", label: "Flex" },
    ]);
    expect(normalized.experimental_reasoningLevels?.map((l) => l.id)).toEqual([
      "low",
      "high",
    ]);
    expect(
      Object.keys(normalized.experimental_extensionKinds ?? {}).sort(),
    ).toEqual(["goal", "permission-profile"]);
    expect(normalized.experimental_extensionKinds?.goal?.state).toBe(
      goalSchema,
    );
    expect(Object.isFrozen(normalized.experimental_strings)).toBe(true);
    expect(Object.isFrozen(normalized.experimental_serviceTiers)).toBe(true);
  });

  it("omits the fields entirely when a plugin does not declare them", () => {
    const normalized = validatePluginProviderDeclaration(declaration());
    expect("experimental_strings" in normalized).toBe(false);
    expect("experimental_serviceTiers" in normalized).toBe(false);
    expect("experimental_reasoningLevels" in normalized).toBe(false);
    expect("experimental_extensionKinds" in normalized).toBe(false);
  });

  it("rejects incomplete strings, duplicate option ids, and malformed extension kinds", () => {
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({
          // installUrl missing
          experimental_strings: {
            signInHint: "Sign in",
            expiredHint: "Expired",
          } as PluginProviderDeclaration["experimental_strings"],
        }),
      ),
    ).toThrow(/experimental_strings\.installUrl/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({
          experimental_serviceTiers: [
            { id: "fast", label: "Fast" },
            { id: "fast", label: "Also fast" },
          ],
        }),
      ),
    ).toThrow(/duplicated/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({ experimental_reasoningLevels: [] }),
      ),
    ).toThrow(/non-empty array/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({
          experimental_extensionKinds: { Goal: { item: z.object({}) } },
        }),
      ),
    ).toThrow(/name "Goal"/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({
          experimental_extensionKinds: { "my/goal": { item: z.object({}) } },
        }),
      ),
    ).toThrow(/name "my\/goal"/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({ experimental_extensionKinds: { goal: {} } }),
      ),
    ).toThrow(/item schema, a state schema, or both/u);
    expect(() =>
      validatePluginProviderDeclaration(
        declaration({
          experimental_extensionKinds: {
            goal: { item: { parse: () => ({}) } as never },
          },
        }),
      ),
    ).toThrow(/Standard Schema v1/u);
  });
});
