import type {
  PermissionMode,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { AppCreateThreadRequest } from "../api-types.js";
import type { ProviderCommandSuggestion } from "./mentions/types.js";
import { promptDraftToInput, type PromptDraftState } from "./prompt-draft.js";

export interface ThreadHandoffCreateSeed {
  environmentId: string | null;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

export function buildThreadHandoffPromptDraft(
  seed: ThreadHandoffCreateSeed,
): PromptDraftState {
  const prefix = "Continue from ";
  const mentionText = `@thread:${seed.sourceThreadId}`;
  const text = `${prefix}${mentionText}`;
  const mention: PromptTextMention = {
    start: prefix.length,
    end: prefix.length + mentionText.length,
    resource: {
      kind: "thread",
      projectId: seed.projectId,
      threadId: seed.sourceThreadId,
      label: seed.sourceThreadTitle,
    },
  };

  return { text, mentions: [mention], attachments: [] };
}

const THREAD_HANDOFF_FOLLOW_UP_SEPARATOR = "\n\n";

export interface ThreadHandoffExecutionSelection {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
  permissionMode: PermissionMode;
}

interface BuildThreadHandoffCreateRequestArgs {
  draft: PromptDraftState;
  execution: ThreadHandoffExecutionSelection;
  seed: ThreadHandoffCreateSeed;
  sendAt?: number;
}

function threadHandoffPrefixLength(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): number | null {
  const handoff = buildThreadHandoffPromptDraft(seed);
  const [handoffMention] = handoff.mentions;
  const hasHandoffMention =
    handoffMention !== undefined &&
    draft.mentions.some(
      (mention) =>
        mention.start === handoffMention.start &&
        mention.end === handoffMention.end &&
        mention.resource.kind === "thread" &&
        mention.resource.threadId === seed.sourceThreadId,
    );
  if (!hasHandoffMention || !draft.text.startsWith(handoff.text)) {
    return null;
  }
  let prefixLength = handoff.text.length;
  if (prefixLength < draft.text.length && draft.text[prefixLength] !== "\n") {
    return null;
  }
  while (draft.text[prefixLength] === "\n") {
    prefixLength += 1;
  }
  return prefixLength;
}

export function buildThreadHandoffFollowUpDraft(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): PromptDraftState {
  if (threadHandoffPrefixLength(seed, draft) !== null) {
    return draft;
  }
  const handoff = buildThreadHandoffPromptDraft(seed);
  const offset =
    handoff.text.length + THREAD_HANDOFF_FOLLOW_UP_SEPARATOR.length;
  return {
    text: `${handoff.text}${THREAD_HANDOFF_FOLLOW_UP_SEPARATOR}${draft.text}`,
    mentions: [
      ...handoff.mentions,
      ...draft.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
    attachments: draft.attachments,
  };
}

export function stripThreadHandoffPrefix(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): PromptDraftState | null {
  const prefixLength = threadHandoffPrefixLength(seed, draft);
  if (prefixLength === null) {
    return null;
  }
  return {
    text: draft.text.slice(prefixLength),
    mentions: draft.mentions
      .filter((mention) => mention.start >= prefixLength)
      .map((mention) => ({
        ...mention,
        start: mention.start - prefixLength,
        end: mention.end - prefixLength,
      })),
    attachments: draft.attachments,
  };
}

export function buildThreadHandoffCreateRequest({
  draft,
  execution,
  seed,
  sendAt,
}: BuildThreadHandoffCreateRequestArgs): AppCreateThreadRequest | null {
  const input = promptDraftToInput(draft);
  if (execution.model.length === 0 || input.length === 0) {
    return null;
  }

  return {
    environment:
      seed.environmentId === null
        ? { type: "project-default" }
        : { type: "reuse", environmentId: seed.environmentId },
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      ...(execution.supportsServiceTier && execution.serviceTier
        ? { serviceTier: "explicit" as const }
        : {}),
    },
    input,
    model: execution.model,
    permissionMode: execution.permissionMode,
    projectId: seed.projectId,
    providerId: execution.providerId,
    reasoningLevel: execution.reasoningLevel,
    ...(execution.supportsServiceTier && execution.serviceTier
      ? { serviceTier: execution.serviceTier }
      : {}),
    ...(sendAt === undefined ? {} : { sendAt }),
    startedOnBehalfOf: null,
  };
}

const THREAD_HANDOFF_COMMAND_NAME = "handoff";

export const THREAD_HANDOFF_COMMAND_SUGGESTION: ProviderCommandSuggestion = {
  kind: "command",
  name: THREAD_HANDOFF_COMMAND_NAME,
  source: "command",
  origin: "builtin",
  description: "Hand off to a new thread",
  argumentHint: null,
};

export function stripLeadingThreadHandoffCommand(
  draft: PromptDraftState,
): PromptDraftState | null {
  const command = draft.mentions.find(
    (mention) =>
      mention.resource.kind === "command" &&
      mention.resource.trigger === "/" &&
      mention.resource.name === THREAD_HANDOFF_COMMAND_NAME &&
      mention.resource.source === "command" &&
      mention.resource.origin === "builtin",
  );
  if (
    command === undefined ||
    draft.text.slice(0, command.start).trim() !== ""
  ) {
    return null;
  }
  const rest = draft.text.slice(command.end);
  const cut = command.end + (rest.length - rest.trimStart().length);
  return {
    text: draft.text.slice(cut),
    mentions: draft.mentions
      .filter((mention) => mention !== command)
      .map((mention) => ({
        ...mention,
        start: mention.start - cut,
        end: mention.end - cut,
      })),
    attachments: draft.attachments,
  };
}

function hasThreadHandoffSourceMention(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): boolean {
  return draft.mentions.some(
    (mention) =>
      mention.resource.kind === "thread" &&
      mention.resource.threadId === seed.sourceThreadId,
  );
}

export function threadHandoffDraftAfterSourceRemoved(
  seed: ThreadHandoffCreateSeed,
  previous: PromptDraftState,
  next: PromptDraftState,
): PromptDraftState | null {
  if (
    !hasThreadHandoffSourceMention(seed, previous) ||
    hasThreadHandoffSourceMention(seed, next)
  ) {
    return null;
  }
  const remnant = /^Continue from\s*/.exec(next.text);
  if (remnant === null) {
    return next;
  }
  const cut = remnant[0].length;
  return {
    text: next.text.slice(cut),
    mentions: next.mentions.map((mention) => ({
      ...mention,
      start: mention.start - cut,
      end: mention.end - cut,
    })),
    attachments: next.attachments,
  };
}
