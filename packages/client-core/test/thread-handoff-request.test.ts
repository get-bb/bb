import { describe, expect, it } from "vitest";
import {
  buildThreadHandoffCreateRequest,
  buildThreadHandoffFollowUpDraft,
  stripLeadingThreadHandoffCommand,
  stripThreadHandoffPrefix,
  threadHandoffDraftAfterSourceRemoved,
  type ThreadHandoffCreateSeed,
  type ThreadHandoffExecutionSelection,
} from "../src/prompt/thread-handoff-request.js";

const SEED: ThreadHandoffCreateSeed = {
  environmentId: "env_source",
  projectId: "proj_source",
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Source thread",
};

const EXECUTION: ThreadHandoffExecutionSelection = {
  providerId: "claude-code",
  model: "claude-opus-5",
  reasoningLevel: "high",
  serviceTier: "fast",
  supportsServiceTier: true,
  permissionMode: "auto",
};

const SOURCE_MENTION = {
  start: 14,
  end: 32,
  resource: {
    kind: "thread" as const,
    projectId: "proj_source",
    threadId: "thr_source",
    label: "Source thread",
  },
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
    expect(draft.mentions[0]).toEqual(SOURCE_MENTION);
    expect(
      draft.text.slice(draft.mentions[1]!.start, draft.mentions[1]!.end),
    ).toBe("@thread:thr_other");
  });

  it("leaves a draft alone when it already starts with the source reference", () => {
    const draft = {
      text: "Continue from @thread:thr_source\n\nKeep going",
      mentions: [SOURCE_MENTION],
      attachments: [],
    };

    expect(buildThreadHandoffFollowUpDraft(SEED, draft)).toBe(draft);
  });
});

describe("stripThreadHandoffPrefix", () => {
  it("removes the inserted reference and re-anchors later mentions", () => {
    expect(
      stripThreadHandoffPrefix(SEED, {
        text: "Continue from @thread:thr_source\n\nSee @thread:thr_other",
        mentions: [
          SOURCE_MENTION,
          {
            start: 38,
            end: 55,
            resource: {
              kind: "thread",
              projectId: "proj_source",
              threadId: "thr_other",
              label: "Other thread",
            },
          },
        ],
        attachments: [],
      }),
    ).toEqual({
      text: "See @thread:thr_other",
      mentions: [
        {
          start: 4,
          end: 21,
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
    expect(
      stripThreadHandoffPrefix(SEED, {
        text: "Continue from @thread:thr_source",
        mentions: [SOURCE_MENTION],
        attachments: [],
      }),
    ).toEqual({ text: "", mentions: [], attachments: [] });
  });

  it("tolerates the editor collapsing the blank line after the reference", () => {
    expect(
      stripThreadHandoffPrefix(SEED, {
        text: "Continue from @thread:thr_source\nKeep going\n",
        mentions: [SOURCE_MENTION],
        attachments: [],
      }),
    ).toEqual({ text: "Keep going\n", mentions: [], attachments: [] });
    expect(
      buildThreadHandoffFollowUpDraft(SEED, {
        text: "Continue from @thread:thr_source\nKeep going",
        mentions: [SOURCE_MENTION],
        attachments: [],
      }).text,
    ).toBe("Continue from @thread:thr_source\nKeep going");
  });

  it("returns null once the user has changed the reference", () => {
    expect(
      stripThreadHandoffPrefix(SEED, {
        text: "Continue from @thread:thr_source please",
        mentions: [SOURCE_MENTION],
        attachments: [],
      }),
    ).toBeNull();
    expect(
      stripThreadHandoffPrefix(SEED, {
        text: "Continue from @thread:thr_source\n\nKeep going",
        mentions: [],
        attachments: [],
      }),
    ).toBeNull();
  });
});

describe("buildThreadHandoffCreateRequest", () => {
  it("creates a thread on the selected provider from the draft as typed", () => {
    const request = buildThreadHandoffCreateRequest({
      draft: {
        text: "Continue from @thread:thr_source\n\nRefactor the tests",
        mentions: [SOURCE_MENTION],
        attachments: [],
      },
      execution: EXECUTION,
      seed: SEED,
    });

    expect(request).toEqual({
      environment: { type: "reuse", environmentId: "env_source" },
      executionInputSources: {
        providerId: "explicit",
        model: "explicit",
        reasoningLevel: "explicit",
        serviceTier: "explicit",
        permissionMode: "explicit",
      },
      input: [
        {
          type: "text",
          text: "Continue from @thread:thr_source\n\nRefactor the tests",
          mentions: [SOURCE_MENTION],
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
      draft: { text: "Keep going", mentions: [], attachments: [] },
      execution: { ...EXECUTION, supportsServiceTier: false },
      seed: { ...SEED, environmentId: null },
      sendAt: 1_700_000_000_000,
    });

    expect(request?.environment).toEqual({ type: "project-default" });
    expect(request).not.toHaveProperty("serviceTier");
    expect(request?.executionInputSources).toEqual({
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
    });
    expect(request?.sendAt).toBe(1_700_000_000_000);
  });

  it("marks unchanged visible handoff execution as explicit", () => {
    const request = buildThreadHandoffCreateRequest({
      draft: { text: "Keep going", mentions: [], attachments: [] },
      execution: {
        ...EXECUTION,
        providerId: "codex",
        model: "gpt-5.6-sol",
        serviceTier: "default",
        permissionMode: "full",
      },
      seed: SEED,
    });

    expect(request?.executionInputSources).toEqual({
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      serviceTier: "explicit",
      permissionMode: "explicit",
    });
  });

  it("returns null without follow-up input or a resolved model", () => {
    expect(
      buildThreadHandoffCreateRequest({
        draft: { text: "   ", mentions: [], attachments: [] },
        execution: EXECUTION,
        seed: SEED,
      }),
    ).toBeNull();
    expect(
      buildThreadHandoffCreateRequest({
        draft: { text: "Keep going", mentions: [], attachments: [] },
        execution: { ...EXECUTION, model: "" },
        seed: SEED,
      }),
    ).toBeNull();
  });
});

const HANDOFF_COMMAND_MENTION = {
  start: 0,
  end: 8,
  resource: {
    kind: "command" as const,
    trigger: "/" as const,
    name: "handoff",
    source: "command" as const,
    origin: "builtin" as const,
    label: "handoff",
    argumentHint: null,
  },
};

describe("stripLeadingThreadHandoffCommand", () => {
  it("removes a leading /handoff command and keeps the rest of the draft", () => {
    const draft = stripLeadingThreadHandoffCommand({
      text: "/handoff  fix @thread:thr_other",
      mentions: [
        HANDOFF_COMMAND_MENTION,
        {
          start: 14,
          end: 31,
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

    expect(draft?.text).toBe("fix @thread:thr_other");
    expect(draft?.mentions).toEqual([
      {
        start: 4,
        end: 21,
        resource: {
          kind: "thread",
          projectId: "proj_source",
          threadId: "thr_other",
          label: "Other thread",
        },
      },
    ]);
  });

  it("ignores typed /handoff text, a provider command, and a command after other text", () => {
    expect(
      stripLeadingThreadHandoffCommand({
        text: "/handoff",
        mentions: [],
        attachments: [],
      }),
    ).toBeNull();
    expect(
      stripLeadingThreadHandoffCommand({
        text: "/handoff",
        mentions: [
          {
            ...HANDOFF_COMMAND_MENTION,
            resource: { ...HANDOFF_COMMAND_MENTION.resource, origin: "user" },
          },
        ],
        attachments: [],
      }),
    ).toBeNull();
    expect(
      stripLeadingThreadHandoffCommand({
        text: "see /handoff",
        mentions: [{ ...HANDOFF_COMMAND_MENTION, start: 4, end: 12 }],
        attachments: [],
      }),
    ).toBeNull();
  });
});

describe("threadHandoffDraftAfterSourceRemoved", () => {
  const seeded = buildThreadHandoffFollowUpDraft(SEED, {
    text: "keep going",
    mentions: [],
    attachments: [],
  });

  it("returns the draft without the block's leftover text once its source pill is deleted", () => {
    const next = {
      text: "Continue from \n\nkeep going",
      mentions: [],
      attachments: [],
    };

    expect(threadHandoffDraftAfterSourceRemoved(SEED, seeded, next)).toEqual({
      text: "keep going",
      mentions: [],
      attachments: [],
    });
  });

  it("returns an emptied draft as it is", () => {
    const empty = { text: "", mentions: [], attachments: [] };

    expect(threadHandoffDraftAfterSourceRemoved(SEED, seeded, empty)).toEqual(
      empty,
    );
  });

  it("returns null while the source pill remains or was never there", () => {
    const edited = { ...seeded, text: seeded.text.replace("keep", "kept") };

    expect(
      threadHandoffDraftAfterSourceRemoved(SEED, seeded, edited),
    ).toBeNull();
    expect(
      threadHandoffDraftAfterSourceRemoved(
        SEED,
        { text: "hi", mentions: [], attachments: [] },
        { text: "", mentions: [], attachments: [] },
      ),
    ).toBeNull();
  });
});
