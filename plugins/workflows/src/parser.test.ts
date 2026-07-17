import { describe, expect, it } from "vitest";
import { inspectWorkflowSource, parseWorkflowSource } from "./parser.js";
import { MAX_WORKFLOW_SOURCE_BYTES } from "./validation.js";

const META = `export const meta = {
  name: "review-code",
  description: "Review a change",
  inputSchema: { type: "object" },
  outputSchema: { type: "array", items: { type: "string" } },
};`;

describe("workflow parser", () => {
  it("extracts literal metadata and executable body", () => {
    expect(
      parseWorkflowSource(`${META}\nreturn await agent(args.prompt);`),
    ).toEqual({
      metadata: {
        name: "review-code",
        description: "Review a change",
        inputSchema: { type: "object" },
        outputSchema: { type: "array", items: { type: "string" } },
        phases: [],
      },
      body: "return await agent(args.prompt);",
    });
  });

  it("requires literal metadata first", () => {
    expect(() => parseWorkflowSource("return 1;")).toThrow("must begin");
    expect(() =>
      parseWorkflowSource(`export const meta = makeMeta();\nreturn 1;`),
    ).toThrow("must begin");
  });

  it.each([
    ['import fs from "node:fs";', "Imports"],
    ['await import("node:fs");', "Dynamic imports"],
    ['require("node:fs");', "require"],
    ["return process.env;", "process"],
    ['return (() => {}).constructor("return process")();', "prototype access"],
    ["return new Date();", "Date"],
    ["return Date.now();", "Date"],
    ["return Math.random();", "Math.random"],
  ])("rejects unsafe body %s", (body, message) => {
    expect(() => parseWorkflowSource(`${META}\n${body}`)).toThrow(message);
  });

  it("reports safely discoverable literal selections", () => {
    expect(
      inspectWorkflowSource(`${META}\nreturn agent("x", {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
        title: dynamicTitle,
      });`).literalSelections,
    ).toMatchObject([
      {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ]);
  });

  it("rejects nonliteral and partial literal selections", () => {
    expect(() =>
      parseWorkflowSource(`${META}\nreturn agent("x", {
        provider: selectedProvider,
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      });`),
    ).toThrow("non-empty string literal");
    expect(() =>
      parseWorkflowSource(
        `${META}\nreturn agent("x", { provider: "codex", model: "gpt" });`,
      ),
    ).toThrow("provider, model, and reasoningLevel together");
  });

  it("rejects hidden controls and oversized UTF-8 source", () => {
    expect(() => parseWorkflowSource(`${META}\nreturn "a\u200Bb";`)).toThrow(
      "hidden control character U+200B",
    );
    expect(() =>
      parseWorkflowSource(
        `${META}\n/*${"é".repeat(MAX_WORKFLOW_SOURCE_BYTES)}*/return null;`,
      ),
    ).toThrow("exceeds");
  });

  it("enforces all-or-none model selection in literal agent options", () => {
    expect(() =>
      parseWorkflowSource(`${META}\nreturn agent("x", { provider: "codex" });`),
    ).toThrow("provider, model, and reasoningLevel together");

    expect(() =>
      parseWorkflowSource(`${META}\nreturn agent("x", {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
        outputSchema: { type: "object" },
      });`),
    ).not.toThrow();
  });

  it("parses strict literal phase metadata in declaration order", () => {
    const parsed = parseWorkflowSource(`export const meta = {
      name: "phased-workflow",
      description: "Uses declared phases",
      phases: [
        { title: "Inspect", detail: "Read the implementation" },
        { title: "Verify" },
      ],
    };
    return null;`);

    expect(parsed.metadata.phases).toEqual([
      { title: "Inspect", detail: "Read the implementation" },
      { title: "Verify", detail: null },
    ]);
  });

  it.each([
    ["{}", "must be an array"],
    ["null", "must be an array"],
    ["[null]", "must be an object"],
    ['[{ title: "" }]', "title must be a non-empty string"],
    ['[{ title: "Inspect", detail: "" }]', "detail must be a non-empty"],
    ['[{ title: "Inspect", detail: null }]', "detail must be a non-empty"],
    ['[{ title: "Inspect", extra: true }]', "Unknown meta.phases[0] field"],
    ['[{ title: "Inspect" }, { title: "Inspect" }]', "duplicate title"],
  ])("rejects invalid phase metadata %s", (phases, message) => {
    expect(() =>
      parseWorkflowSource(`export const meta = {
        name: "bad-phases",
        description: "bad",
        phases: ${phases},
      };
      return null;`),
    ).toThrow(message);
  });

  it("accepts native agent aliases and rejects conflicting duplicates", () => {
    expect(() =>
      parseWorkflowSource(`${META}
        return agent("x", {
          label: "Review",
          phase: "Inspect",
          schema: { type: "object", required: ["ok"] },
        });`),
    ).not.toThrow();
    expect(() =>
      parseWorkflowSource(`${META}
        return agent("x", {
          outputSchema: { type: "object", required: ["ok"] },
          schema: { required: ["ok"], type: "object" },
        });`),
    ).not.toThrow();
    expect(() =>
      parseWorkflowSource(`${META}
        return agent("x", { title: "Review", label: "Different" });`),
    ).toThrow("must match");
    expect(() =>
      parseWorkflowSource(`${META}
        return agent("x", { phase: "" });`),
    ).toThrow("phase must be a non-empty string");
    expect(() =>
      parseWorkflowSource(`${META}
        return agent("x", {
          outputSchema: { type: "string" },
          schema: { type: "number" },
        });`),
    ).toThrow("must be structurally identical");
  });

  it("rejects invalid JSON Schemas", () => {
    expect(() =>
      parseWorkflowSource(`export const meta = {
        name: "bad-schema",
        description: "bad",
        outputSchema: { type: "not-a-json-schema-type" },
      };\nreturn null;`),
    ).toThrow("not a valid JSON Schema");
  });
});
