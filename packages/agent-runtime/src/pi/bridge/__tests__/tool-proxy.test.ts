import { describe, expect, it } from "vitest";
import { buildDynamicTools } from "../tool-proxy.js";

describe("tool-proxy", () => {
  it("returns ordered image and text content to Pi", async () => {
    const [tool] = buildDynamicTools(
      [
        {
          name: "browser_screenshot",
          description: "Capture the browser.",
          inputSchema: { type: "object" },
        },
      ],
      async () => ({
        content: "after",
        contentBlocks: [
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          { type: "text", text: "after" },
        ],
        images: [{ data: "iVBORw0KGgo=", mimeType: "image/png" }],
      }),
    );

    const result = await Reflect.apply(tool.execute, tool, [
      "call-1",
      {},
      undefined,
    ]);
    expect(result.content).toEqual([
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      { type: "text", text: "after" },
    ]);
  });

  it("throws forwarded failures so Pi marks the tool result as an error", async () => {
    const [tool] = buildDynamicTools(
      [
        {
          name: "broken_tool",
          description: "Fail.",
          inputSchema: { type: "object" },
        },
      ],
      async () => ({ content: "permission denied", isError: true }),
    );

    await expect(
      Reflect.apply(tool.execute, tool, ["call-1", {}, undefined]),
    ).rejects.toThrow("permission denied");
  });

  it("preserves required and optional scalar fields", () => {
    const [tool] = buildDynamicTools(
      [
        {
          name: "lookup",
          description: "Lookup a record",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              verbose: { type: "boolean" },
            },
            required: ["id"],
          },
        },
      ],
      async () => ({ content: "ok" }),
    );

    expect(tool.parameters).toMatchObject({
      type: "object",
      properties: {
        id: { type: "string" },
        verbose: { type: "boolean" },
      },
      required: ["id"],
    });
  });

  it("converts nested objects, arrays, and enums recursively", () => {
    const [tool] = buildDynamicTools(
      [
        {
          name: "complex",
          description: "Complex schema",
          inputSchema: {
            type: "object",
            properties: {
              filters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    operator: { enum: ["eq", "ne"] },
                  },
                  required: ["field", "operator"],
                },
              },
              settings: {
                type: "object",
                properties: {
                  mode: { enum: ["fast", "accurate"] },
                  retries: { type: "integer" },
                },
                required: ["mode"],
              },
            },
            required: ["filters"],
          },
        },
      ],
      async () => ({ content: "ok" }),
    );

    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["filters"],
      properties: {
        filters: {
          type: "array",
          items: {
            type: "object",
            required: ["field", "operator"],
            properties: {
              field: { type: "string" },
              operator: {
                anyOf: [
                  { const: "eq", type: "string" },
                  { const: "ne", type: "string" },
                ],
              },
            },
          },
        },
        settings: {
          type: "object",
          required: ["mode"],
          properties: {
            mode: {
              anyOf: [
                { const: "fast", type: "string" },
                { const: "accurate", type: "string" },
              ],
            },
            retries: { type: "number" },
          },
        },
      },
    });
  });
});
