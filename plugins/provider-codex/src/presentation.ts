/**
 * Declarative presentation for every item the codex bridge opens or closes
 * (grammar v3, docs/provider-plugin-api.md §3).
 *
 * This module is where codex's tool-name knowledge lives: which codex native
 * is a shell command, a file edit, a web search, a sub-agent, a bundled MCP
 * tool, or a bb-injected tool, and how each of those reads as a timeline row
 * (label while pending, label once settled, a host glyph, an optional
 * headline, and whether clients may collapse the row). Core keeps no table of
 * codex tool names; the persisted event carries this snapshot, so a row
 * renders the same way after the plugin is upgraded or removed.
 *
 * Icons are host glyph names from the shared icon registry
 * (`@bb/shared-ui/icon`); the persisted form is glyph-only by design.
 */
import type { DeltaPresentation } from "@get-bb/plugin-sdk/provider-bridge";

/** Row headlines stay one line and short; the item carries the full text. */
const TITLE_MAX_LENGTH = 160;

export function presentationTitle(text: string): string | undefined {
  const firstLine = text.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return undefined;
  }
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
}

function withTitle(
  presentation: DeltaPresentation,
  title: string | undefined,
): DeltaPresentation {
  return title === undefined ? presentation : { ...presentation, title };
}

/**
 * Codex wraps every shell command as `<shell> -lc "<command>"`; the headline
 * shows the command the agent wrote, not the wrapper.
 */
const SHELL_WRAPPER_PATTERN =
  /^(?:\S*\/)?(?:sh|bash|zsh)\s+(?:-lc|-c)\s+([\s\S]+)$/;

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const match = SHELL_WRAPPER_PATTERN.exec(trimmed);
  if (!match?.[1]) {
    return trimmed;
  }
  const inner = match[1].trim();
  const quote = inner[0];
  if (
    inner.length >= 2 &&
    (quote === '"' || quote === "'") &&
    inner[inner.length - 1] === quote
  ) {
    return inner.slice(1, -1);
  }
  return inner;
}

function fileName(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

// ---------------------------------------------------------------------------
// Core-kind items
// ---------------------------------------------------------------------------

export const AGENT_MESSAGE_PRESENTATION: DeltaPresentation = {
  label: { pending: "Responding", completed: "Responded" },
  icon: { glyph: "MessageSquare" },
};

export const REASONING_PRESENTATION: DeltaPresentation = {
  label: { pending: "Thinking", completed: "Thought" },
  icon: { glyph: "Brain" },
};

export const PLAN_PRESENTATION: DeltaPresentation = {
  label: { pending: "Writing plan", completed: "Wrote plan" },
  icon: { glyph: "ListTodo" },
};

export const COMPACTION_PRESENTATION: DeltaPresentation = {
  label: { pending: "Compacting context", completed: "Compacted context" },
  icon: { glyph: "Archive" },
};

export const IMAGE_VIEW_PRESENTATION: DeltaPresentation = {
  label: { pending: "Viewing image", completed: "Viewed image" },
  icon: { glyph: "Eye" },
};

export function commandPresentation(command: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Running command", completed: "Ran command" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(unwrapShellCommand(command)),
  );
}

export function fileChangePresentation(
  paths: readonly string[],
): DeltaPresentation {
  const names = [...new Set(paths.map(fileName))];
  const plural = names.length > 1;
  return withTitle(
    {
      label: {
        pending: plural ? "Editing files" : "Editing file",
        completed: plural ? "Edited files" : "Edited file",
      },
      icon: { glyph: "EditFile" },
    },
    names.length === 0 ? undefined : presentationTitle(names.join(", ")),
  );
}

export function webSearchPresentation(
  queries: readonly string[],
): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Searching the web", completed: "Searched the web" },
      icon: { glyph: "Globe" },
    },
    queries[0] === undefined ? undefined : presentationTitle(queries[0]),
  );
}

export function webFetchPresentation(url: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Fetching page", completed: "Fetched page" },
      icon: { glyph: "Browser" },
    },
    presentationTitle(url),
  );
}

export function imageViewPresentation(path: string): DeltaPresentation {
  return withTitle(IMAGE_VIEW_PRESENTATION, presentationTitle(fileName(path)));
}

/**
 * A plan-steps snapshot (codex `update_plan`). The headline is the step in
 * progress — what the agent is doing now — falling back to the explanation.
 */
export function planStepsPresentation(args: {
  steps: readonly { step: string; status: string }[];
  explanation: string | null;
}): DeltaPresentation {
  const active = args.steps.find((step) => step.status === "active");
  const headline = active?.step ?? args.explanation ?? undefined;
  return withTitle(
    {
      label: { pending: "Updating plan", completed: "Updated plan" },
      icon: { glyph: "ListTodo" },
    },
    headline === undefined ? undefined : presentationTitle(headline),
  );
}

// ---------------------------------------------------------------------------
// Generic tools (MCP servers, dynamic tools)
// ---------------------------------------------------------------------------

/**
 * Codex bundles a Node REPL (`node_repl` server: `js`, `js_reset`) whose
 * calls carry a human title in their arguments; that title is the row
 * headline, and the row reads as "Ran JavaScript" rather than "Ran js".
 */
const NODE_REPL_SERVER = "node_repl";

function nodeReplPresentation(
  tool: string,
  args: unknown,
): DeltaPresentation | null {
  if (tool === "js_reset") {
    return {
      label: {
        pending: "Resetting JavaScript session",
        completed: "Reset JavaScript session",
      },
      icon: { glyph: "Code" },
    };
  }
  if (tool !== "js") {
    return null;
  }
  const title =
    args !== null &&
    typeof args === "object" &&
    "title" in args &&
    typeof args.title === "string"
      ? presentationTitle(args.title)
      : undefined;
  return withTitle(
    {
      label: { pending: "Running JavaScript", completed: "Ran JavaScript" },
      icon: { glyph: "Code" },
    },
    title,
  );
}

export function mcpToolPresentation(args: {
  server: string;
  tool: string;
  args: unknown;
}): DeltaPresentation {
  if (args.server === NODE_REPL_SERVER) {
    const nodeRepl = nodeReplPresentation(args.tool, args.args);
    if (nodeRepl !== null) {
      return nodeRepl;
    }
  }
  return withTitle(
    {
      label: { pending: `Running ${args.tool}`, completed: `Ran ${args.tool}` },
      icon: { glyph: "Toolbox" },
    },
    args.server,
  );
}

/**
 * A dynamic tool that is codex's own (a bb-injected tool carries its own
 * presentation on its definition instead).
 */
export function dynamicToolPresentation(tool: string): DeltaPresentation {
  return {
    label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
    icon: { glyph: "Toolbox" },
  };
}

// ---------------------------------------------------------------------------
// Extension items
// ---------------------------------------------------------------------------

/**
 * The macOS permission profile a codex approval asked for, as its own row
 * beside the approval: what was requested goes in the detail, since bb's
 * permission layer cannot grant it and the approval itself never shows it.
 */
export function macOsPermissionPresentation(
  requested: readonly string[],
): DeltaPresentation {
  const presentation: DeltaPresentation = {
    label: {
      pending: "Requesting macOS permissions",
      completed: "Requested macOS permissions",
    },
    icon: { glyph: "Lock" },
  };
  const detail =
    requested.length === 0
      ? "No macOS capability was requested."
      : `Requested: ${requested.join(", ")}. bb cannot grant macOS permissions; the approval covers the command only.`;
  return { ...presentation, detail: presentationDetail(detail) };
}

/** Row details are capped by the persisted presentation schema. */
const DETAIL_MAX_LENGTH = 280;

export function presentationDetail(text: string): string {
  return text.length > DETAIL_MAX_LENGTH
    ? `${text.slice(0, DETAIL_MAX_LENGTH - 1)}…`
    : text;
}

// ---------------------------------------------------------------------------
// Sub-agents (collab tool calls and subAgentActivity)
// ---------------------------------------------------------------------------

const COLLAB_AGENT_LABELS: Readonly<
  Record<string, DeltaPresentation["label"]>
> = {
  spawnAgent: { pending: "Spawning agent", completed: "Spawned agent" },
  wait: { pending: "Waiting for agents", completed: "Waited for agents" },
  resumeAgent: { pending: "Resuming agent", completed: "Resumed agent" },
  sendInput: { pending: "Messaging agent", completed: "Messaged agent" },
  closeAgent: { pending: "Closing agent", completed: "Closed agent" },
};

export function collabAgentPresentation(args: {
  tool: string;
  prompt: string | null;
}): DeltaPresentation {
  const label = COLLAB_AGENT_LABELS[args.tool] ?? {
    pending: `Running ${args.tool}`,
    completed: `Ran ${args.tool}`,
  };
  return withTitle(
    { label, icon: { glyph: "UserRound" } },
    args.prompt === null ? undefined : presentationTitle(args.prompt),
  );
}

/** The synthesized spawn row for a codex native sub-agent (`agentPath`). */
export function subAgentPresentation(agentPath: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Running agent", completed: "Agent finished" },
      icon: { glyph: "UserRound" },
    },
    presentationTitle(agentPath),
  );
}
