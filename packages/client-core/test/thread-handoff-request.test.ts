import { describe, expect, it } from "vitest";
import {
  buildThreadHandoffCreateRequest,
  buildThreadHandoffFollowUpDraft,
  buildThreadHandoffLocationState,
  buildThreadHandoffPromptDraft,
  readThreadHandoffCreateSeedFromLocationState,
  THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffCreateSeed,
  type ThreadHandoffExecutionSelection,
} from "../src/prompt/thread-handoff-request.js";

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

const EXECUTION: ThreadHandoffExecutionSelection = {
  providerId: "claude-code",
  model: "claude-opus-5",
  reasoningLevel: "high",
  serviceTier: "fast",
  supportsServiceTier: true,
  permissionMode: "auto",
  executionInputSources: { model: "explicit", reasoningLevel: "explicit" },
};

describe("buildThreadHandoffFollowUpDraft", () => {
  it("keeps follow-up mentions anchored after the source thread mention", () => {
    const draft = buildThreadHandoffFollowUpDraft(SEED, {
      text: "Also see @thread:thr_other next",
      mentions: [
        {
          start: 9,
          end: 26,
          resource: {
            kind: "thread",
            projectId: "proj_source",
            threadId: "thr_other",
            label: "Other thread",
          },
        },
      ],
      attachments: [],
    });

    expect(draft.text).toBe(
      "Continue from @thread:thr_source\n\nAlso see @thread:thr_other next",
    );
    expect(draft.mentions).toHaveLength(2);
    expect(
      draft.text.slice(draft.mentions[0]!.start, draft.mentions[0]!.end),
    ).toBe("@thread:thr_source");
    expect(
      draft.text.slice(draft.mentions[1]!.start, draft.mentions[1]!.end),
    ).toBe("@thread:thr_other");
  });
});

describe("buildThreadHandoffCreateRequest", () => {
  it("creates a thread on the selected provider that continues the source thread", () => {
    const request = buildThreadHandoffCreateRequest({
      execution: EXECUTION,
      followUp: { text: "Refactor the tests", mentions: [], attachments: [] },
      seed: SEED,
    });

    expect(request).toEqual({
      environment: { type: "reuse", environmentId: "env_source" },
      executionInputSources: {
        providerId: "explicit",
        model: "explicit",
        reasoningLevel: "explicit",
      },
      input: [
        {
          type: "text",
          text: "Continue from @thread:thr_source\n\nRefactor the tests",
          mentions: [
            {
              start: 14,
              end: 32,
              resource: {
                kind: "thread",
                projectId: "proj_source",
                threadId: "thr_source",
                label: "Source thread",
              },
            },
          ],
        },
      ],
      model: "claude-opus-5",
      permissionMode: "auto",
      projectId: "proj_source",
      providerId: "claude-code",
      reasoningLevel: "high",
      serviceTier: "fast",
      startedOnBehalfOf: null,
    });
  });

  it("falls back to the project default environment and drops unsupported service tiers", () => {
    const request = buildThreadHandoffCreateRequest({
      execution: { ...EXECUTION, supportsServiceTier: false },
      followUp: { text: "Keep going", mentions: [], attachments: [] },
      seed: { ...SEED, environmentId: null },
      sendAt: 1_700_000_000_000,
    });

    expect(request?.environment).toEqual({ type: "project-default" });
    expect(request).not.toHaveProperty("serviceTier");
    expect(request?.sendAt).toBe(1_700_000_000_000);
  });

  it("returns null without follow-up input or a resolved model", () => {
    expect(
      buildThreadHandoffCreateRequest({
        execution: EXECUTION,
        followUp: { text: "   ", mentions: [], attachments: [] },
        seed: SEED,
      }),
    ).toBeNull();
    expect(
      buildThreadHandoffCreateRequest({
        execution: { ...EXECUTION, model: "" },
        followUp: { text: "Keep going", mentions: [], attachments: [] },
        seed: SEED,
      }),
    ).toBeNull();
  });
});
