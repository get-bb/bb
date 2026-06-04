import { describe, expect, it } from "vitest";
import { bbAppManagedConfigSchema } from "../src/bb-app-managed-config.js";

describe("bbAppManagedConfigSchema", () => {
  it("parses custom models with a known provider", () => {
    const parsed = bbAppManagedConfigSchema.parse({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview[1m]",
          displayName: "Example Preview (1M)",
        },
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
    });

    expect(parsed.customModels).toHaveLength(2);
    expect(parsed.customModels?.[0]?.providerId).toBe("claude-code");
    expect(parsed.customModels?.[1]?.displayName).toBeUndefined();
  });

  it("rejects custom models with an unknown provider", () => {
    const result = bbAppManagedConfigSchema.safeParse({
      customModels: [
        { providerId: "not-a-provider", model: "claude-example-preview" },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "customModels",
        0,
        "providerId",
      ]);
    }
  });

  it("rejects custom models with an empty model id", () => {
    const result = bbAppManagedConfigSchema.safeParse({
      customModels: [{ providerId: "claude-code", model: "" }],
    });

    expect(result.success).toBe(false);
  });
});
