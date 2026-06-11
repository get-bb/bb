import { describe, expect, it } from "vitest";
import {
  assertValidSchema,
  parseJsonLoose,
  stripNullOptionals,
  toClaudeOutputFormat,
  toCodexOutputSchema,
  validate,
} from "../src/schema.js";

describe("toCodexOutputSchema (strictify)", () => {
  it("tightens objects: additionalProperties false, all keys required, optionals nullable", () => {
    const strict = toCodexOutputSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
    expect(strict).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: ["number", "null"] } },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("recurses into nested objects, array items, and $defs", () => {
    const strict = toCodexOutputSchema({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
        },
        list: {
          type: "array",
          items: { type: "object", properties: { y: { type: "number" } } },
        },
        ref: { $ref: "#/$defs/thing" },
      },
      required: ["nested", "list", "ref"],
      $defs: {
        thing: { type: "object", properties: { z: { type: "string" } } },
      },
    });
    expect(strict).toEqual({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
          additionalProperties: false,
        },
        list: {
          type: "array",
          items: {
            type: "object",
            properties: { y: { type: ["number", "null"] } },
            required: ["y"],
            additionalProperties: false,
          },
        },
        ref: { $ref: "#/$defs/thing" },
      },
      required: ["nested", "list", "ref"],
      additionalProperties: false,
      $defs: {
        thing: {
          type: "object",
          properties: { z: { type: ["string", "null"] } },
          required: ["z"],
          additionalProperties: false,
        },
      },
    });
  });

  it("treats a property literally named 'properties' as data, not as a keyword map", () => {
    const strict = toCodexOutputSchema({
      type: "object",
      properties: { properties: { type: "string" } },
    });
    expect(strict).toEqual({
      type: "object",
      properties: { properties: { type: ["string", "null"] } },
      required: ["properties"],
      additionalProperties: false,
    });
  });

  it("gives optional enums a null member and wraps optional consts in anyOf", () => {
    const strict = toCodexOutputSchema({
      type: "object",
      properties: {
        e: { type: "string", enum: ["x", "y"] },
        c: { const: "z" },
      },
    });
    expect(strict).toEqual({
      type: "object",
      properties: {
        e: { type: ["string", "null"], enum: ["x", "y", null] },
        c: { anyOf: [{ const: "z" }, { type: "null" }] },
      },
      required: ["e", "c"],
      additionalProperties: false,
    });
  });

  it("leaves an object schema without properties untouched", () => {
    expect(toCodexOutputSchema({ type: "object" })).toEqual({ type: "object" });
  });

  it("does not mutate the input schema", () => {
    const input = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number", enum: [1, 2] },
      },
      required: ["a"],
    };
    const snapshot = structuredClone(input);
    toCodexOutputSchema(input);
    expect(input).toEqual(snapshot);
  });

  it("produces a schema that accepts all-keys-with-nulls and rejects missing/extra keys", () => {
    const strict = toCodexOutputSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
    expect(validate(strict, { a: "x", b: null }).ok).toBe(true);
    expect(validate(strict, { a: "x", b: 2 }).ok).toBe(true);
    expect(validate(strict, { a: "x" }).ok).toBe(false);
    expect(validate(strict, { a: "x", b: 2, extra: 1 }).ok).toBe(false);
  });
});

describe("stripNullOptionals", () => {
  it("round-trips a strict-mode value back to the author's optional schema", () => {
    const author = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    };
    const strict = toCodexOutputSchema(author);
    const modelValue = { a: "x", b: null };
    expect(validate(strict, modelValue).ok).toBe(true);
    expect(validate(author, modelValue).ok).toBe(false);

    const restored = stripNullOptionals(modelValue, author);
    expect(restored).toEqual({ a: "x" });
    expect(validate(author, restored).ok).toBe(true);
  });

  it("recurses through nested objects and arrays", () => {
    const author = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { req: { type: "string" }, opt: { type: "string" } },
            required: ["req"],
          },
        },
      },
      required: ["items"],
    };
    const restored = stripNullOptionals(
      {
        items: [
          { req: "a", opt: null },
          { req: "b", opt: "keep" },
        ],
      },
      author,
    );
    expect(restored).toEqual({
      items: [{ req: "a" }, { req: "b", opt: "keep" }],
    });
  });

  it("keeps an explicit null on a required field", () => {
    const author = {
      type: "object",
      properties: { a: { type: ["string", "null"] } },
      required: ["a"],
    };
    expect(stripNullOptionals({ a: null }, author)).toEqual({ a: null });
  });

  it("keeps an explicit null on an optional field the author declared nullable", () => {
    const author = {
      type: "object",
      properties: {
        typed: { type: ["string", "null"] },
        viaAnyOf: { anyOf: [{ type: "string" }, { type: "null" }] },
        viaEnum: { enum: ["x", null] },
      },
    };
    expect(
      stripNullOptionals(
        { typed: null, viaAnyOf: null, viaEnum: null },
        author,
      ),
    ).toEqual({
      typed: null,
      viaAnyOf: null,
      viaEnum: null,
    });
  });

  it("passes scalars and null roots through unchanged", () => {
    expect(stripNullOptionals("x", { type: "string" })).toBe("x");
    expect(stripNullOptionals(null, { type: "null" })).toBe(null);
    expect(stripNullOptionals(42, {})).toBe(42);
  });
});

describe("validate", () => {
  it("reports ok for a conforming value", () => {
    const result = validate(
      { type: "object", properties: { a: { type: "number" } } },
      { a: 1 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("reports instance paths in error messages", () => {
    const result = validate(
      {
        type: "object",
        properties: { a: { type: "number" } },
        required: ["a"],
      },
      { a: "not a number" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("/a");
  });

  it("labels root-level failures as root", () => {
    const result = validate({ type: "object" }, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("root");
  });
});

describe("assertValidSchema", () => {
  it("accepts a valid schema", () => {
    expect(() =>
      assertValidSchema({
        type: "object",
        properties: { a: { type: "string" } },
      }),
    ).not.toThrow();
  });

  it("throws on an invalid schema before any turn is spent", () => {
    expect(() =>
      assertValidSchema({ type: "definitely-not-a-type" }),
    ).toThrow();
  });
});

describe("toClaudeOutputFormat", () => {
  it("wraps the author schema verbatim", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const format = toClaudeOutputFormat(schema);
    expect(format).toEqual({ type: "json_schema", schema });
    expect(format.schema).toBe(schema);
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON, with surrounding whitespace", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose("  [1, 2]  \n")).toEqual([1, 2]);
  });

  it("parses a ```json fence", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses a bare ``` fence", () => {
    expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses a fence with prose before and after it", () => {
    expect(
      parseJsonLoose(
        'Here is the result:\n\n```json\n{"a":1}\n```\nLet me know if that works.',
      ),
    ).toEqual({ a: 1 });
  });

  it("throws on non-JSON text", () => {
    expect(() => parseJsonLoose("not json at all")).toThrow(SyntaxError);
  });
});
