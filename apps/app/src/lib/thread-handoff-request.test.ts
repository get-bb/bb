import { describe, expect, it } from "vitest";
import {
  buildThreadHandoffLocationState,
  buildThreadHandoffPromptDraft,
  readThreadHandoffCreateSeedFromLocationState,
  THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffCreateSeed,
} from "./thread-handoff-request";

const SEED: ThreadHandoffCreateSeed = {
  environmentId: "env_source",
  projectId: "proj_source",
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Source thread",
};

describe("thread handoff request", () => {
  it("builds location state that focuses compose and reuses the source environment", () => {
    expect(buildThreadHandoffLocationState(SEED)).toEqual({
      focusPrompt: true,
      reuseEnvironmentId: "env_source",
      [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: SEED,
    });
  });

  it("reads a valid handoff seed from location state", () => {
    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          sourceThreadTitle: " Source thread ",
        },
      }),
    ).toEqual(SEED);
  });

  it("builds a prompt draft with a rich mention to the source thread", () => {
    const draft = buildThreadHandoffPromptDraft(SEED);

    expect(draft.text).toBe("Continue from @thread:thr_source");
    expect(draft.attachments).toEqual([]);
    expect(draft.mentions).toEqual([
      {
        start: "Continue from ".length,
        end: "Continue from @thread:thr_source".length,
        resource: {
          kind: "thread",
          projectId: "proj_source",
          threadId: "thr_source",
          label: "Source thread",
        },
      },
    ]);
  });

  it("returns null for unusable handoff state", () => {
    expect(readThreadHandoffCreateSeedFromLocationState(null)).toBeNull();
    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          sourceThreadId: "",
        },
      }),
    ).toBeNull();
  });
});
