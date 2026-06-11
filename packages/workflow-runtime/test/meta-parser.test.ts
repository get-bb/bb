import { describe, expect, it } from "vitest";
import {
  parseMeta,
  parseMetaLiteral,
  WorkflowSyntaxError,
} from "../src/meta-parser.js";

declare global {
  // Incremented by the canary fixtures below if any evaluator actually executes them.
  var __workflowMetaParserCanary: number;
}

describe("parseMetaLiteral", () => {
  it("parses every pure-literal value kind", () => {
    const src = `{
      // line comment inside the literal
      name: "double",
      single: 'single',
      template: \`backtick\`,
      "string key": "ok",
      /* block comment */
      int: 42,
      negative: -2.5,
      leadingDot: .5,
      exponent: 1.5e-2,
      yes: true,
      no: false,
      nothing: null,
      nested: { deep: { list: [1, "two", { three: 3 }] } },
      trailing: [1, 2, 3,],
    }`;
    expect(parseMetaLiteral(src)).toEqual({
      name: "double",
      single: "single",
      template: "backtick",
      "string key": "ok",
      int: 42,
      negative: -2.5,
      leadingDot: 0.5,
      exponent: 0.015,
      yes: true,
      no: false,
      nothing: null,
      nested: { deep: { list: [1, "two", { three: 3 }] } },
      trailing: [1, 2, 3],
    });
  });

  it("decodes string escape sequences like the vm path did", () => {
    const src = String.raw`{ a: "line\nbreak", b: "quote\"end", c: "A\x42", d: "\u{1F600}", e: '\\' }`;
    expect(parseMetaLiteral(src)).toEqual({
      a: "line\nbreak",
      b: 'quote"end',
      c: "AB",
      d: "\u{1F600}",
      e: "\\",
    });
  });

  it("allows an escaped dollar-brace in a template string", () => {
    expect(parseMetaLiteral("{ a: `costs \\${5}` }")).toEqual({
      a: "costs ${5}",
    });
  });

  it("keeps last-wins semantics for duplicate keys", () => {
    expect(parseMetaLiteral(`{ a: 1, a: 2 }`)).toEqual({ a: 2 });
  });

  it("rejects __proto__ keys instead of setting the result's prototype", () => {
    // `result["__proto__"] = value` on a default-prototype object would set the
    // prototype, smuggling values past strictObject's unknown-key check.
    for (const src of [
      `{ __proto__: { whenToUse: "smuggled" } }`,
      `{ "__proto__": { whenToUse: "smuggled" } }`,
      `{ a: { "\\u005f\\u005fproto__": 1 } }`,
    ]) {
      expect(() => parseMetaLiteral(src)).toThrow(WorkflowSyntaxError);
      expect(() => parseMetaLiteral(src)).toThrow(
        /`__proto__` keys are not allowed/,
      );
    }
    expect(() =>
      parseMeta(
        `{ name: "n", description: "d", "__proto__": { whenToUse: "smuggled" } }`,
      ),
    ).toThrow(WorkflowSyntaxError);
  });

  it("rejects an IIFE without executing it (side-effect canary)", () => {
    globalThis.__workflowMetaParserCanary = 0;
    const src = `{
      name: (() => { globalThis.__workflowMetaParserCanary += 1; return "x"; })(),
      description: "d",
    }`;
    expect(() => parseMetaLiteral(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseMetaLiteral(src)).toThrow(/meta must be a pure literal/);
    expect(globalThis.__workflowMetaParserCanary).toBe(0);
  });

  it("rejects a computed key without executing it (side-effect canary)", () => {
    globalThis.__workflowMetaParserCanary = 0;
    const src = `{ [globalThis.__workflowMetaParserCanary += 1]: "x", description: "d" }`;
    expect(() => parseMetaLiteral(src)).toThrow(/meta must be a pure literal/);
    expect(globalThis.__workflowMetaParserCanary).toBe(0);
  });

  it("rejects a template substitution without executing it (side-effect canary)", () => {
    globalThis.__workflowMetaParserCanary = 0;
    // Double-quoted host string so the ${...} reaches the parser verbatim.
    const src =
      '{ name: `a${globalThis.__workflowMetaParserCanary += 1}b`, description: "d" }';
    expect(() => parseMetaLiteral(src)).toThrow(/meta must be a pure literal/);
    expect(globalThis.__workflowMetaParserCanary).toBe(0);
  });

  it.each([
    ["identifier value", `{ a: foo }`],
    ["undefined value", `{ a: undefined }`],
    ["function call", `{ a: f() }`],
    ["constructor call", `{ a: new Date(0) }`],
    ["arithmetic expression", `{ a: 1 + 2 }`],
    ["string concatenation", `{ a: "x" + "y" }`],
    ["parenthesized expression", `{ a: (1) }`],
    ["object spread", `{ ...base }`],
    ["array spread", `{ a: [...items] }`],
    ["shorthand property", `{ name }`],
    ["method definition", `{ f() {} }`],
    ["array elision", `{ a: [1, , 2] }`],
    ["regex literal", `{ a: /x/ }`],
    ["hex number", `{ a: 0x10 }`],
    ["numeric separator", `{ a: 1_000 }`],
    ["identifier glued to number", `{ a: 5x }`],
    ["unterminated string", `{ a: "x }`],
    ["unterminated object", `{ a: "x"`],
    ["newline inside a quoted string", `{ a: "x\ny" }`],
    ["trailing content", `{} extra`],
  ])("rejects %s", (_label, src) => {
    expect(() => parseMetaLiteral(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseMetaLiteral(src)).toThrow(/meta must be a pure literal/);
  });
});

describe("parseMeta", () => {
  it("accepts a minimal meta", () => {
    expect(parseMeta(`{ name: "n", description: "d" }`)).toEqual({
      name: "n",
      description: "d",
    });
  });

  it("accepts all seven fields", () => {
    expect(
      parseMeta(`{
        name: "n",
        description: "d",
        phases: [{ title: "One", detail: "first" }, { title: "Two" }],
        whenToUse: "whenever",
        defaultProvider: "claude-code",
        defaultModel: "claude-sonnet-4-5",
        defaultSandbox: "workspace-write",
      }`),
    ).toEqual({
      name: "n",
      description: "d",
      phases: [{ title: "One", detail: "first" }, { title: "Two" }],
      whenToUse: "whenever",
      defaultProvider: "claude-code",
      defaultModel: "claude-sonnet-4-5",
      defaultSandbox: "workspace-write",
    });
  });

  it.each([
    ["missing name", `{ description: "d" }`],
    ["missing description", `{ name: "n" }`],
    ["empty name", `{ name: "", description: "d" }`],
    ["non-string description", `{ name: "n", description: 5 }`],
    ["unknown field", `{ name: "n", description: "d", defualtModel: "typo" }`],
    ["non-object value", `"just a string"`],
    [
      "unknown provider",
      `{ name: "n", description: "d", defaultProvider: "not-a-provider" }`,
    ],
    [
      "unknown sandbox",
      `{ name: "n", description: "d", defaultSandbox: "yolo" }`,
    ],
    [
      "phase without title",
      `{ name: "n", description: "d", phases: [{ detail: "x" }] }`,
    ],
    ["non-array phases", `{ name: "n", description: "d", phases: "Scope" }`],
  ])("rejects %s", (_label, src) => {
    expect(() => parseMeta(src)).toThrow(WorkflowSyntaxError);
    expect(() => parseMeta(src)).toThrow(/invalid meta/);
  });

  it("accepts every known provider and sandbox value", () => {
    for (const provider of ["codex", "claude-code", "pi"]) {
      const meta = parseMeta(
        `{ name: "n", description: "d", defaultProvider: "${provider}" }`,
      );
      expect(meta.defaultProvider).toBe(provider);
    }
    for (const sandbox of [
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]) {
      const meta = parseMeta(
        `{ name: "n", description: "d", defaultSandbox: "${sandbox}" }`,
      );
      expect(meta.defaultSandbox).toBe(sandbox);
    }
  });
});

// Port-parity fixtures: the exact meta literal text of both omegacode builtins (neither carries a
// model default, so there is nothing to strip). The expected objects are the values omegacode's
// throwaway-vm evaluation produced for these literals.
describe("port parity with omegacode builtins", () => {
  it("parses the deep-research builtin meta to the vm-path values", () => {
    const literal = `{
  name: "deep-research",
  description:
    "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
  defaultSandbox: "read-only",
  phases: [
    { title: "Scope", detail: "break the question into distinct search directives" },
    { title: "Search", detail: "5 parallel web-search agents" },
    { title: "Fetch", detail: "dedup URLs, deep-read the top sources" },
    { title: "Verify", detail: "3-vote adversarial panel per claim" },
    { title: "Synthesize", detail: "cited report from surviving claims" },
  ],
}`;
    expect(parseMeta(literal)).toEqual({
      name: "deep-research",
      description:
        "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
      defaultSandbox: "read-only",
      phases: [
        {
          title: "Scope",
          detail: "break the question into distinct search directives",
        },
        { title: "Search", detail: "5 parallel web-search agents" },
        { title: "Fetch", detail: "dedup URLs, deep-read the top sources" },
        { title: "Verify", detail: "3-vote adversarial panel per claim" },
        { title: "Synthesize", detail: "cited report from surviving claims" },
      ],
    });
  });

  it("parses the code-review builtin meta to the vm-path values", () => {
    const literal = `{
  name: "code-review",
  description:
    "Multi-agent code review — one finder per angle, independent verification of every finding, gap-sweep at higher levels, ranked report.",
  defaultSandbox: "read-only",
  phases: [
    { title: "Review", detail: "one finder agent per review angle" },
    { title: "Verify", detail: "independent verifier per candidate finding" },
    { title: "Sweep", detail: "hunt for what the angle reviewers missed (xhigh/max)" },
    { title: "Report", detail: "rank, cap, and write up the confirmed findings" },
  ],
}`;
    expect(parseMeta(literal)).toEqual({
      name: "code-review",
      description:
        "Multi-agent code review — one finder per angle, independent verification of every finding, gap-sweep at higher levels, ranked report.",
      defaultSandbox: "read-only",
      phases: [
        { title: "Review", detail: "one finder agent per review angle" },
        {
          title: "Verify",
          detail: "independent verifier per candidate finding",
        },
        {
          title: "Sweep",
          detail: "hunt for what the angle reviewers missed (xhigh/max)",
        },
        {
          title: "Report",
          detail: "rank, cap, and write up the confirmed findings",
        },
      ],
    });
  });
});
