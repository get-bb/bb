/**
 * Declarative presentation for every item the ACP bridge opens or closes
 * (grammar v3, docs/provider-plugin-api.md §3).
 *
 * ACP agents describe a tool call with a native kind enum (`read`, `edit`,
 * `delete`, `move`, `search`, `execute`, `think`, `fetch`, `other`) and a
 * human `title` ("Read File", "`touch a.txt`", "MCP: tool"). This module is
 * where that vocabulary becomes a timeline row: a label pair per kind, a host
 * glyph, and the agent's title as the headline. Core keeps no table of ACP
 * kinds or titles; the persisted event carries this snapshot, so a row
 * renders the same way after the plugin is upgraded or removed.
 *
 * Icons are host glyph names from the shared icon registry
 * (`@bb/shared-ui/icon`); the persisted form is glyph-only by design.
 */
import type { DeltaPresentation } from "@get-bb/plugin-sdk/provider-bridge";
import type { AcpToolKind } from "./wire.js";

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

function fileName(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * Agents wrap a command title in Markdown code ticks (Cursor: "`sleep 2`");
 * the headline shows the command itself.
 */
function stripCodeTicks(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1)
    : trimmed;
}

// ---------------------------------------------------------------------------
// Core-kind items
// ---------------------------------------------------------------------------

export const COMPACTION_PRESENTATION: DeltaPresentation = {
  label: { pending: "Compacting context", completed: "Compacted context" },
  icon: { glyph: "Archive" },
};

export function commandPresentation(command: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Running command", completed: "Ran command" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(stripCodeTicks(command)),
  );
}

export type AcpFileChangeVerb = "add" | "update" | "delete";

/**
 * A file change: the verb comes from the classified change kind (`add` for
 * a bridge-side `fs/write_text_file` that created the file, `delete` for the
 * ACP `delete` kind, `update` otherwise); the headline lists the file names.
 */
export function fileChangePresentation(args: {
  verb: AcpFileChangeVerb;
  paths: readonly string[];
}): DeltaPresentation {
  const names = [...new Set(args.paths.map(fileName))];
  const plural = names.length > 1;
  const label =
    args.verb === "add"
      ? {
          pending: plural ? "Writing files" : "Writing file",
          completed: plural ? "Wrote files" : "Wrote file",
        }
      : args.verb === "delete"
        ? {
            pending: plural ? "Deleting files" : "Deleting file",
            completed: plural ? "Deleted files" : "Deleted file",
          }
        : {
            pending: plural ? "Editing files" : "Editing file",
            completed: plural ? "Edited files" : "Edited file",
          };
  return withTitle(
    {
      label,
      icon: { glyph: args.verb === "delete" ? "Trash2" : "EditFile" },
    },
    names.length === 0 ? undefined : presentationTitle(names.join(", ")),
  );
}

export function fileReadPresentation(path: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Reading file", completed: "Read file" },
      icon: { glyph: "FileText" },
    },
    presentationTitle(fileName(path)),
  );
}

/** `content` searches inside files; `path` matches file names. */
export function searchPresentation(args: {
  mode: "content" | "path";
  query: string;
}): DeltaPresentation {
  return withTitle(
    args.mode === "content"
      ? {
          label: { pending: "Searching files", completed: "Searched files" },
          icon: { glyph: "Search" },
        }
      : {
          label: { pending: "Finding files", completed: "Found files" },
          icon: { glyph: "FolderOpen" },
        },
    presentationTitle(args.query),
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

/** A `think` tool call: the agent's reasoning, as a tool. */
export function reasoningPresentation(): DeltaPresentation {
  return {
    label: { pending: "Thinking", completed: "Thought" },
    icon: { glyph: "Brain" },
  };
}

/**
 * A plan snapshot (ACP `plan` update). The headline is the step in progress
 * — what the agent is doing now. Collapsed by default: the todo banner reads
 * the snapshot; the row is bookkeeping.
 */
export function planStepsPresentation(
  steps: readonly { step: string; status?: string }[],
): DeltaPresentation {
  const active = steps.find((step) => step.status === "active");
  return withTitle(
    {
      label: { pending: "Updating plan", completed: "Updated plan" },
      icon: { glyph: "ListTodo" },
      suppress: true,
    },
    active === undefined ? undefined : presentationTitle(active.step),
  );
}

/**
 * A bb-injected tool whose definition carries no presentation (a server from
 * before the field existed): a generic label under bb's own glyph.
 */
export function bbToolPresentation(tool: string): DeltaPresentation {
  return {
    label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
    icon: { glyph: "Toolbox" },
  };
}

// ---------------------------------------------------------------------------
// Native kinds
// ---------------------------------------------------------------------------

interface KindPresentationSpec {
  label: DeltaPresentation["label"];
  glyph: string;
}

const KIND_PRESENTATIONS: Readonly<Record<AcpToolKind, KindPresentationSpec>> =
  {
    read: {
      label: { pending: "Reading file", completed: "Read file" },
      glyph: "FileText",
    },
    edit: {
      label: { pending: "Editing file", completed: "Edited file" },
      glyph: "EditFile",
    },
    delete: {
      label: { pending: "Deleting file", completed: "Deleted file" },
      glyph: "Trash2",
    },
    move: {
      label: { pending: "Moving file", completed: "Moved file" },
      glyph: "FolderEdit",
    },
    search: {
      label: { pending: "Searching", completed: "Searched" },
      glyph: "Search",
    },
    execute: {
      label: { pending: "Running command", completed: "Ran command" },
      glyph: "Terminal",
    },
    think: {
      label: { pending: "Thinking", completed: "Thought" },
      glyph: "Brain",
    },
    fetch: {
      label: { pending: "Fetching", completed: "Fetched" },
      glyph: "Globe",
    },
    other: {
      label: { pending: "Running tool", completed: "Ran tool" },
      glyph: "Toolbox",
    },
  };

/**
 * A tool call with no core shape of its own, or one whose core shape the
 * agent left unfilled (a `read` with no path, a `fetch` with no URL): the
 * native kind picks the label and glyph, the agent's title is the headline.
 */
export function toolKindPresentation(args: {
  kind: AcpToolKind | undefined;
  title: string | undefined;
}): DeltaPresentation {
  const spec = KIND_PRESENTATIONS[args.kind ?? "other"];
  return withTitle(
    { label: spec.label, icon: { glyph: spec.glyph } },
    args.title === undefined ? undefined : presentationTitle(args.title),
  );
}
