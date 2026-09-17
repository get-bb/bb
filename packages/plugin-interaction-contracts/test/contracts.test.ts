import { describe, expect, it } from "vitest";
import {
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
} from "../src/index.js";

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
