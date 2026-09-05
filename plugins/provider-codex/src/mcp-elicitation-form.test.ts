import { describe, expect, it } from "vitest";
import {
  normalizeCodexMcpForm,
  validateCodexMcpFormContent,
} from "./mcp-elicitation-form.js";
import {
  buildCodexMcpElicitationResponse,
  normalizeCodexMcpElicitation,
} from "./mcp-elicitation.js";

const schema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 20, default: "Reader" },
    count: { type: "integer", minimum: 0, maximum: 10, default: 0 },
    price: { type: "number", minimum: 0.5, maximum: 3.5 },
    subscribed: { type: "boolean", default: false },
    color: {
      type: "string",
      enum: ["red", "blue"],
      enumNames: ["Red", "Blue"],
      default: "red",
    },
    size: {
      type: "string",
      oneOf: [
        { const: "s", title: "Small" },
        { const: "l", title: "Large" },
      ],
    },
    tags: {
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      minItems: 1,
      maxItems: 2,
      default: ["a"],
    },
    regions: {
      type: "array",
      items: {
        anyOf: [
          { const: "us", title: "United States" },
          { const: "id", title: "Indonesia" },
        ],
      },
    },
  },
  required: ["name", "count", "subscribed", "color", "tags"],
};
const fields = normalizeCodexMcpForm(schema);
const valid = {
  name: "Reader",
  count: 0,
  subscribed: false,
  color: "red",
  tags: ["a"],
};
const envelope = {
  threadId: "thread-1",
  turnId: null,
  serverName: "survey",
  message: "Tell us your preferences",
  mode: "form",
  requestedSchema: schema,
  _meta: null,
};

describe("MCP form normalization and validation", () => {
  it("normalizes every native flat field variant and preserves false and zero defaults", () => {
    expect(fields.map((field) => field.kind)).toEqual([
      "string",
      "integer",
      "number",
      "boolean",
      "enum",
      "enum",
      "multi_enum",
      "multi_enum",
    ]);
    expect(fields.find((field) => field.name === "count")).toMatchObject({
      defaultValue: 0,
      required: true,
    });
    expect(fields.find((field) => field.name === "subscribed")).toMatchObject({
      defaultValue: false,
      required: true,
    });
    expect(fields.find((field) => field.name === "size")).toMatchObject({
      options: [
        { value: "s", label: "Small" },
        { value: "l", label: "Large" },
      ],
      defaultValue: null,
      description: null,
      required: false,
    });
    expect(fields.find((field) => field.name === "regions")).toMatchObject({
      options: [
        { value: "us", label: "United States" },
        { value: "id", label: "Indonesia" },
      ],
      minItems: null,
      maxItems: null,
    });
    expect(validateCodexMcpFormContent(fields, valid)).toEqual({
      success: true,
      data: valid,
    });
  });

  it("validates required presence without filling absent defaults or coercing values", () => {
    expect(validateCodexMcpFormContent(fields, {})).toMatchObject({
      success: false,
      errors: {
        count: "This field is required.",
        subscribed: "This field is required.",
      },
      formError: null,
    });
    expect(
      validateCodexMcpFormContent(fields, { ...valid, count: "0" }),
    ).toMatchObject({
      success: false,
      errors: { count: "Enter a finite number." },
    });
    expect(
      validateCodexMcpFormContent(fields, { ...valid, subscribed: "false" }),
    ).toMatchObject({
      success: false,
      errors: { subscribed: "Choose Yes or No." },
    });
  });

  it.each([
    ["name", "", "at least 1"],
    ["name", "x".repeat(21), "at most 20"],
    ["count", 1.5, "whole number"],
    ["count", -1, "at least 0"],
    ["price", 4, "at most 3.5"],
    ["color", "green", "offered options"],
    ["size", "m", "offered options"],
    ["tags", [], "at least 1"],
    ["tags", ["a", "b", "a"], "only once"],
    ["tags", ["unknown"], "offered options"],
  ])("checks %s value %j", (name, value, error) => {
    const parsed = validateCodexMcpFormContent(fields, {
      ...valid,
      [String(name)]: value,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.errors[String(name)]).toContain(error);
  });

  it("does not count duplicate selections toward the minimum", () => {
    const selected = normalizeCodexMcpForm({
      type: "object",
      properties: {
        tags: {
          type: "array",
          minItems: 2,
          items: { type: "string", enum: ["a", "b"] },
        },
      },
    });
    expect(
      validateCodexMcpFormContent(selected, { tags: ["a", "a"] }),
    ).toMatchObject({
      success: false,
      errors: { tags: "Choose each option only once." },
    });
  });

  it.each([
    ["email", "reader@example.com", "not-email"],
    ["uri", "urn:example:reader", "not a URI"],
    ["date", "2024-02-29", "2025-02-29"],
    ["date-time", "2026-09-04T12:30:00+01:00", "2026-09-04T12:30:00"],
  ])("validates %s format", (format, accepted, rejected) => {
    const formatted = normalizeCodexMcpForm({
      type: "object",
      properties: { value: { type: "string", format } },
    });
    expect(
      validateCodexMcpFormContent(formatted, { value: accepted }).success,
    ).toBe(true);
    expect(
      validateCodexMcpFormContent(formatted, { value: rejected }).success,
    ).toBe(false);
  });

  it("counts Unicode characters rather than UTF-16 units", () => {
    const text = normalizeCodexMcpForm({
      type: "object",
      properties: { value: { type: "string", maxLength: 1 } },
    });
    expect(validateCodexMcpFormContent(text, { value: "😀" }).success).toBe(
      true,
    );
  });

  it("keeps empty and inherited property names distinct from form-wide errors", () => {
    const named = normalizeCodexMcpForm({
      type: "object",
      properties: Object.fromEntries([
        ["", { type: "boolean" }],
        ["constructor", { type: "string" }],
      ]),
      required: ["", "constructor"],
    });
    expect(validateCodexMcpFormContent(named, {})).toEqual({
      success: false,
      errors: Object.fromEntries([
        ["", "This field is required."],
        ["constructor", "This field is required."],
      ]),
      formError: null,
    });
    const content = Object.fromEntries([
      ["", false],
      ["constructor", "own value"],
    ]);
    expect(validateCodexMcpFormContent(named, content)).toEqual({
      success: true,
      data: content,
    });
    expect(
      validateCodexMcpFormContent(named, { ...content, extra: true }),
    ).toMatchObject({
      success: false,
      errors: {},
      formError: expect.any(String),
    });
  });

  it("rejects prototype keys instead of silently dropping them", () => {
    expect(() =>
      normalizeCodexMcpForm({
        type: "object",
        properties: Object.fromEntries([["__proto__", { type: "string" }]]),
      }),
    ).toThrow(/__proto__/);
    expect(
      validateCodexMcpFormContent(
        [],
        Object.fromEntries([["__proto__", "value"]]),
      ).success,
    ).toBe(false);
  });

  it.each([
    {
      type: "object",
      properties: { nested: { type: "object", properties: {} } },
    },
    {
      type: "object",
      properties: { password: { type: "string", format: "password" } },
    },
    {
      type: "object",
      properties: { count: { type: "number", minimum: 10, maximum: 1 } },
    },
    {
      type: "object",
      properties: { enabled: { type: "boolean", default: "false" } },
    },
    {
      type: "object",
      properties: { choice: { type: "string", enum: ["a"], default: "b" } },
    },
    {
      type: "object",
      properties: {
        choice: { type: "string", enum: ["a", "b"], enumNames: ["A"] },
      },
    },
    { type: "object", properties: {}, required: ["missing"] },
    {
      type: "object",
      properties: {
        tags: {
          type: "array",
          minItems: 2,
          items: { type: "string", enum: ["a"] },
        },
      },
    },
  ])("rejects unrepresentable schema %j", (requestedSchema) => {
    const result = normalizeCodexMcpElicitation({
      ...envelope,
      requestedSchema,
    }).elicitation;
    expect(result.kind).toBe("unsupported");
    expect(() =>
      buildCodexMcpElicitationResponse(result, {
        action: "accept",
        content: {},
      }),
    ).toThrow(/only be declined or cancelled/);
  });
});

describe("general elicitation modes", () => {
  it.each(["form", "openai/form", "openaiForm"])(
    "answers the standard subset in %s mode",
    (mode) => {
      const result = normalizeCodexMcpElicitation({ ...envelope, mode });
      expect(result.elicitation).toMatchObject({
        kind: "form",
        serverName: "survey",
        message: envelope.message,
      });
      expect(
        buildCodexMcpElicitationResponse(result.elicitation, {
          action: "accept",
          content: valid,
        }),
      ).toEqual({ action: "accept", content: valid, _meta: null });
      expect(() =>
        buildCodexMcpElicitationResponse(result.elicitation, {
          action: "accept",
          content: { ...valid, count: 11 },
        }),
      ).toThrow(/count/);
      expect(() =>
        buildCodexMcpElicitationResponse(result.elicitation, {
          action: "accept",
          persist: "always",
        }),
      ).toThrow(/form values/);
    },
  );

  it("preserves URL identity and produces acceptance without local form data", () => {
    const result = normalizeCodexMcpElicitation({
      ...envelope,
      mode: "url",
      url: "https://example.com/consent",
      elicitationId: "consent-1",
    }).elicitation;
    expect(result).toEqual({
      kind: "url",
      serverName: "survey",
      message: envelope.message,
      url: "https://example.com/consent",
      elicitationId: "consent-1",
    });
    expect(
      buildCodexMcpElicitationResponse(result, { action: "accept" }),
    ).toEqual({ action: "accept", content: null, _meta: null });
    expect(() =>
      buildCodexMcpElicitationResponse(result, {
        action: "accept",
        content: {},
      }),
    ).toThrow(/does not include/);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "not a URL",
  ])("does not expose unsafe URL %s", (url) => {
    expect(
      normalizeCodexMcpElicitation({
        ...envelope,
        mode: "url",
        url,
        elicitationId: "consent-1",
      }).elicitation,
    ).toMatchObject({
      kind: "unsupported",
      reason: expect.not.stringContaining("invalid_format"),
    });
  });

  it("keeps future modes visible with decline and cancel", () => {
    const result = normalizeCodexMcpElicitation({
      ...envelope,
      mode: "future-mode",
    }).elicitation;
    expect(result).toMatchObject({
      kind: "unsupported",
      nativeMode: "future-mode",
    });
    expect(
      buildCodexMcpElicitationResponse(result, { action: "decline" }),
    ).toEqual({ action: "decline", content: null, _meta: null });
    expect(
      buildCodexMcpElicitationResponse(result, { action: "cancel" }),
    ).toEqual({ action: "cancel", content: null, _meta: null });
  });
});
