import { describe, expect, it } from "vitest";
import {
  buildEnvironmentRecoveryHandoffTarget,
  buildThreadHandoffLocationState,
  buildThreadHandoffPromptDraft,
  readThreadHandoffCreateSeedFromLocationState,
  THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffCreateSeed,
} from "./thread-handoff-request";

const SEED: ThreadHandoffCreateSeed = {
  environmentTarget: { type: "reuse", environmentId: "env_source" },
  projectId: "proj_source",
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Source thread",
};

describe("thread handoff request", () => {
  it("derives fresh managed and personal recovery targets", () => {
    expect(
      buildEnvironmentRecoveryHandoffTarget({
        baseBranch: "main",
        branchName: "bb/source-work",
        defaultBranch: "main",
        hostId: "host_source",
        mergeBaseBranch: "release",
        workspaceProvisionType: "managed-worktree",
      }),
    ).toEqual({
      type: "managed-worktree",
      hostId: "host_source",
      baseBranch: "bb/source-work",
      mergeBaseBranch: "release",
    });
    expect(
      buildEnvironmentRecoveryHandoffTarget({
        baseBranch: null,
        branchName: null,
        defaultBranch: null,
        hostId: "host_source",
        mergeBaseBranch: null,
        workspaceProvisionType: "personal",
      }),
    ).toEqual({ type: "personal", hostId: "host_source" });
  });

  it("does not invent a recovery target for unmanaged or branchless workspaces", () => {
    expect(
      buildEnvironmentRecoveryHandoffTarget({
        baseBranch: null,
        branchName: null,
        defaultBranch: "main",
        hostId: "host_source",
        mergeBaseBranch: null,
        workspaceProvisionType: "unmanaged",
      }),
    ).toBeNull();
    expect(
      buildEnvironmentRecoveryHandoffTarget({
        baseBranch: null,
        branchName: null,
        defaultBranch: "main",
        hostId: "host_source",
        mergeBaseBranch: null,
        workspaceProvisionType: "managed-worktree",
      }),
    ).toBeNull();
  });

  it("builds location state that focuses compose and carries its environment target", () => {
    expect(buildThreadHandoffLocationState(SEED)).toEqual({
      focusPrompt: true,
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
    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          environmentTarget: {
            type: "managed-worktree",
            hostId: "host_source",
            baseBranch: "",
          },
        },
      }),
    ).toBeNull();
    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          environmentTarget: {
            type: "managed-worktree",
            hostId: "host_source",
            baseBranch: "bb/source-work",
            mergeBaseBranch: "",
          },
        },
      }),
    ).toBeNull();
  });

  it("reads a managed-worktree recovery target", () => {
    const environmentTarget = {
      type: "managed-worktree" as const,
      hostId: "host_source",
      baseBranch: "bb/source-work",
      mergeBaseBranch: "main",
    };

    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          environmentTarget,
        },
      }),
    ).toEqual({ ...SEED, environmentTarget });
  });

  it("fills a missing recovery merge base for older navigation state", () => {
    expect(
      readThreadHandoffCreateSeedFromLocationState({
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          ...SEED,
          environmentTarget: {
            type: "managed-worktree",
            hostId: "host_source",
            baseBranch: "bb/source-work",
          },
        },
      }),
    ).toEqual({
      ...SEED,
      environmentTarget: {
        type: "managed-worktree",
        hostId: "host_source",
        baseBranch: "bb/source-work",
        mergeBaseBranch: null,
      },
    });
  });
});
