import { describe, expect, it } from "vitest";
import {
  interactionPayloadSchema,
  interactionResponseSchema,
  MAX_OPTIONS,
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
} from "../src/index.js";

describe("ask-user-question contracts", () => {
  it("accepts a payload with options, previews, and free text", () => {
    const parsed = interactionPayloadSchema.safeParse({
      questions: [
        {
          id: "q1",
          prompt: "Pick a color",
          shortLabel: "Color",
          multiSelect: false,
          allowFreeText: true,
          options: [
            {
              value: "red",
              label: "Red",
              description: "Warm",
              preview: "#f00",
            },
            { value: "blue", label: "Blue" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects more than the option cap and blank free text answers", () => {
    const options = Array.from({ length: MAX_OPTIONS + 1 }, (_, index) => ({
      value: `v${index}`,
      label: `Option ${index}`,
    }));
    expect(
      interactionPayloadSchema.safeParse({
        questions: [
          {
            id: "q1",
            prompt: "Too many",
            shortLabel: "Many",
            multiSelect: true,
            allowFreeText: false,
            options,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      interactionResponseSchema.safeParse({
        answers: { q1: { selected: [], freeText: "   " } },
      }).success,
    ).toBe(false);
    expect(
      interactionResponseSchema.safeParse({
        answers: { q1: { selected: ["v1"] } },
      }).success,
    ).toBe(true);
  });
});

describe("secret-request contracts", () => {
  it("requires a dotenv destination and identifier-like names", () => {
    expect(
      secretRequestPayloadSchema.safeParse({
        purpose: null,
        destination: { kind: "dotenv", path: "/repo/.env" },
        fields: [{ name: "API_KEY", description: null }],
      }).success,
    ).toBe(true);
    expect(
      secretRequestPayloadSchema.safeParse({
        purpose: "x",
        destination: { kind: "dotenv", path: "/repo/.env" },
        fields: [{ name: "1BAD", description: null }],
      }).success,
    ).toBe(false);
  });

  it("rejects multi-line or empty values", () => {
    expect(
      secretRequestResponseSchema.safeParse({ values: { API_KEY: "abc" } })
        .success,
    ).toBe(true);
    expect(
      secretRequestResponseSchema.safeParse({ values: { API_KEY: "a\nb" } })
        .success,
    ).toBe(false);
    expect(
      secretRequestResponseSchema.safeParse({ values: { API_KEY: "" } })
        .success,
    ).toBe(false);
  });
});
