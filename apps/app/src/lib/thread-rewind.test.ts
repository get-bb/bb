import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  buildThreadRewindIdempotencyKey,
  displacedTurnCountLabel,
  isThreadRewindCandidateRow,
  restoreThreadRewindDraft,
  threadRewindFailureMessage,
  threadRewindIneligibilityDescription,
} from "./thread-rewind";

function userRow(
  overrides: Partial<Parameters<typeof isThreadRewindCandidateRow>[0]> = {},
) {
  return {
    initiator: "user" as const,
    role: "user" as const,
    senderThreadId: null,
    sourceSeqStart: 42,
    turnId: "turn_1",
    turnRequest: { kind: "message" as const, status: "accepted" as const },
    ...overrides,
  };
}

describe("isThreadRewindCandidateRow", () => {
  it("accepts a completed, human-authored root message", () => {
    expect(isThreadRewindCandidateRow(userRow())).toBe(true);
  });

  it("rejects assistant rows", () => {
    expect(
      isThreadRewindCandidateRow(userRow({ initiator: "agent" })),
    ).toBe(false);
  });

  it("rejects side-chat rows", () => {
    expect(
      isThreadRewindCandidateRow(
        userRow({ senderThreadId: "thr_side" }),
      ),
    ).toBe(false);
  });

  it("rejects steers", () => {
    expect(
      isThreadRewindCandidateRow(
        userRow({ turnRequest: { kind: "steer", status: "accepted" } }),
      ),
    ).toBe(false);
  });

  it("rejects rows without a turn id or sequence", () => {
    expect(isThreadRewindCandidateRow(userRow({ turnId: null }))).toBe(false);
    expect(
      isThreadRewindCandidateRow(userRow({ sourceSeqStart: -1 })),
    ).toBe(false);
  });
});

describe("restoreThreadRewindDraft", () => {
  it("round-trips text-only inputs into a composer draft", () => {
    const input: PromptInput[] = [
      {
        type: "text",
        text: "Fix the sidebar overflow",
        mentions: [],
      },
    ];
    expect(restoreThreadRewindDraft(input)).toEqual({
      text: "Fix the sidebar overflow",
      mentions: [],
      attachments: [],
    });
  });

  it("restores mentions without dropping them", () => {
    const input: PromptInput[] = [
      {
        type: "text",
        text: "Ask @ada about the layout",
        mentions: [
          {
            start: 5,
            end: 9,
            resource: {
              kind: "thread",
              threadId: "thr_ada",
              label: "ada",
            },
          },
        ],
      },
    ];
    const draft = restoreThreadRewindDraft(input);
    expect(draft.text).toBe("Ask @ada about the layout");
    expect(draft.mentions).toHaveLength(1);
    expect(draft.mentions[0]?.resource).toMatchObject({
      kind: "thread",
      threadId: "thr_ada",
    });
  });

  it("restores local files and images into draft attachments", () => {
    const input: PromptInput[] = [
      { type: "text", text: "Review these", mentions: [] },
      { type: "localFile", path: "/tmp/a.md", name: "a.md", sizeBytes: 3 },
      { type: "localImage", path: "/tmp/b.png" },
    ];
    const draft = restoreThreadRewindDraft(input);
    expect(draft.attachments).toEqual([
      expect.objectContaining({ type: "localFile", path: "/tmp/a.md" }),
      expect.objectContaining({ type: "localImage", path: "/tmp/b.png" }),
    ]);
  });

  it("drops remote images rather than guessing at a local path", () => {
    const input: PromptInput[] = [
      { type: "text", text: "See screenshot", mentions: [] },
      { type: "image", url: "https://example.com/shot.png" },
    ];
    const draft = restoreThreadRewindDraft(input);
    expect(draft.attachments).toEqual([]);
    expect(draft.text).toBe("See screenshot");
  });
});

describe("buildThreadRewindIdempotencyKey", () => {
  it("stays stable for one edit session and differs across sessions", () => {
    const base = {
      branchId: "br_1",
      sourceSequence: 42,
      threadId: "thr_1",
      turnId: "turn_1",
    };
    const first = buildThreadRewindIdempotencyKey({
      ...base,
      randomSuffix: "abc",
    });
    const second = buildThreadRewindIdempotencyKey({
      ...base,
      randomSuffix: "abc",
    });
    const third = buildThreadRewindIdempotencyKey({
      ...base,
      randomSuffix: "def",
    });
    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(first).toContain("thr_1:br_1:42:turn_1:abc");
  });
});

describe("copy helpers", () => {
  it("pluralizes the displaced turn count", () => {
    expect(displacedTurnCountLabel(1)).toBe("1 later turn");
    expect(displacedTurnCountLabel(4)).toBe("4 later turns");
  });

  it("explains every ineligibility reason in user-facing terms", () => {
    const reasons = [
      "thread-not-idle",
      "pending-interaction",
      "queued-input",
      "first-message",
      "not-human-root-turn",
      "turn-incomplete",
      "grouped-input",
      "steer",
      "attachments-not-supported",
      "mentions-not-supported",
      "compaction-boundary",
      "missing-provider-checkpoint",
      "ambiguous-provider-checkpoint",
      "unsupported-provider",
      "archived-thread",
      "fork-thread",
      "side-chat",
      "workspace-restore-not-supported",
      "stale-preview",
    ] as const;
    for (const reason of reasons) {
      expect(threadRewindIneligibilityDescription(reason).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("explains every commit failure reason", () => {
    const codes = [
      "thread-not-found",
      "thread-not-idle",
      "pending-interaction",
      "queued-input",
      "rewind-in-progress",
      "target-ineligible",
      "provider-branch-failed",
      "provider-session-unavailable",
      "branch-commit-failed",
      "workspace-restore-not-supported",
      "stale-preview",
    ] as const;
    for (const code of codes) {
      expect(threadRewindFailureMessage(code).length).toBeGreaterThan(0);
    }
  });
});
