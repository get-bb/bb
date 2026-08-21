import {
  providerCommandSection,
  providerCommandSectionRank,
  type ProviderCommand,
  type ProviderCommandOrigin,
  type ProviderCommandSection,
  type ProviderCommandSource,
} from "@bb/server-contract";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type { PluginMentionTrigger } from "./plugin-mention-triggers.js";

type PromptPathMentionSource = "workspace" | "thread-storage";
type PromptPathMentionEntryKind = "file" | "directory";

/**
 * One row in the mention menu. The `replacement` field is the literal text
 * inserted into the prompt after the user picks the suggestion (e.g.
 * `apps/app/src/foo.ts` for workspace files,
 * `thread-storage:notes/foo.md` for thread-storage files,
 * `thread:thr_abc` for threads, or `project:proj_abc` for projects).
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
    }
  | {
      kind: "project";
      path: string;
      replacement: string;
      projectId: string;
      name: string;
    }
  | {
      kind: "section";
      path: string;
      replacement: string;
      sectionId: string;
      name: string;
    }
  | {
      /**
       * One plugin mention-provider row (plugin design §4.9), from
       * GET /plugins/mentions/search. Items group under `providerLabel` in
       * the menu; picking one inserts a pill whose resource carries
       * `pluginId` + the opaque `itemId` the server resolves at send time.
       */
      kind: "plugin";
      pluginId: string;
      /** Provider id within the plugin; with pluginId it identifies the
       * menu section (labels alone can collide across plugins). */
      providerId: string;
      itemId: string;
      providerLabel: string;
      title: string;
      subtitle: string | null;
      /** Named shared-UI icon hint supplied by the plugin item. */
      icon: string | null;
      replacement: string;
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
  pluginId?: string;
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
    ...(command.pluginId !== undefined ? { pluginId: command.pluginId } : {}),
  };
}

/** Every row the command typeahead menu can render. */
export type ComposerCommandSuggestion = ProviderCommandSuggestion;

function compareCommandSuggestionSections(
  left: ComposerCommandSuggestion,
  right: ComposerCommandSuggestion,
): number {
  return providerCommandSectionRank(left) - providerCommandSectionRank(right);
}

/**
 * The names a query can address a command by. A namespaced skill
 * (`ottonomous:review`) also answers to its trailing segment, so typing the
 * bare name still counts as naming that skill.
 */
function commandSuggestionSearchNames(
  suggestion: ComposerCommandSuggestion,
): string[] {
  const name = suggestion.name.toLowerCase();
  if (suggestion.source !== "skill") {
    return [name];
  }
  const separatorIndex = name.lastIndexOf(":");
  return separatorIndex < 0 ? [name] : [name, name.slice(separatorIndex + 1)];
}

/**
 * How directly the query names a command. Lower wins: the whole canonical
 * name, then a namespaced skill's bare alias, then a name prefix, then a row
 * that only matched through its description or argument hint. An empty query
 * prefix-matches everything, so it ranks every row alike.
 */
function commandSuggestionMatchRank(
  suggestion: ComposerCommandSuggestion,
  normalizedQuery: string,
): number {
  const canonicalName = suggestion.name.toLowerCase();
  if (canonicalName === normalizedQuery) {
    return 0;
  }
  const names = commandSuggestionSearchNames(suggestion);
  if (names.includes(normalizedQuery)) {
    return 1;
  }
  return names.some((name) => name.startsWith(normalizedQuery)) ? 2 : 3;
}

/**
 * Relevance order for a lowercased, trimmed query. How directly the query names
 * a command outranks which section that command lives in: typing `/plan` in full
 * is an unambiguous request for the `plan` user command, and even a partial
 * `/pla` names it more directly than a skill that merely mentions "plan" in its
 * description. Matches of equal quality keep the `PROVIDER_COMMAND_SECTIONS`
 * order, so an empty query — which prefix-matches every row — leaves pure
 * section order.
 */
function compareCommandSuggestions(
  left: ComposerCommandSuggestion,
  right: ComposerCommandSuggestion,
  normalizedQuery: string,
): number {
  const byMatch =
    commandSuggestionMatchRank(left, normalizedQuery) -
    commandSuggestionMatchRank(right, normalizedQuery);
  return byMatch !== 0
    ? byMatch
    : compareCommandSuggestionSections(left, right);
}

/**
 * Put the flat command list in the exact order the menu renders it: ranked by
 * {@link compareCommandSuggestions}, then collapsed so every section's rows are
 * contiguous, ordered by where that section first appears — which puts each
 * section under its own best match. The collapse is what keeps hoisting a strong
 * match honest: the menu groups by section as it renders, so a section whose
 * rows were scattered through the flat list would paint them in a different
 * order than the composer walks them. The composer uses this exact array for
 * keyboard navigation and Enter/Tab apply, so visual grouping must never be the
 * first place ordering happens.
 */
export function orderCommandSuggestions(
  suggestions: readonly ComposerCommandSuggestion[],
  query: string,
): ComposerCommandSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const ranked = [...suggestions].sort((left, right) =>
    compareCommandSuggestions(left, right, normalizedQuery),
  );

  const bySection = new Map<
    ProviderCommandSection,
    ComposerCommandSuggestion[]
  >();
  for (const suggestion of ranked) {
    const section = providerCommandSection(suggestion);
    const existing = bySection.get(section);
    if (existing) {
      existing.push(suggestion);
      continue;
    }
    bySection.set(section, [suggestion]);
  }
  return [...bySection.values()].flat();
}

/**
 * A typeahead trigger the composer watches for. Mention triggers open the
 * mention menu and the provider-owned command trigger opens the command menu.
 * A thread is bound to one provider, so at most one command trigger is ever
 * active in a composer.
 */
export type TypeaheadTrigger =
  | { char: PluginMentionTrigger; kind: "mention" }
  | { char: PromptMentionCommandTrigger; kind: "command" };

/**
 * The trigger currently under the caret, resolved by the composer's
 * word-boundary detection. `from` is the document position of the trigger char
 * and `to` is the caret position; `query` is the text typed after the trigger
 * up to the caret (whole namespaced names like `frontend:component` are
 * captured, stopping at whitespace).
 */
export type ActiveTrigger =
  | {
      char: PluginMentionTrigger;
      kind: "mention";
      query: string;
      from: number;
      to: number;
    }
  | {
      char: PromptMentionCommandTrigger;
      kind: "command";
      query: string;
      from: number;
      to: number;
    };

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
      suggestions: readonly ComposerCommandSuggestion[];
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
