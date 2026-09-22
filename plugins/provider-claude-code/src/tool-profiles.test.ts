import { describe, expect, it } from "vitest";
import {
  CLAUDE_BUILDER_TOOLS,
  CLAUDE_BUILTIN_TOOL_UNIVERSE,
  CLAUDE_REVIEW_TOOLS,
  getClaudeToolProfileTools,
  validateClaudeToolProfile,
} from "./tool-profiles.js";

function complement(tools: readonly string[]): string[] {
  const included = new Set(tools);
  return CLAUDE_BUILTIN_TOOL_UNIVERSE.filter((tool) => !included.has(tool));
}

describe("Claude Code built-in tool profiles", () => {
  it("pins the observed Claude Code 2.1.272 tool universe", () => {
    expect(CLAUDE_BUILTIN_TOOL_UNIVERSE).toEqual([
      "Agent",
      "AskUserQuestion",
      "Bash",
      "CronCreate",
      "CronDelete",
      "CronList",
      "DesignSync",
      "Edit",
      "EnterPlanMode",
      "EnterWorktree",
      "ExitPlanMode",
      "ExitWorktree",
      "ListAgents",
      "ListMcpResourcesTool",
      "Monitor",
      "NotebookEdit",
      "PushNotification",
      "Read",
      "ReadMcpResourceDirTool",
      "ReadMcpResourceTool",
      "ReportFindings",
      "ScheduleWakeup",
      "SendMessage",
      "Skill",
      "TaskOutput",
      "TaskStop",
      "WebFetch",
      "WebSearch",
      "Workflow",
      "Write",
    ]);
  });

  it("pins the exact builder profile and omitted complement", () => {
    expect(CLAUDE_BUILDER_TOOLS).toEqual([
      "Agent",
      "AskUserQuestion",
      "Bash",
      "Edit",
      "EnterPlanMode",
      "EnterWorktree",
      "ExitPlanMode",
      "ExitWorktree",
      "ListAgents",
      "Monitor",
      "NotebookEdit",
      "Read",
      "SendMessage",
      "Skill",
      "TaskOutput",
      "TaskStop",
      "WebFetch",
      "WebSearch",
      "Write",
    ]);
    expect(complement(CLAUDE_BUILDER_TOOLS)).toEqual([
      "CronCreate",
      "CronDelete",
      "CronList",
      "DesignSync",
      "ListMcpResourcesTool",
      "PushNotification",
      "ReadMcpResourceDirTool",
      "ReadMcpResourceTool",
      "ReportFindings",
      "ScheduleWakeup",
      "Workflow",
    ]);
  });

  it("pins the exact review profile and omitted complement", () => {
    expect(CLAUDE_REVIEW_TOOLS).toEqual([
      "AskUserQuestion",
      "Bash",
      "EnterPlanMode",
      "ExitPlanMode",
      "ListMcpResourcesTool",
      "Read",
      "ReadMcpResourceDirTool",
      "ReadMcpResourceTool",
      "ReportFindings",
      "Skill",
      "WebFetch",
      "WebSearch",
    ]);
    expect(complement(CLAUDE_REVIEW_TOOLS)).toEqual([
      "Agent",
      "CronCreate",
      "CronDelete",
      "CronList",
      "DesignSync",
      "Edit",
      "EnterWorktree",
      "ExitWorktree",
      "ListAgents",
      "Monitor",
      "NotebookEdit",
      "PushNotification",
      "ScheduleWakeup",
      "SendMessage",
      "TaskOutput",
      "TaskStop",
      "Workflow",
      "Write",
    ]);
  });

  it("keeps every configured profile non-empty, unique, and inside the snapshot", () => {
    const universe = new Set<string>(CLAUDE_BUILTIN_TOOL_UNIVERSE);
    for (const tools of [CLAUDE_BUILDER_TOOLS, CLAUDE_REVIEW_TOOLS]) {
      expect(tools.length).toBeGreaterThan(0);
      expect(new Set(tools).size).toBe(tools.length);
      expect(tools.every((tool) => universe.has(tool))).toBe(true);
    }
  });

  it("omits a tool restriction for the full profile", () => {
    expect(getClaudeToolProfileTools("full")).toBeUndefined();
  });

  it("rejects empty, unknown, and duplicate configured profiles", () => {
    expect(() => validateClaudeToolProfile("empty", [])).toThrow(
      "Claude tool profile empty must not be empty",
    );
    expect(() => validateClaudeToolProfile("unknown", ["NoSuchTool"])).toThrow(
      "Claude tool profile unknown contains unknown tool NoSuchTool",
    );
    expect(() =>
      validateClaudeToolProfile("duplicate", ["Read", "Read"]),
    ).toThrow("Claude tool profile duplicate contains duplicate tool Read");
  });
});
