import type { PromptTextMention } from "@bb/domain";
import type { PromptDraftState } from "@/lib/prompt-draft";

export const THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY =
  "threadHandoffCreateSeed";

export interface ThreadHandoffCreateSeed {
  environmentId: string | null;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

export interface ThreadHandoffLocationState {
  focusPrompt: true;
  reuseEnvironmentId?: string;
  [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: ThreadHandoffCreateSeed;
}

export function buildThreadHandoffLocationState(
  seed: ThreadHandoffCreateSeed,
): ThreadHandoffLocationState {
  return {
    focusPrompt: true,
    ...(seed.environmentId !== null
      ? { reuseEnvironmentId: seed.environmentId }
      : {}),
    [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: seed,
  };
}

export function readThreadHandoffCreateSeedFromLocationState(
  state: unknown,
): ThreadHandoffCreateSeed | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.sourceThreadId !== "string" ||
    value.sourceThreadId.length === 0 ||
    typeof value.sourceThreadTitle !== "string" ||
    value.sourceThreadTitle.trim().length === 0
  ) {
    return null;
  }
  if (
    value.environmentId !== undefined &&
    value.environmentId !== null &&
    typeof value.environmentId !== "string"
  ) {
    return null;
  }

  const environmentId =
    typeof value.environmentId === "string" && value.environmentId.length > 0
      ? value.environmentId
      : null;

  return {
    environmentId,
    projectId: value.projectId,
    sourceThreadId: value.sourceThreadId,
    sourceThreadTitle: value.sourceThreadTitle.trim(),
  };
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
