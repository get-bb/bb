import type { WorkspaceCommitSummary } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  ALL_DIFF_SELECTION,
  buildDiffIdentity,
  buildDiffSelectionOptions,
  buildDiffTarget,
  buildEnvironmentDiffArgs,
  COMMITTED_DIFF_SELECTION,
  diffSelectionForTarget,
  diffTargetKey,
  shouldResetDiffSelection,
  UNCOMMITTED_DIFF_SELECTION,
} from "./diff-target";

const commit = (sha: string, subject: string): WorkspaceCommitSummary => ({
  sha,
  shortSha: sha.slice(0, 7),
  subject,
  authorName: "dev",
  authoredAt: 0,
});

describe("buildDiffTarget", () => {
  it("defaults to all changes against the merge base", () => {
    expect(buildDiffTarget(null, "main")).toEqual({
      type: "all",
      mergeBaseBranch: "main",
    });
    expect(buildDiffTarget(ALL_DIFF_SELECTION, "main")).toEqual({
      type: "all",
      mergeBaseBranch: "main",
    });
  });

  it("maps the committed / uncommitted picks and a commit sha", () => {
    expect(buildDiffTarget(COMMITTED_DIFF_SELECTION, "main")).toEqual({
      type: "branch_committed",
      mergeBaseBranch: "main",
    });
    expect(buildDiffTarget(UNCOMMITTED_DIFF_SELECTION, "main")).toEqual({
      type: "uncommitted",
    });
    expect(buildDiffTarget("abc1234def", "main")).toEqual({
      type: "commit",
      sha: "abc1234def",
    });
  });

  it("falls back to the working tree when there is no merge base", () => {
    expect(buildDiffTarget(null, undefined)).toEqual({ type: "uncommitted" });
    expect(buildDiffTarget(COMMITTED_DIFF_SELECTION, undefined)).toEqual({
      type: "uncommitted",
    });
    // A commit pick needs no merge base.
    expect(buildDiffTarget("abc1234", undefined)).toEqual({
      type: "commit",
      sha: "abc1234",
    });
  });
});

describe("buildEnvironmentDiffArgs", () => {
  it("flattens the target into the diff/files query params", () => {
    expect(
      buildEnvironmentDiffArgs("env_1", {
        type: "all",
        mergeBaseBranch: "main",
      }),
    ).toEqual({
      environmentId: "env_1",
      target: "all",
      mergeBaseBranch: "main",
    });
    expect(
      buildEnvironmentDiffArgs("env_1", {
        type: "branch_committed",
        mergeBaseBranch: "release/1.0",
      }),
    ).toEqual({
      environmentId: "env_1",
      target: "branch_committed",
      mergeBaseBranch: "release/1.0",
    });
    expect(buildEnvironmentDiffArgs("env_1", { type: "uncommitted" })).toEqual({
      environmentId: "env_1",
      target: "uncommitted",
    });
    expect(
      buildEnvironmentDiffArgs("env_1", { type: "commit", sha: "deadbeef" }),
    ).toEqual({ environmentId: "env_1", target: "commit", sha: "deadbeef" });
  });
});

describe("selection options + reset", () => {
  const commits = [
    commit("1111111aaaa", "First"),
    commit("2222222bbbb", "Second"),
  ];

  it("offers only 'all' without any merge-base context", () => {
    expect(
      buildDiffSelectionOptions([], { hasUncommittedChanges: false }),
    ).toEqual([{ value: ALL_DIFF_SELECTION, label: "All changes" }]);
  });

  it("adds committed / uncommitted and one row per commit", () => {
    const options = buildDiffSelectionOptions(commits, {
      hasUncommittedChanges: true,
    });
    expect(options.map((option) => option.value)).toEqual([
      ALL_DIFF_SELECTION,
      COMMITTED_DIFF_SELECTION,
      UNCOMMITTED_DIFF_SELECTION,
      "1111111aaaa",
      "2222222bbbb",
    ]);
    expect(options[3]).toEqual({
      value: "1111111aaaa",
      label: "First",
      monoPrefix: "1111111",
    });
    expect(
      buildDiffSelectionOptions(commits, { hasUncommittedChanges: false }).map(
        (option) => option.value,
      ),
    ).not.toContain(UNCOMMITTED_DIFF_SELECTION);
  });

  it("resets a pick that no longer matches the workspace", () => {
    expect(
      shouldResetDiffSelection(null, [], { hasUncommittedChanges: false }),
    ).toBe(false);
    expect(
      shouldResetDiffSelection(COMMITTED_DIFF_SELECTION, [], {
        hasUncommittedChanges: true,
      }),
    ).toBe(true);
    expect(
      shouldResetDiffSelection(UNCOMMITTED_DIFF_SELECTION, commits, {
        hasUncommittedChanges: false,
      }),
    ).toBe(true);
    expect(
      shouldResetDiffSelection("2222222bbbb", commits, {
        hasUncommittedChanges: false,
      }),
    ).toBe(false);
    expect(
      shouldResetDiffSelection("gone", commits, {
        hasUncommittedChanges: false,
      }),
    ).toBe(true);
  });
});

describe("keys + identity", () => {
  it("keys the cache on the branch / sha and round-trips the picker value", () => {
    expect(diffTargetKey({ type: "uncommitted" })).toBeNull();
    expect(diffTargetKey({ type: "all", mergeBaseBranch: "main" })).toBe(
      "main",
    );
    expect(diffTargetKey({ type: "commit", sha: "abc" })).toBe("abc");
    expect(diffSelectionForTarget({ type: "uncommitted" })).toBe(
      UNCOMMITTED_DIFF_SELECTION,
    );
    expect(diffSelectionForTarget({ type: "commit", sha: "abc" })).toBe("abc");
  });

  it("scopes the identity on the resolved merge-base sha", () => {
    const target = { type: "all", mergeBaseBranch: "main" } as const;
    const pending = buildDiffIdentity({
      environmentId: "env_1",
      target,
      mergeBaseRef: null,
    });
    const resolved = buildDiffIdentity({
      environmentId: "env_1",
      target,
      mergeBaseRef: "abc123",
    });
    expect(pending).toBe("env_1:all:main:pending");
    expect(resolved).toBe("env_1:all:main:abc123");
    expect(
      buildDiffIdentity({
        environmentId: "env_1",
        target: { type: "uncommitted" },
        mergeBaseRef: "abc123",
      }),
    ).toBe("env_1:uncommitted");
  });
});
