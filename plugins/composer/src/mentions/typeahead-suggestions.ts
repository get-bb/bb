import type {
  ComposerAttachment,
  ExperimentalComposerCommandSuggestion,
  ExperimentalComposerCommandSuggestionGroup,
  ExperimentalComposerCommandTrigger,
  ExperimentalComposerMentionSuggestion,
} from "@get-bb/plugin-sdk/app";
import { isImageAttachment } from "../attachments";
import type { MentionTarget } from "../editor/composer-mentions";

export interface AttachmentMentionSuggestion {
  kind: "attachment";
  key: string;
  text: string;
  mention: Extract<MentionTarget, { kind: "attachment" }>;
}

export type MenuMentionSuggestion =
  | ExperimentalComposerMentionSuggestion
  | AttachmentMentionSuggestion;

export interface MenuMentionGroup {
  key: string;
  label: string;
  suggestions: readonly MenuMentionSuggestion[];
}

export type TypeaheadSuggestion =
  | MenuMentionSuggestion
  | ExperimentalComposerCommandSuggestion;

export type MentionMenuState =
  | { kind: "hint" }
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "results";
      groups: readonly MenuMentionGroup[];
      refreshing: boolean;
    };

export type CommandMenuState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "results";
      groups: readonly ExperimentalComposerCommandSuggestionGroup[];
      refreshing: boolean;
    };

export type TypeaheadMenuState =
  | { trigger: "mention"; state: MentionMenuState }
  | {
      trigger: "command";
      char: ExperimentalComposerCommandTrigger;
      state: CommandMenuState;
    };

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

function attachmentMatchRank(name: string, query: string): number {
  const normalizedName = normalizeTerm(name);
  if (query.length === 0 || normalizedName === query) return 0;
  return normalizedName.startsWith(query) ? 1 : 2;
}

export function attachmentMentionGroup(
  attachments: readonly ComposerAttachment[],
  query: string,
): MenuMentionGroup | null {
  const normalizedQuery = normalizeTerm(query);
  const suggestions = attachments
    .filter(
      (attachment) =>
        !isImageAttachment(attachment) &&
        attachment.name.toLowerCase().includes(normalizedQuery),
    )
    .map((attachment, index) => ({
      index,
      rank: attachmentMatchRank(attachment.name, normalizedQuery),
      suggestion: {
        kind: "attachment",
        key: JSON.stringify(["attachment", attachment.path]),
        text: attachment.name,
        mention: {
          kind: "attachment",
          path: attachment.path,
          label: attachment.name,
        },
      } satisfies AttachmentMentionSuggestion,
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ suggestion }) => suggestion);
  return suggestions.length === 0
    ? null
    : { key: "attachments", label: "Attachments", suggestions };
}

function commandSuggestionKey(
  item: ExperimentalComposerCommandSuggestion,
): string {
  return JSON.stringify([
    item.kind,
    item.source,
    item.origin,
    item.pluginId ?? null,
    item.name,
  ]);
}

export function typeaheadSuggestionKey(item: TypeaheadSuggestion): string {
  return item.kind === "command" ? commandSuggestionKey(item) : item.key;
}
