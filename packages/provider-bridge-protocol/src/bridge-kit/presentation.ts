/**
 * Presentation building blocks every bb-authored bridge shares (grammar v3,
 * docs/provider-plugin-api.md §3): the headline and detail truncators, the
 * two core-kind rows whose wording is the same for every provider
 * (compaction, reasoning), the builders for the core shapes whose label and
 * glyph do not depend on the provider (file read, search, web search, web
 * fetch, plan steps), and the generic "Running <tool>" fallback.
 *
 * A bridge keeps its own vocabulary beside these: which native tool is a
 * shell command or a file edit, how a command headline is unwrapped, and
 * the per-tool tables. Only what reads identically across providers lives
 * here, so that a persisted row built by one bridge looks like the same row
 * built by another.
 *
 * Icons are names: host glyphs from the shared icon registry
 * (`@bb/shared-ui/icon`), or a plugin's own declared icon as
 * `"<pluginId>/<name>"` (`bb.branding.experimental_icons`); the persisted
 * form is a name, never bytes or a path.
 */
import { THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH } from "@bb/domain";
import type { DeltaPresentation } from "../thread-delta.js";

/** Row headlines stay one line and short; the item carries the full text. */
export const PRESENTATION_TITLE_MAX_LENGTH = 160;

/**
 * The first non-empty line of `text`, capped at
 * {@link PRESENTATION_TITLE_MAX_LENGTH} with an ellipsis; undefined when
 * there is nothing to headline, so the row carries no `title` at all.
 */
export function presentationTitle(text: string): string | undefined {
  const firstLine = text.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return undefined;
  }
  return firstLine.length > PRESENTATION_TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, PRESENTATION_TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
}

/** Row details are capped by the persisted presentation schema. */
export function presentationDetail(text: string): string {
  return text.length > THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH
    ? `${text.slice(0, THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH - 1)}…`
    : text;
}

/** `presentation` with `title` stamped on it, or untouched when there is none. */
export function withTitle(
  presentation: DeltaPresentation,
  title: string | undefined,
): DeltaPresentation {
  return title === undefined ? presentation : { ...presentation, title };
}

/** The last path segment — a headline names the file, not its directory. */
export function presentationFileName(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

// ---------------------------------------------------------------------------
// Core-kind rows with provider-independent wording
// ---------------------------------------------------------------------------

export const COMPACTION_PRESENTATION: DeltaPresentation = {
  label: { pending: "Compacting context", completed: "Compacted context" },
  icon: { glyph: "Archive" },
};

export const REASONING_PRESENTATION: DeltaPresentation = {
  label: { pending: "Thinking", completed: "Thought" },
  icon: { glyph: "Brain" },
};

export function fileReadPresentation(path: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Reading file", completed: "Read file" },
      icon: { glyph: "FileText" },
    },
    presentationTitle(presentationFileName(path)),
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

/** A web search; `query` is the headline, or undefined when the agent sent none. */
export function webSearchPresentation(
  query: string | undefined,
): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Searching the web", completed: "Searched the web" },
      icon: { glyph: "Globe" },
    },
    query === undefined ? undefined : presentationTitle(query),
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

/**
 * A plan-steps snapshot. The headline is the step in progress — what the
 * agent is doing now. Collapsed by default: the todo banner reads the
 * snapshot; the row is bookkeeping.
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
 * A tool with no core kind and no presentation of its own — a provider's
 * own dynamic tool, an unknown built-in, or a bb-injected tool whose
 * definition predates the field: a generic label under bb's own glyph.
 */
export function toolPresentation(tool: string): DeltaPresentation {
  return {
    label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
    icon: { glyph: "Toolbox" },
  };
}
