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
 * renders the same way after the plugin is upgraded or removed. The rows
 * whose wording is the same for every provider (compaction, reasoning, file
 * read, search, web fetch, plan steps, the generic tool fallback) and the
 * headline truncator come from the bridge kit.
 *
 * Icons are names: host glyphs from the shared icon registry
 * (`@bb/shared-ui/icon`), or a plugin's own declared icon as
 * `"<pluginId>/<name>"` (`bb.branding.experimental_icons`); the persisted
 * form is a name, never bytes or a path.
 */
import type { DeltaPresentation } from "@bb/provider-bridge-protocol";
import {
  presentationFileName,
  presentationTitle,
  withTitle,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type { AcpToolKind } from "./wire.js";

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
  const names = [...new Set(args.paths.map(presentationFileName))];
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

/**
 * A sub-agent an ACP agent launched (Cursor's `cursor/task`, grok's
 * `spawn_subagent`). Version 1 of the protocol has no sub-agent concept, so
 * the label is whatever the agent's own side channel described.
 */
export function delegationPresentation(args: {
  label: string;
  detail?: string;
}): DeltaPresentation {
  const presentation = withTitle(
    {
      label: { pending: "Running subagent", completed: "Subagent finished" },
      icon: { glyph: "UserRound" },
    },
    presentationTitle(args.label),
  );
  return args.detail === undefined
    ? presentation
    : { ...presentation, detail: args.detail };
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
    switch_mode: {
      label: { pending: "Switching mode", completed: "Switched mode" },
      glyph: "SlidersHorizontal",
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
 * When the agent reports the tool's programmatic name, the label names it
 * ("Running read_file") under the kind's glyph.
 */
export function toolKindPresentation(args: {
  kind: AcpToolKind | undefined;
  name?: string | undefined;
  title: string | undefined;
}): DeltaPresentation {
  const spec = KIND_PRESENTATIONS[args.kind ?? "other"];
  const label =
    args.name === undefined
      ? spec.label
      : { pending: `Running ${args.name}`, completed: `Ran ${args.name}` };
  return withTitle(
    { label, icon: { glyph: spec.glyph } },
    args.title === undefined ? undefined : presentationTitle(args.title),
  );
}
