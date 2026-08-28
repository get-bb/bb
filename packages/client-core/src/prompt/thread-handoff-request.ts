import type { PromptTextMention } from "@bb/domain";
import { z } from "zod";
import type { PromptDraftState } from "./prompt-draft.js";

export const THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY =
  "threadHandoffCreateSeed";

export interface ThreadHandoffCreateSeed {
  environmentId: string | null;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

interface ThreadHandoffLocationState {
  focusPrompt: true;
  reuseEnvironmentId?: string;
  [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: ThreadHandoffCreateSeed;
}

const threadHandoffCreateSeedSchema = z.object({
  environmentId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  projectId: z.string().min(1),
  sourceThreadId: z.string().min(1),
  sourceThreadTitle: z.string().trim().min(1),
});

const threadHandoffLocationStateSchema = z
  .object({
    [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]:
      threadHandoffCreateSeedSchema,
  })
  .passthrough();

export function buildThreadHandoffLocationState(
  seed: ThreadHandoffCreateSeed,
): ThreadHandoffLocationState {
  const state: ThreadHandoffLocationState = {
    focusPrompt: true,
    [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: seed,
  };
  if (seed.environmentId !== null) {
    state.reuseEnvironmentId = seed.environmentId;
  }
  return state;
}

export function readThreadHandoffCreateSeedFromLocationState<T>(
  state: T,
): ThreadHandoffCreateSeed | null {
  const parsed = threadHandoffLocationStateSchema.safeParse(state);
  return parsed.success
    ? parsed.data[THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]
    : null;
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
