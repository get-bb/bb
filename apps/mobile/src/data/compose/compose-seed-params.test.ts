import { buildThreadHandoffPromptDraft } from "@bb/client-core";
import { describe, expect, it } from "vitest";
import {
  buildForkComposeParams,
  buildHandoffComposeParams,
  buildNewThreadInWorktreeComposeParams,
  readForkSeedFromComposeParams,
  readHandoffSeedFromComposeParams,
} from "./compose-seed-params";

describe("compose seed params", () => {
  it("round-trips a fork seed through route params", () => {
    const params = buildForkComposeParams({
      environmentId: "env_1",
      projectId: "proj_1",
      sourceSeqEnd: 42,
      sourceThreadId: "thr_src",
      sourceThreadTitle: "Source thread",
    });
    expect(params).toEqual({
      projectId: "proj_1",
      reuseEnvironmentId: "env_1",
      forkSourceThreadId: "thr_src",
      forkSourceSeqEnd: "42",
      forkSourceThreadTitle: "Source thread",
    });
    expect(readForkSeedFromComposeParams(params)).toEqual({
      environmentId: "env_1",
      projectId: "proj_1",
      sourceSeqEnd: 42,
      sourceThreadId: "thr_src",
      sourceThreadTitle: "Source thread",
    });
  });

  it("drops a malformed sequence and a fork without its environment", () => {
    expect(
      readForkSeedFromComposeParams({
        projectId: "proj_1",
        reuseEnvironmentId: "env_1",
        forkSourceThreadId: "thr_src",
        forkSourceSeqEnd: "abc",
      })?.sourceSeqEnd,
    ).toBeUndefined();
    expect(
      readForkSeedFromComposeParams({
        projectId: "proj_1",
        forkSourceThreadId: "thr_src",
      }),
    ).toBeNull();
    expect(readForkSeedFromComposeParams({ projectId: "proj_1" })).toBeNull();
    // Title falls back to the id prefix, as the web does for unloaded threads.
    expect(
      readForkSeedFromComposeParams({
        projectId: "proj_1",
        reuseEnvironmentId: "env_1",
        forkSourceThreadId: "thr_source_long",
      })?.sourceThreadTitle,
    ).toBe("thr_sour");
  });

  it("round-trips a handoff seed and keeps the environment optional", () => {
    const seed = {
      environmentId: null,
      projectId: "proj_1",
      sourceThreadId: "thr_src",
      sourceThreadTitle: "Source thread",
    };
    const params = buildHandoffComposeParams(seed);
    expect(params).toEqual({
      projectId: "proj_1",
      handoffSourceThreadId: "thr_src",
      handoffSourceThreadTitle: "Source thread",
    });
    expect(readHandoffSeedFromComposeParams(params)).toEqual(seed);
    expect(
      readHandoffSeedFromComposeParams(
        buildHandoffComposeParams({ ...seed, environmentId: "env_1" }),
      )?.environmentId,
    ).toBe("env_1");
    // The seed feeds the client-core draft builder unchanged.
    expect(buildThreadHandoffPromptDraft(seed).text).toBe(
      "Continue from @thread:thr_src",
    );
  });

  it("builds the reuse-worktree params", () => {
    expect(
      buildNewThreadInWorktreeComposeParams({
        projectId: "proj_1",
        environmentId: "env_1",
      }),
    ).toEqual({ projectId: "proj_1", reuseEnvironmentId: "env_1" });
  });
});
