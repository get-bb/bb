import { describe, expect, it } from "vitest";
import {
  normalizeElicitationForm,
  validateElicitationFormContent,
} from "./elicitation-form.js";

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
const fields = normalizeElicitationForm(schema);
const valid = {
  name: "Reader",
  count: 0,
  subscribed: false,
  color: "red",
  tags: ["a"],
};

describe("elicitation form normalization and validation", () => {
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
    expect(validateElicitationFormContent(fields, valid)).toEqual({
      success: true,
      data: valid,
    });
  });

  it("validates required presence without filling absent defaults or coercing values", () => {
    expect(validateElicitationFormContent(fields, {})).toMatchObject({
      success: false,
      errors: {
        count: "This field is required.",
        subscribed: "This field is required.",
      },
      formError: null,
    });
    expect(
      validateElicitationFormContent(fields, { ...valid, count: "0" }),
    ).toMatchObject({
      success: false,
      errors: { count: "Enter a finite number." },
    });
    expect(
      validateElicitationFormContent(fields, { ...valid, subscribed: "false" }),
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
    const parsed = validateElicitationFormContent(fields, {
      ...valid,
      [String(name)]: value,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.errors[String(name)]).toContain(error);
  });

  it("does not count duplicate selections toward the minimum", () => {
    const selected = normalizeElicitationForm({
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
      validateElicitationFormContent(selected, { tags: ["a", "a"] }),
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
    const formatted = normalizeElicitationForm({
      type: "object",
      properties: { value: { type: "string", format } },
    });
    expect(
      validateElicitationFormContent(formatted, { value: accepted }).success,
    ).toBe(true);
    expect(
      validateElicitationFormContent(formatted, { value: rejected }).success,
    ).toBe(false);
  });

  it("counts Unicode characters rather than UTF-16 units", () => {
    const text = normalizeElicitationForm({
      type: "object",
      properties: { value: { type: "string", maxLength: 1 } },
    });
    expect(validateElicitationFormContent(text, { value: "😀" }).success).toBe(
      true,
    );
  });

  it("keeps empty and inherited property names distinct from form-wide errors", () => {
    const named = normalizeElicitationForm({
      type: "object",
      properties: Object.fromEntries([
        ["", { type: "boolean" }],
        ["constructor", { type: "string" }],
      ]),
      required: ["", "constructor"],
    });
    expect(validateElicitationFormContent(named, {})).toEqual({
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
    expect(validateElicitationFormContent(named, content)).toEqual({
      success: true,
      data: content,
    });
    expect(
      validateElicitationFormContent(named, { ...content, extra: true }),
    ).toMatchObject({
      success: false,
      errors: {},
      formError: expect.any(String),
    });
  });

  it("rejects prototype keys instead of silently dropping them", () => {
    expect(() =>
      normalizeElicitationForm({
        type: "object",
        properties: Object.fromEntries([["__proto__", { type: "string" }]]),
      }),
    ).toThrow(/__proto__/);
    expect(
      validateElicitationFormContent(
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
    expect(() => normalizeElicitationForm(requestedSchema)).toThrow();
  });
});
