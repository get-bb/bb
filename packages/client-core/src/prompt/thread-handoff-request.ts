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
  execution: ThreadHandoffExecutionSelection;
  followUp: PromptDraftState;
  seed: ThreadHandoffCreateSeed;
  sendAt?: number;
}

export function buildThreadHandoffFollowUpDraft(
  seed: ThreadHandoffCreateSeed,
  followUp: PromptDraftState,
): PromptDraftState {
  const handoff = buildThreadHandoffPromptDraft(seed);
  const offset =
    handoff.text.length + THREAD_HANDOFF_FOLLOW_UP_SEPARATOR.length;
  return {
    text: `${handoff.text}${THREAD_HANDOFF_FOLLOW_UP_SEPARATOR}${followUp.text}`,
    mentions: [
      ...handoff.mentions,
      ...followUp.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
    attachments: followUp.attachments,
  };
}

export function buildThreadHandoffCreateRequest({
  execution,
  followUp,
  seed,
  sendAt,
}: BuildThreadHandoffCreateRequestArgs): AppCreateThreadRequest | null {
  if (
    execution.model.length === 0 ||
    promptDraftToInput(followUp).length === 0
  ) {
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
    input: promptDraftToInput(buildThreadHandoffFollowUpDraft(seed, followUp)),
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
