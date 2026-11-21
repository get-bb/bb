import { describe, expect, it } from "vitest";
import { loadCases, type Check } from "../src/cases.js";
import {
  casePassed,
  gradeObservation,
  observeStream,
  type Observation,
} from "../src/grade.js";

const observation: Observation = {
  bbCalls: ["thread tell thr_peer42 Port 5174", "status"],
  commands: ["bb thread tell thr_peer42 'Port 5174'", "cat package.json"],
  tools: ['mcp__bb-bridge__bb_workflow_run {"source":"x"}'],
  skills: ["automations"],
  texts: ['Watch it here:\n::browser-preview{session="bas_7k2"}', "Done."],
  final: "Done. See @thread:thr_login42.",
};

function grade(check: Omit<Check, "not"> & { not?: boolean }) {
  return gradeObservation([{ not: false, ...check }], observation)[0]!.passed;
}

describe("gradeObservation", () => {
  it("passes when any matcher matches", () => {
    expect(
      grade({
        label: "tell or skill",
        anyOf: [{ bb: "^thread spawn" }, { skill: "automations" }],
      }),
    ).toBe(true);
    expect(grade({ label: "spawn", anyOf: [{ bb: "^thread spawn" }] })).toBe(
      false,
    );
  });

  it("inverts a negated check", () => {
    expect(
      grade({ label: "no tell", not: true, anyOf: [{ bb: "^thread tell" }] }),
    ).toBe(false);
    expect(
      grade({ label: "no spawn", not: true, anyOf: [{ bb: "^thread spawn" }] }),
    ).toBe(true);
  });

  it("counts matches across texts for times", () => {
    const directive = '::browser-preview\\{session="bas_7k2"\\}';
    expect(
      grade({ label: "once", anyOf: [{ text: directive, times: 1 }] }),
    ).toBe(true);
    expect(
      grade({ label: "twice", anyOf: [{ text: directive, times: 2 }] }),
    ).toBe(false);
  });

  it("matches tool calls by name and input", () => {
    expect(
      grade({
        label: "workflow",
        anyOf: [{ tool: "^mcp__bb-bridge__bb_workflow_run " }],
      }),
    ).toBe(true);
    expect(
      grade({ label: "other", anyOf: [{ tool: "bb_workflow_result" }] }),
    ).toBe(false);
  });

  it("matches the final text and shell commands case-insensitively", () => {
    expect(
      grade({ label: "link", anyOf: [{ final: "@THREAD:thr_login42" }] }),
    ).toBe(true);
    expect(grade({ label: "cat", anyOf: [{ command: "^cat " }] })).toBe(true);
  });
});

describe("casePassed", () => {
  it.each([
    [[true, true, false], true],
    [[true, false, false], false],
    [[true, false], false],
    [[true], true],
    [[], false],
  ])("%j -> %s", (passes, expected) => {
    expect(casePassed(passes)).toBe(expected);
  });
});

describe("observeStream", () => {
  it("reads shell commands, skills, texts and the final result", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Checking." },
            {
              type: "tool_use",
              name: "Skill",
              input: { skill: "bb-global-skills:automations" },
            },
            { type: "tool_use", name: "Bash", input: { command: "bb status" } },
            { type: "thinking", thinking: "..." },
          ],
        },
      }),
      "not json",
      JSON.stringify({ type: "result", result: "All set." }),
    ];
    expect(observeStream(lines, ["status"])).toEqual({
      bbCalls: ["status"],
      commands: ["bb status"],
      tools: [
        'Skill {"skill":"bb-global-skills:automations"}',
        'Bash {"command":"bb status"}',
      ],
      skills: ["automations"],
      texts: ["Checking."],
      final: "All set.",
    });
  });
});

describe("cases", () => {
  it("load, name a source, and use valid patterns", () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const evalCase of cases) {
      expect(evalCase.source.trim()).not.toBe("");
      for (const check of evalCase.checks) {
        for (const matcher of check.anyOf) {
          for (const pattern of [
            matcher.bb,
            matcher.command,
            matcher.text,
            matcher.final,
          ]) {
            if (pattern !== undefined)
              expect(() => new RegExp(pattern)).not.toThrow();
          }
        }
      }
    }
  });
});
