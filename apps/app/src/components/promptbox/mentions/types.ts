import type {
  ProviderCommand,
  ProviderCommandOrigin,
  ProviderCommandSource,
} from "@bb/server-contract";

export type PromptPathMentionSource = "workspace" | "thread-storage";
export type PromptPathMentionEntryKind = "file" | "directory";

/**
 * One row in the mention menu. The `replacement` field is the literal text
 * inserted into the prompt after the user picks the suggestion (e.g.
 * `apps/app/src/foo.ts` for workspace files,
 * `thread-storage:notes/foo.md` for thread-storage files, or
 * `thread:thr_abc` for threads).
 */
export type PromptMentionSuggestion =
  | {
      kind: "path";
      source: PromptPathMentionSource;
      entryKind: PromptPathMentionEntryKind;
      path: string;
      name: string;
      replacement: string;
    }
  | {
      kind: "thread";
      path: string;
      replacement: string;
      projectId: string;
      projectName?: string;
      threadId: string;
      title?: string;
    };

/**
 * One row in the command typeahead menu, derived from a {@link ProviderCommand}
 * returned by `GET /projects/:id/commands`. The `kind: "command"` discriminant
 * lets it join the same menu union as {@link PromptMentionSuggestion} while the
 * composer's apply path inserts a prompt pill that serializes back to the
 * slash command token (`/<name>`).
 */
export interface ProviderCommandSuggestion {
  kind: "command";
  name: string;
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
  description: string | null;
  argumentHint: string | null;
}

/**
 * Build a {@link ProviderCommandSuggestion} from the wire-level
 * {@link ProviderCommand}. The only difference is the `kind` discriminant that
 * slots the record into the menu's suggestion union.
 */
export function toProviderCommandSuggestion(
  command: ProviderCommand,
): ProviderCommandSuggestion {
  return {
    kind: "command",
    name: command.name,
    source: command.source,
    origin: command.origin,
    description: command.description,
    argumentHint: command.argumentHint,
  };
}

/**
 * A typeahead trigger the composer watches for. `@` opens the mention menu and
 * `/` opens the provider command menu. A thread is bound to one provider, so at
 * most one command trigger is ever active in a composer.
 */
export interface TypeaheadTrigger {
  char: "@" | "/";
  kind: "mention" | "command";
}

/**
 * The trigger currently under the caret, resolved by the composer's
 * word-boundary detection. `from` is the document position of the trigger char
 * and `to` is the caret position; `query` is the text typed after the trigger
 * up to the caret (whole namespaced names like `frontend:component` are
 * captured, stopping at whitespace).
 */
export interface ActiveTrigger {
  char: string;
  kind: "mention" | "command";
  query: string;
  from: number;
  to: number;
}

/**
 * Mutually-exclusive states the mention menu can render. Replaces the prior
 * 4-boolean flag soup (showQueryHint / mentionLoading / mentionError /
 * mentionSuggestions). The "results" state's empty-vs-populated rendering is
 * a single decision inside the menu (`suggestions.length === 0` shows the
 * empty state).
 */
export type MentionMenuState =
  /** User typed `@` but no query yet. */
  | { kind: "hint" }
  /** Suggestions request in flight. */
  | { kind: "loading" }
  /** Suggestions request failed. */
  | { kind: "error" }
  /** Suggestions resolved (possibly empty). */
  | {
      kind: "results";
      suggestions: readonly PromptMentionSuggestion[];
    };

/**
 * Mutually-exclusive states the command typeahead menu can render. Mirrors
 * {@link MentionMenuState} but with no "hint" state: command triggers show the
 * full available list immediately (no "type to search" gate). The composer
 * suppresses opening the menu entirely on a loaded-empty result, so an empty
 * `results` state is only reached transiently.
 */
export type CommandMenuState =
  /** Suggestions request in flight. */
  | { kind: "loading" }
  /** Suggestions request failed. */
  | { kind: "error" }
  /** Suggestions resolved (possibly empty). */
  | {
      kind: "results";
      suggestions: readonly ProviderCommandSuggestion[];
    };

/**
 * Generalized typeahead menu state covering both trigger kinds. The `trigger`
 * discriminant tells the menu which suggestion shape it is rendering so a
 * single `MentionMenu` can present mention sections or command sections without
 * forking. The §6 menu task consumes this; §5 composer task produces it from
 * the active trigger plus the matching data hook.
 */
export type TypeaheadMenuState =
  | { trigger: "mention"; state: MentionMenuState }
  | { trigger: "command"; state: CommandMenuState };
