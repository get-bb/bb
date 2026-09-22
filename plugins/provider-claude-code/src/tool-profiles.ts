import { z } from "zod";

export const CLAUDE_BUILTIN_TOOL_UNIVERSE = [
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
] as const;

export type ClaudeBuiltinTool = (typeof CLAUDE_BUILTIN_TOOL_UNIVERSE)[number];

export const claudeToolProfileSchema = z.enum(["full", "builder", "review"]);

export type ClaudeToolProfile = z.infer<typeof claudeToolProfileSchema>;

const claudeBuiltinToolSet = new Set<string>(CLAUDE_BUILTIN_TOOL_UNIVERSE);

export function validateClaudeToolProfile(
  profile: string,
  tools: readonly string[],
): readonly ClaudeBuiltinTool[] {
  if (tools.length === 0) {
    throw new Error(`Claude tool profile ${profile} must not be empty`);
  }

  const seen = new Set<string>();
  for (const tool of tools) {
    if (!claudeBuiltinToolSet.has(tool)) {
      throw new Error(
        `Claude tool profile ${profile} contains unknown tool ${tool}`,
      );
    }
    if (seen.has(tool)) {
      throw new Error(
        `Claude tool profile ${profile} contains duplicate tool ${tool}`,
      );
    }
    seen.add(tool);
  }

  return tools as readonly ClaudeBuiltinTool[];
}

export const CLAUDE_BUILDER_TOOLS = validateClaudeToolProfile("builder", [
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

export const CLAUDE_REVIEW_TOOLS = validateClaudeToolProfile("review", [
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

export function getClaudeToolProfileTools(
  profile: ClaudeToolProfile,
): readonly ClaudeBuiltinTool[] | undefined {
  switch (profile) {
    case "full":
      return undefined;
    case "builder":
      return CLAUDE_BUILDER_TOOLS;
    case "review":
      return CLAUDE_REVIEW_TOOLS;
  }
}
