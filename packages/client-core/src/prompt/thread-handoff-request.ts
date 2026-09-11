import type {
  PermissionMode,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { ExistingThreadExecutionInputSources } from "@bb/server-contract";
import type { AppCreateThreadRequest } from "../api-types.js";
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
  executionInputSources: ExistingThreadExecutionInputSources;
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
  if (!hasHandoffMention) {
    return null;
  }
  if (
    draft.text.startsWith(
      `${handoff.text}${THREAD_HANDOFF_FOLLOW_UP_SEPARATOR}`,
    )
  ) {
    return handoff.text.length + THREAD_HANDOFF_FOLLOW_UP_SEPARATOR.length;
  }
  if (draft.text === handoff.text) {
    return handoff.text.length;
  }
  return null;
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
      ...execution.executionInputSources,
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
