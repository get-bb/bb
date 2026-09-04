import { describe, expect, it } from "vitest";
import { parseLegacyImageGenerationCompletion } from "../src/legacy-image-generation.js";

function completion(overrides: Record<string, unknown> = {}) {
  const item = {
    failure: null,
    id: "image-1",
    result: "encoded-image",
    revisedPrompt: "Draw a blue circle",
    savedPath: "/tmp/generated.png",
    status: "completed",
    transparentBackground: true,
    type: "imageGeneration",
    ...overrides,
  };
  return {
    item,
    value: {
      rawEvent: {
        method: "item/completed",
        params: { item },
      },
      rawType: "item/completed",
    },
  };
}

describe("legacy image generation completion", () => {
  it("normalizes the legacy envelope while preserving its output item", () => {
    const { item, value } = completion();
    const parsed = parseLegacyImageGenerationCompletion(value);

    expect(parsed).toEqual({
      callId: "image-1",
      error: null,
      item,
      path: "/tmp/generated.png",
      prompt: "Draw a blue circle",
      status: "completed",
      transparentBackground: true,
    });
    expect(parsed?.item).toBe(item);
  });

  it.each([
    ["inProgress", "pending"],
    ["failed", "failed"],
    ["declined", "interrupted"],
    ["completed", "completed"],
  ] as const)("maps %s to %s", (legacyStatus, status) => {
    const { value } = completion({ status: legacyStatus });

    expect(parseLegacyImageGenerationCompletion(value)?.status).toBe(status);
  });

  it("rejects malformed and unknown envelopes", () => {
    expect(
      parseLegacyImageGenerationCompletion(
        completion({ status: "future" }).value,
      ),
    ).toBeNull();
    expect(
      parseLegacyImageGenerationCompletion(
        completion({ failure: undefined }).value,
      ),
    ).toBeNull();
    expect(
      parseLegacyImageGenerationCompletion({
        ...completion().value,
        rawType: "item/started",
      }),
    ).toBeNull();
  });
});
