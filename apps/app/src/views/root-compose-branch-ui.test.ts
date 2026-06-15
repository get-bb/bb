import type { ProjectSourceCheckout } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildRootComposeBranchUiState,
  resolveBranchMutationBlocker,
} from "./root-compose-branch-ui";

const cleanMainCheckout: ProjectSourceCheckout = {
  branches: ["main", "release/1.2"],
  branchesTruncated: false,
  checkout: {
    kind: "branch",
    branchName: "main",
    headSha: "abc123456789",
  },
  defaultBranch: "main",
  defaultBranchRelation: null,
  hasUncommittedChanges: false,
  operation: { kind: "none" },
  originDefaultBranch: null,
  remoteBranches: [],
  remoteBranchesTruncated: false,
  selectedBranch: null,
};

const detachedCheckout: ProjectSourceCheckout = {
  ...cleanMainCheckout,
  checkout: {
    kind: "detached",
    headSha: "def987654321",
  },
};

const unbornCheckout: ProjectSourceCheckout = {
  ...cleanMainCheckout,
  checkout: {
    kind: "unborn",
    branchName: "main",
  },
};

const dirtyCheckout: ProjectSourceCheckout = {
  ...cleanMainCheckout,
  hasUncommittedChanges: true,
};

const rebaseConflictCheckout: ProjectSourceCheckout = {
  ...cleanMainCheckout,
  hasUncommittedChanges: true,
  operation: { kind: "rebase", hasConflicts: true },
};

describe("buildRootComposeBranchUiState", () => {
  it("labels local use-current without creating branch intent", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: cleanMainCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: null,
      }),
    ).toMatchObject({
      currentBranch: "main",
      currentOptionLabel: "Current: main",
      triggerLabel: "Current (main)",
      mutationBlocker: null,
    });
  });

  it("labels explicit local branch checkout as a checkout action", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: cleanMainCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: {
          name: "release/1.2",
          isNew: false,
        },
      }),
    ).toMatchObject({
      triggerLabel: "Checkout: release/1.2",
      triggerTitle: "Checkout branch: release/1.2",
    });
  });

  it("labels local new branch intent with its base branch", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: cleanMainCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: {
          name: "release/1.2",
          isNew: true,
        },
      }),
    ).toMatchObject({
      triggerLabel: "New branch from: release/1.2",
      triggerTitle: "Create a new branch from release/1.2",
    });
  });

  it("labels detached HEAD without falling back to a default branch", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: detachedCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: null,
      }),
    ).toMatchObject({
      currentBranch: null,
      currentOptionLabel: "Current (detached)",
      triggerLabel: "Current (detached)",
      mutationBlocker: {
        label: "Detached",
      },
    });
  });

  it("labels unborn branches as the current empty checkout", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: unbornCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: null,
      }),
    ).toMatchObject({
      currentBranch: null,
      currentOptionLabel: "Current (empty repo)",
      triggerLabel: "Current (empty repo)",
      mutationBlocker: {
        label: "Empty repo",
      },
    });
  });

  it("labels worktree branch selection as a base branch", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: cleanMainCheckout,
        isFetching: false,
        isLoading: false,
        mode: "worktree",
        selectedBranch: {
          name: "release/1.2",
          isNew: false,
        },
      }),
    ).toMatchObject({
      currentBranch: "main",
      currentOptionLabel: "main",
      triggerLabel: "Branch from: release/1.2",
      mutationBlocker: null,
    });
  });

  it("labels smart worktree defaults as the base branch", () => {
    expect(
      buildRootComposeBranchUiState({
        checkout: {
          ...cleanMainCheckout,
          defaultWorktreeBaseBranch: "origin/main",
          remoteBranches: ["origin/main"],
        },
        isFetching: false,
        isLoading: false,
        mode: "worktree",
        selectedBranch: null,
      }),
    ).toMatchObject({
      currentBranch: "origin/main",
      currentOptionLabel: "origin/main",
      triggerLabel: "Branch from: origin/main",
      triggerTitle: "Branch from: origin/main",
      mutationBlocker: null,
    });
  });
});

describe("resolveBranchMutationBlocker", () => {
  it("blocks local branch-changing actions when the checkout is dirty", () => {
    expect(
      resolveBranchMutationBlocker({
        checkout: dirtyCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: null,
      }),
    ).toEqual({
      label: "Dirty",
      title: "Checkout blocked by uncommitted changes",
    });
  });

  it("prioritizes unresolved conflicts over dirty status", () => {
    expect(
      resolveBranchMutationBlocker({
        checkout: rebaseConflictCheckout,
        isFetching: false,
        isLoading: false,
        mode: "local",
        selectedBranch: null,
      }),
    ).toEqual({
      label: "Conflicts",
      title: "Checkout blocked by unresolved conflicts",
    });
  });

  it("does not block managed worktree base branch selection", () => {
    expect(
      resolveBranchMutationBlocker({
        checkout: dirtyCheckout,
        isFetching: false,
        isLoading: false,
        mode: "worktree",
        selectedBranch: null,
      }),
    ).toBeNull();
  });
});
