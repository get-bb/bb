import { describe, expect, it } from "vitest";
import {
  assertValidJsonSchema,
  parseAgentOptions,
  parseStoredAgentOptions,
} from "./validation.js";

describe("safe workflow JSON Schema subset", () => {
  it("preserves common structured-output schemas", () => {
    expect(() =>
      assertValidJsonSchema(
        {
          type: "object",
          required: ["findings"],
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                required: ["severity", "summary"],
                properties: {
                  severity: {
                    enum: ["critical", "high", "medium", "low"],
                  },
                  summary: { type: "string", minLength: 1, maxLength: 2_000 },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        "schema",
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "pattern",
      { type: "string", pattern: "^(a+)+$" },
      "catastrophic backtracking",
    ],
    [
      "patternProperties",
      { type: "object", patternProperties: { "^(a+)+$": {} } },
      "catastrophic backtracking",
    ],
    [
      "oneOf",
      { oneOf: [{ type: "string" }, { type: "number" }] },
      "multiply validation work",
    ],
    [
      "allOf",
      { allOf: [{ type: "object" }, { type: "object" }] },
      "multiply validation work",
    ],
    ["uniqueItems", { type: "array", uniqueItems: true }, "superlinearly"],
    ["$ref", { $ref: "#" }, "recursive"],
    [
      "contains",
      { type: "array", contains: { type: "string" } },
      "unbounded array",
    ],
  ])(
    "rejects host-unsafe %s schemas with an actionable reason",
    (_keyword, schema, reason) => {
      expect(() =>
        assertValidJsonSchema(schema, "agent options.outputSchema"),
      ).toThrow(new RegExp(`Node host.*QuickJS|${reason}`));
    },
  );

  it("rejects nested unsafe keywords instead of checking only the root", () => {
    expect(() =>
      assertValidJsonSchema(
        {
          type: "object",
          properties: {
            payload: { type: "string", pattern: "^(a+)+$" },
          },
        },
        "meta.outputSchema",
      ),
    ).toThrow("meta.outputSchema.properties.payload.pattern");
  });

  it("bounds enum fanout and rejects structured enum equality", () => {
    expect(() =>
      assertValidJsonSchema(
        { enum: Array.from({ length: 257 }, (_, index) => index) },
        "schema",
      ),
    ).toThrow("256-value limit");
    expect(() =>
      assertValidJsonSchema({ enum: [{ deep: true }] }, "schema"),
    ).toThrow("only scalar values");
  });

  it("retains cycle and prototype defenses before schema compilation", () => {
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    expect(() => assertValidJsonSchema(cyclic as never, "schema")).toThrow(
      "cyclic value",
    );

    const inherited = Object.create({ poisoned: true }) as Record<
      string,
      unknown
    >;
    inherited.type = "object";
    expect(() => assertValidJsonSchema(inherited as never, "schema")).toThrow(
      "unsafe prototype",
    );
  });
});

describe("workflow agent option validation", () => {
  it("resolves native aliases into one canonical internal shape", () => {
    expect(
      parseAgentOptions({
        label: "Correctness review",
        phase: "Review",
        outputSchema: { type: "object" },
      }),
    ).toEqual({
      selection: null,
      outputSchema: { type: "object" },
      title: "Correctness review",
      phase: "Review",
    });
    expect(
      parseAgentOptions({ title: "Review", label: "Review" }),
    ).toMatchObject({ title: "Review" });
    expect(
      parseAgentOptions({
        schema: { required: ["ok"], type: "object" },
      }),
    ).toMatchObject({
      outputSchema: { required: ["ok"], type: "object" },
    });
    expect(
      parseAgentOptions({
        outputSchema: { type: "object", required: ["ok"] },
        schema: { required: ["ok"], type: "object" },
      }),
    ).toMatchObject({
      outputSchema: { type: "object", required: ["ok"] },
    });
  });

  it("rejects conflicting aliases, partial selections, and invalid display values", () => {
    expect(() => parseAgentOptions({ title: "A", label: "B" })).toThrow(
      "must match",
    );
    expect(() => parseAgentOptions({ provider: "codex" })).toThrow(
      "provider, model, and reasoningLevel together",
    );
    expect(() => parseAgentOptions({ phase: "  " })).toThrow(
      "phase must be a non-empty string",
    );
    expect(() => parseAgentOptions({ label: null })).toThrow(
      "label must be a non-empty string",
    );
    expect(() =>
      parseAgentOptions({
        outputSchema: { type: "string" },
        schema: { type: "number" },
      }),
    ).toThrow("must be structurally identical");
    expect(() =>
      parseAgentOptions({ outputSchema: null, schema: { type: "null" } }),
    ).toThrow("must be structurally identical");
  });

  it("accepts legacy stored options but never accepts unresolved aliases", () => {
    expect(
      parseStoredAgentOptions({
        selection: null,
        outputSchema: null,
        title: "Worker",
      }),
    ).toEqual({
      selection: null,
      outputSchema: null,
      title: "Worker",
      phase: null,
    });
    expect(() =>
      parseStoredAgentOptions({
        selection: null,
        outputSchema: null,
        title: null,
        label: "Unresolved",
      }),
    ).toThrow();
    expect(() =>
      parseStoredAgentOptions({
        selection: null,
        outputSchema: null,
        schema: { type: "object" },
        title: null,
        phase: null,
      }),
    ).toThrow();
  });

  it("revalidates persisted output schemas before the Node service uses them", () => {
    expect(() =>
      parseStoredAgentOptions({
        selection: null,
        outputSchema: { type: "string", pattern: "^(a+)+$" },
        title: null,
        phase: null,
      }),
    ).toThrow("stored agent outputSchema.pattern");
  });
});
