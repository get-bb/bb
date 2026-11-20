import { beforeAll, describe, expect, it } from "vitest";
import {
  enabledContexts,
  loadPluginAgentContexts,
  parseSkillFrontmatter,
  type PluginAgentContext,
} from "../src/agent-context.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  measureAgentContext,
  measurePlugin,
  PLUGIN_CONTEXT_BUDGETS,
  SKILL_DESCRIPTION_MAX_CHARS,
} from "../src/budget.js";

let contexts: PluginAgentContext[] = [];

beforeAll(async () => {
  contexts = await loadPluginAgentContexts({ nativeUserQuestion: false });
});

describe("agent context budget", () => {
  it("keeps each plugin's always-on agent text within its budget", () => {
    const overBudget = contexts
      .map(measurePlugin)
      .filter(
        (size) => size.total > (PLUGIN_CONTEXT_BUDGETS[size.pluginId] ?? 0),
      )
      .map(
        (size) =>
          `${size.pluginId}: ${size.total} chars (budget ${PLUGIN_CONTEXT_BUDGETS[size.pluginId] ?? 0}; instructions ${size.instructions}, skills ${size.skills}, tools ${size.tools})`,
      );
    expect(overBudget).toEqual([]);
  });

  it("keeps the text every default thread gets within the total budget", () => {
    expect(
      measureAgentContext(enabledContexts(contexts)).total,
    ).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET);
  });

  it("keeps skill descriptions short", () => {
    const long = contexts
      .flatMap((context) => context.skills)
      .filter((skill) => skill.description.length > SKILL_DESCRIPTION_MAX_CHARS)
      .map((skill) => `${skill.name}: ${skill.description.length}`);
    expect(long).toEqual([]);
  });
});

describe("parseSkillFrontmatter", () => {
  it("reads quoted and plain values with LF or CRLF line ends", () => {
    for (const end of ["\n", "\r\n"]) {
      expect(
        parseSkillFrontmatter(
          [
            "---",
            "name: git",
            `description: "Read an environment's git status."`,
            "---",
            "# Git",
          ].join(end),
        ),
      ).toEqual({
        name: "git",
        description: "Read an environment's git status.",
      });
    }
  });
});
