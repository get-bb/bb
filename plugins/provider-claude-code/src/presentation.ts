/**
 * Declarative presentation for every item the claude-code bridge opens or
 * closes (grammar v3, docs/provider-plugin-api.md §3).
 *
 * This module is where Claude Code's tool-name knowledge lives: which
 * built-in is a shell command, a file read, a search, a file edit, a
 * sub-agent, a plan update, a low-value housekeeping call, and how each reads
 * as a timeline row (label while pending, label once settled, a host glyph,
 * an optional headline, and whether clients may collapse the row). Core keeps
 * no table of Claude tool names; the persisted event carries this snapshot,
 * so a row renders the same way after the plugin is upgraded or removed. The
 * rows whose wording is the same for every provider (compaction, file read,
 * search, web search and fetch, plan steps, the generic tool fallback) and
 * the headline/detail truncators come from the bridge kit.
 *
 * Icons are host glyph names from the shared icon registry
 * (`@bb/shared-ui/icon`); the persisted form is glyph-only by design.
 */
import {
  type DeltaPresentation,
  experimental_presentationDetail as presentationDetail,
  experimental_presentationFileName as presentationFileName,
  experimental_presentationTitle as presentationTitle,
  experimental_toolPresentation as toolPresentation,
  experimental_withTitle as withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";

// ---------------------------------------------------------------------------
// Core-kind items
// ---------------------------------------------------------------------------

/**
 * A `Bash` call. A backgrounded command's item settles when Claude
 * acknowledges the launch, so its settled label says so; the running work is
 * the `local_bash` background task that follows.
 */
export function commandPresentation(args: {
  command: string;
  background: boolean;
}): DeltaPresentation {
  return withTitle(
    {
      label: args.background
        ? {
            pending: "Starting background command",
            completed: "Started background command",
          }
        : { pending: "Running command", completed: "Ran command" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(args.command),
  );
}

export type ClaudeFileChangeVerb = "edit" | "write" | "notebook";

export function fileChangePresentation(args: {
  verb: ClaudeFileChangeVerb;
  path: string | null;
}): DeltaPresentation {
  const label =
    args.verb === "write"
      ? { pending: "Writing file", completed: "Wrote file" }
      : args.verb === "notebook"
        ? { pending: "Editing notebook", completed: "Edited notebook" }
        : { pending: "Editing file", completed: "Edited file" };
  return withTitle(
    { label, icon: { glyph: "EditFile" } },
    args.path === null
      ? undefined
      : presentationTitle(presentationFileName(args.path)),
  );
}

/**
 * An `Agent`/`Task` call. The headline is the call's description; the detail
 * names the sub-agent type and requested model, which the delegation shape
 * does not carry. A backgrounded call settles at the launch acknowledgement.
 */
export function delegationPresentation(args: {
  description: string;
  subagentType: string | null;
  model: string | null;
  background: boolean;
}): DeltaPresentation {
  const presentation: DeltaPresentation = withTitle(
    {
      label: args.background
        ? { pending: "Launching subagent", completed: "Launched subagent" }
        : { pending: "Running subagent", completed: "Subagent finished" },
      icon: { glyph: "UserRound" },
    },
    presentationTitle(args.description),
  );
  const detailParts = [
    ...(args.subagentType === null ? [] : [`${args.subagentType} agent`]),
    ...(args.model === null ? [] : [`model ${args.model}`]),
  ];
  return detailParts.length === 0
    ? presentation
    : { ...presentation, detail: presentationDetail(detailParts.join(" · ")) };
}

// ---------------------------------------------------------------------------
// Generic tools
// ---------------------------------------------------------------------------

interface ToolPresentationSpec {
  label: DeltaPresentation["label"];
  glyph: string;
  /** Low-value housekeeping rows clients collapse by default. */
  suppress?: boolean;
  /** Argument field whose first line is the row headline. */
  titleField?: string;
}

/**
 * Claude Code built-ins with no core kind of their own. Unknown tools (new
 * built-ins, plugin tools) fall back to `Running <tool>` / `Ran <tool>`.
 */
const BUILTIN_TOOL_PRESENTATIONS: Readonly<
  Record<string, ToolPresentationSpec>
> = {
  // The plan-list family: the planSteps snapshot carries the plan, the raw
  // call row is bookkeeping.
  TodoWrite: {
    label: { pending: "Updating todos", completed: "Updated todos" },
    glyph: "ListTodo",
    suppress: true,
  },
  TodoRead: {
    label: { pending: "Reading todos", completed: "Read todos" },
    glyph: "ListTodo",
    suppress: true,
  },
  TaskCreate: {
    label: { pending: "Creating task", completed: "Created task" },
    glyph: "ListTodo",
    suppress: true,
    titleField: "subject",
  },
  TaskUpdate: {
    label: { pending: "Updating task", completed: "Updated task" },
    glyph: "ListTodo",
    suppress: true,
    titleField: "subject",
  },
  TaskList: {
    label: { pending: "Listing tasks", completed: "Listed tasks" },
    glyph: "ListTodo",
    suppress: true,
  },
  TaskGet: {
    label: { pending: "Reading task", completed: "Read task" },
    glyph: "ListTodo",
    suppress: true,
  },
  // Low-value housekeeping (ToolSearch 219, TaskOutput 162 and Monitor 94
  // calls in the production corpus, all opaque rows today).
  ToolSearch: {
    label: { pending: "Searching tools", completed: "Searched tools" },
    glyph: "Toolbox",
    suppress: true,
    titleField: "query",
  },
  TaskOutput: {
    label: { pending: "Reading task output", completed: "Read task output" },
    glyph: "Terminal",
    suppress: true,
  },
  Monitor: {
    label: { pending: "Monitoring", completed: "Monitored" },
    glyph: "Eye",
    suppress: true,
    titleField: "command",
  },
  ScheduleWakeup: {
    label: { pending: "Scheduling wake-up", completed: "Scheduled wake-up" },
    glyph: "Clock",
    suppress: true,
    titleField: "reason",
  },
  SendMessage: {
    label: { pending: "Messaging agent", completed: "Messaged agent" },
    glyph: "Sent",
    suppress: true,
    titleField: "to",
  },
  // The question itself is the user-question interaction row; the call row
  // would duplicate it.
  AskUserQuestion: {
    label: { pending: "Asking a question", completed: "Asked a question" },
    glyph: "MessageQuestion",
    suppress: true,
  },
  // Plan mode.
  EnterPlanMode: {
    label: { pending: "Entering plan mode", completed: "Entered plan mode" },
    glyph: "ListTodo",
  },
  ExitPlanMode: {
    label: { pending: "Presenting plan", completed: "Presented plan" },
    glyph: "FileText",
  },
  // Background work control (the work itself is a background task row).
  Workflow: {
    label: { pending: "Starting workflow", completed: "Started workflow" },
    glyph: "Workflow",
  },
  TaskStop: {
    label: { pending: "Stopping task", completed: "Stopped task" },
    glyph: "Terminal",
  },
  ListAgents: {
    label: { pending: "Listing agents", completed: "Listed agents" },
    glyph: "UserRound",
  },
  Skill: {
    label: { pending: "Loading skill", completed: "Loaded skill" },
    glyph: "Puzzle",
    titleField: "skill",
  },
  StructuredOutput: {
    label: {
      pending: "Returning structured output",
      completed: "Returned structured output",
    },
    glyph: "Code",
  },
  EnterWorktree: {
    label: { pending: "Entering worktree", completed: "Entered worktree" },
    glyph: "GitBranch",
  },
  ExitWorktree: {
    label: { pending: "Leaving worktree", completed: "Left worktree" },
    glyph: "GitBranch",
  },
  LS: {
    label: { pending: "Listing directory", completed: "Listed directory" },
    glyph: "FolderOpen",
    titleField: "path",
  },
  KillShell: {
    label: { pending: "Stopping shell", completed: "Stopped shell" },
    glyph: "Terminal",
  },
  BashOutput: {
    label: { pending: "Reading shell output", completed: "Read shell output" },
    glyph: "Terminal",
    suppress: true,
  },
};

function titleFromArgs(
  args: unknown,
  field: string | undefined,
): string | undefined {
  if (field === undefined || args === null || typeof args !== "object") {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[field];
  return typeof value === "string" ? presentationTitle(value) : undefined;
}

/** A Claude built-in or plugin tool with no core kind. */
export function builtinToolPresentation(
  tool: string,
  args: unknown,
): DeltaPresentation {
  const spec = BUILTIN_TOOL_PRESENTATIONS[tool];
  if (spec === undefined) {
    return toolPresentation(tool);
  }
  return withTitle(
    {
      label: spec.label,
      icon: { glyph: spec.glyph },
      ...(spec.suppress === true ? { suppress: true } : {}),
    },
    titleFromArgs(args, spec.titleField),
  );
}

/** A tool served by an MCP server other than bb's own (`mcp__<server>__<tool>`). */
export function mcpToolPresentation(args: {
  server: string;
  tool: string;
}): DeltaPresentation {
  return withTitle(toolPresentation(args.tool), args.server);
}

// ---------------------------------------------------------------------------
// Background tasks (the SDK task family)
// ---------------------------------------------------------------------------

/**
 * A provider background task row — a dynamic workflow (the Workflow tool), a
 * backgrounded shell command, or a backgrounded sub-agent — stays the core
 * `backgroundTask` kind (the genericity rule) and says how it reads. The
 * label names the work; the task's own status carries how it ended.
 */
export function backgroundTaskPresentation(args: {
  taskType: string;
  description: string;
  workflowName: string | undefined;
}): DeltaPresentation {
  switch (args.taskType) {
    case "local_workflow":
      return withTitle(
        {
          label: {
            pending: "Running workflow",
            completed: "Workflow finished",
          },
          icon: { glyph: "Workflow" },
        },
        presentationTitle(args.workflowName ?? args.description),
      );
    case "local_bash":
      return withTitle(
        {
          label: {
            pending: "Running background command",
            completed: "Background command finished",
          },
          icon: { glyph: "Terminal" },
        },
        presentationTitle(args.description),
      );
    default:
      return withTitle(
        {
          label: {
            pending: "Running background agent",
            completed: "Background agent finished",
          },
          icon: { glyph: "UserRound" },
        },
        presentationTitle(args.description),
      );
  }
}
