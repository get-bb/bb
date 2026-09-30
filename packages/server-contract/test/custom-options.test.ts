import { describe, expect, it } from "vitest";
import {
  sendMessageRequestSchema,
  createQueuedMessageRequestSchema,
} from "../src/api/threads.js";

const input = [{ type: "text", text: "Research this" }];

describe("submission custom options", () => {
  it.each([sendMessageRequestSchema, createQueuedMessageRequestSchema])(
    "validates namespaces, JSON values and the aggregate byte limit",
    (schema) => {
      expect(
        schema.parse({
          mode: "auto",
          input,
          experimental_customOptionsByPlugin: {
            research: { mode: "research", unset: null },
          },
        }),
      ).toMatchObject({
        experimental_customOptionsByPlugin: {
          research: { mode: "research", unset: null },
        },
      });
      for (const options of [
        { "../other": {} },
        { research: [] },
        { research: { value: Infinity } },
        {
          first: { blob: "x".repeat(140000) },
          second: { blob: "x".repeat(140000) },
        },
      ]) {
        expect(
          schema.safeParse({
            mode: "auto",
            input,
            experimental_customOptionsByPlugin: options,
          }).success,
        ).toBe(false);
      }
      expect(schema.safeParse({ mode: "auto", input }).success).toBe(true);
    },
  );
});
