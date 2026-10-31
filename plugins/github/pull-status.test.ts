import { describe, expect, it } from "vitest";
import {
  assemblePullStatus,
  COLLAPSED_PULL_GROUPS,
  inPullView,
  mergeBlockedReason,
  pullGlyph,
  pullGroup,
  pullNextStep,
  pullPreset,
  pullStateCommands,
  stackChain,
  type PullStatus,
  type RawPullStatus,
} from "./pull-status.js";

function raw(overrides: Partial<RawPullStatus> = {}): RawPullStatus {
  return {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "0000000",
    isCrossRepository: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    mergedAt: null,
    checksVerdict: null,
    stack: null,
    headOwner: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    isInMergeQueue: false,
    requestedReviewers: [],
    checkRunCounts: [{ state: "SUCCESS", count: 4 }],
    statusContextCounts: [],
    ...overrides,
  };
}

describe("pull request groups", () => {
  it("puts a review requested from the viewer in Your move, and leaves others waiting", () => {
    const status = assemblePullStatus(raw({ requestedReviewers: ["Octocat"] }));
    expect(pullGroup(status, "alice", "octocat")).toBe("you");
    expect(pullGroup(status, "alice", "hubot")).toBe("review");
    expect(pullGroup(status, "alice", null)).toBe("review");
    expect(pullNextStep(status, "you")).toBe("Your review is requested");
    expect(pullNextStep(status, "review")).toBe("Review requested");
    expect(pullGlyph(status, "you")).toMatchObject({
      icon: "Eye",
      tone: "you",
    });
  });

  it("puts changes requested on the viewer's own pull request in Your move", () => {
    const status = assemblePullStatus(
      raw({ reviewDecision: "CHANGES_REQUESTED" }),
    );
    expect(pullGroup(status, "alice", "alice")).toBe("you");
    expect(pullGroup(status, "alice", "bob")).toBe("fixing");
    expect(pullNextStep(status, "you")).toBe("Changes requested");
    expect(pullGlyph(status, "you").tone).toBe("action");
  });

  it("ranks conflicts and failing checks above a draft, and keeps drafts out of Ready", () => {
    const failingDraft = assemblePullStatus(
      raw({ isDraft: true, checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    );
    expect(failingDraft.state).toBe("draft");
    expect(pullGroup(failingDraft, "alice", null)).toBe("fixing");
    expect(pullNextStep(failingDraft, "fixing")).toBe("Checks failing");

    const greenDraft = assemblePullStatus(raw({ isDraft: true }));
    expect(pullGroup(greenDraft, "alice", null)).toBe("draft");
    expect(pullNextStep(greenDraft, "draft")).toBe("Checks passing");

    const conflicting = assemblePullStatus(
      raw({
        mergeable: "CONFLICTING",
        checkRunCounts: [{ state: "FAILURE", count: 3 }],
      }),
    );
    expect(conflicting.attention).toBe("conflicts");
    expect(pullNextStep(conflicting, "fixing")).toBe("Merge conflicts");
  });

  it("does not call a pull request ready while GitHub has not computed mergeability", () => {
    const unknown = assemblePullStatus(raw({ mergeable: "UNKNOWN" }));
    expect(unknown.attention).toBe("none");
    expect(pullGroup(unknown, "alice", null)).toBe("open");
    expect(pullGlyph(unknown, "open")).toMatchObject({
      icon: "GitPullRequest",
      tone: "waiting",
    });
  });

  it("keeps a pull request in a merge queue out of Ready to merge", () => {
    const queued = assemblePullStatus(raw({ isInMergeQueue: true }));
    expect(queued.attention).toBe("queued");
    expect(pullGroup(queued, "alice", null)).toBe("progress");
    expect(pullNextStep(queued, "progress")).toBe("Queued to merge");
  });

  it("names the base of merged pull requests and ignores their checks", () => {
    const merged = assemblePullStatus(
      raw({ state: "MERGED", baseRefName: "release", checkRunCounts: [] }),
    );
    expect(pullGroup(merged, "alice", "alice")).toBe("merged");
    expect(pullNextStep(merged, "merged")).toBe("Merged into release");
    expect(pullGlyph(merged, "merged").tone).toBe("merged");
  });
});

describe("snoozed groups and ready pull requests", () => {
  it("parks a snoozed pull request in Snoozed until it is merged or closed", () => {
    const failing = assemblePullStatus(
      raw({ checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    );
    expect(pullGroup(failing, "alice", null, { snoozed: true })).toBe(
      "snoozed",
    );
    expect(pullGlyph(failing, "snoozed")).toMatchObject({
      icon: "TimeSchedule",
      label: "Snoozed",
    });
    const merged = assemblePullStatus(raw({ state: "MERGED" }));
    expect(pullGroup(merged, "alice", null, { snoozed: true })).toBe("merged");
  });

  it("names the checks while GitHub has not computed mergeability", () => {
    const unknown = assemblePullStatus(raw({ mergeable: "UNKNOWN" }));
    expect(pullNextStep(unknown, "open")).toBe("Checks passing");
  });

  it("calls a mergeable pull request without checks ready, and names an approval", () => {
    const noChecks = assemblePullStatus(raw({ checkRunCounts: [] }));
    expect(noChecks.attention).toBe("ready_to_merge");
    expect(pullNextStep(noChecks, "ready")).toBe("No checks");
    const approved = assemblePullStatus(raw({ reviewDecision: "APPROVED" }));
    expect(pullNextStep(approved, "ready")).toBe("Approved");
    expect(pullNextStep(assemblePullStatus(raw()), "ready")).toBe(
      "Checks passing",
    );
  });
});

describe("views", () => {
  const view = (
    name: Parameters<typeof inPullView>[0],
    overrides: Partial<RawPullStatus>,
    author: string,
    viewer: string | null,
  ) => {
    const pr = assemblePullStatus(raw(overrides));
    return inPullView(
      name,
      { pr, author, group: pullGroup(pr, author, viewer) },
      viewer,
    );
  };
  const failing = { checkRunCounts: [{ state: "FAILURE", count: 1 }] };

  it("keeps the inbox to what needs the viewer: their review, and their own pull requests", () => {
    expect(view("inbox", { requestedReviewers: ["bob"] }, "alice", "bob")).toBe(
      true,
    );
    expect(view("inbox", failing, "Bob", "bob")).toBe(true);
    expect(view("inbox", {}, "bob", "bob")).toBe(true);
    expect(view("inbox", failing, "alice", "bob")).toBe(false);
    expect(view("inbox", {}, "alice", "bob")).toBe(false);
    expect(view("inbox", { requestedReviewers: ["carol"] }, "bob", "bob")).toBe(
      false,
    );
    expect(view("inbox", { isDraft: true }, "bob", "bob")).toBe(false);
    expect(view("inbox", failing, "bob", null)).toBe(false);
  });

  it("lists the viewer's own under Mine, every open one under All, and the merged ones apart", () => {
    expect(view("mine", { isDraft: true }, "Alice", "alice")).toBe(true);
    expect(view("mine", { isDraft: true }, "alice", "bob")).toBe(false);
    expect(view("mine", { isDraft: true }, "alice", null)).toBe(false);
    expect(view("all", { state: "CLOSED" }, "alice", null)).toBe(true);
    expect(view("all", { state: "MERGED" }, "alice", null)).toBe(false);
    expect(view("merged", { state: "MERGED" }, "alice", null)).toBe(true);
    expect([...COLLAPSED_PULL_GROUPS.inbox]).toEqual(["snoozed"]);
  });
});

describe("agent presets and merge reasons", () => {
  it("picks the preset from what the viewer's own pull request needs, and review for anyone else's", () => {
    const own = (status: PullStatus) =>
      pullPreset(status, "octocat", "octocat");
    expect(own(assemblePullStatus(raw({ mergeable: "CONFLICTING" })))).toBe(
      "conflicts",
    );
    const failing = assemblePullStatus(
      raw({ checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    );
    expect(own(failing)).toBe("fix");
    expect(
      own(assemblePullStatus(raw({ reviewDecision: "CHANGES_REQUESTED" }))),
    ).toBe("feedback");
    expect(own(assemblePullStatus(raw({ isDraft: true })))).toBe("review");
    expect(own(assemblePullStatus(raw()))).toBe("review");
    expect(pullPreset(failing, "hubot", "octocat")).toBe("review");
    expect(pullPreset(failing, "hubot", null)).toBe("fix");
  });

  it("says why a pull request cannot be merged yet, with one rule for the list and the detail", () => {
    const failing = assemblePullStatus(
      raw({ checkRunCounts: [{ state: "FAILURE", count: 2 }] }),
    );
    expect(mergeBlockedReason(assemblePullStatus(raw()))).toBeNull();
    expect(mergeBlockedReason(assemblePullStatus(raw({ isDraft: true })))).toBe(
      "Mark it ready first",
    );
    expect(mergeBlockedReason(failing)).toBe("Checks failing");
    expect(mergeBlockedReason(failing, "UNSTABLE")).toBeNull();
    expect(mergeBlockedReason(failing, "BLOCKED")).toBe("Blocked by rules");
    expect(mergeBlockedReason(assemblePullStatus(raw()), "BEHIND")).toBe(
      "Behind main",
    );
    expect(
      mergeBlockedReason(assemblePullStatus(raw({ mergeable: "CONFLICTING" }))),
    ).toBe("Conflicts with main");
    expect(
      mergeBlockedReason(
        assemblePullStatus(raw({ mergeable: "CONFLICTING" })),
        "CLEAN",
      ),
    ).toBe("Conflicts with main");
    expect(
      mergeBlockedReason(assemblePullStatus(raw({ isInMergeQueue: true }))),
    ).toBe("Queued to merge");
  });
});

describe("stack chains", () => {
  const pull = (
    number: number,
    head: string,
    base: string,
    state = "OPEN",
  ) => ({
    repo: "acme/one",
    number,
    pr: assemblePullStatus(
      raw({
        state: state as RawPullStatus["state"],
        headRefName: head,
        baseRefName: base,
      }),
    ),
  });

  it("walks down to the root and up through the first child", () => {
    const pulls = [
      pull(1, "a", "main"),
      pull(2, "b", "a"),
      pull(3, "c", "b"),
      pull(4, "x", "b"),
      pull(5, "lone", "main"),
      pull(6, "d", "c", "MERGED"),
    ];
    const numbers = (index: number) =>
      stackChain(pulls[index]!, pulls)?.map((entry) => entry.number) ?? null;
    expect(numbers(0)).toEqual([1, 2, 3]);
    expect(numbers(1)).toEqual([1, 2, 3]);
    expect(numbers(3)).toEqual([1, 2, 4]);
    expect(numbers(4)).toBeNull();
    expect(numbers(5)).toBeNull();
  });

  it("stops on a cycle", () => {
    const pulls = [pull(1, "a", "b"), pull(2, "b", "a")];
    expect(stackChain(pulls[0]!, pulls)?.map((entry) => entry.number)).toEqual([
      2, 1,
    ]);
  });
});

describe("pull request state changes", () => {
  it("runs the gh commands that reach each state", () => {
    const open = { state: "OPEN", isDraft: false } as const;
    const draft = { state: "OPEN", isDraft: true } as const;
    const closed = { state: "CLOSED", isDraft: false } as const;
    const closedDraft = { state: "CLOSED", isDraft: true } as const;

    expect(pullStateCommands(open, "draft")).toEqual([["ready", "--undo"]]);
    expect(pullStateCommands(open, "closed")).toEqual([["close"]]);
    expect(pullStateCommands(open, "open")).toEqual([]);
    expect(pullStateCommands(draft, "open")).toEqual([["ready"]]);
    expect(pullStateCommands(draft, "closed")).toEqual([["close"]]);
    expect(pullStateCommands(closed, "open")).toEqual([["reopen"]]);
    expect(pullStateCommands(closed, "draft")).toEqual([
      ["reopen"],
      ["ready", "--undo"],
    ]);
    expect(pullStateCommands(closedDraft, "open")).toEqual([
      ["reopen"],
      ["ready"],
    ]);
    expect(pullStateCommands(closedDraft, "draft")).toEqual([["reopen"]]);
    expect(pullStateCommands(closed, "closed")).toEqual([]);
  });

  it("refuses to change a merged pull request", () => {
    expect(() =>
      pullStateCommands({ state: "MERGED", isDraft: false }, "open"),
    ).toThrow("A merged pull request keeps its state.");
  });
});
