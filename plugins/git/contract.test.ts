import { describe, expect, it } from "vitest";
import { makeWorkspaceStatus } from "./testing.js";
import { gitDiffResultSchema, gitStatusResultSchema } from "./contract.js";
import type {
  WorkspaceResolutionFailure,
} from "bb-environment-provider-host/git-types";

const WORKSPACE_RESOLUTION_FAILURE: WorkspaceResolutionFailure = {
  code: "path_not_found",
  workspacePath: "/tmp/missing-workspace",
  message: "Managed workspace path does not exist: /tmp/missing-workspace",
};

describe("git read results", () => {
  it("uses explicit status outcomes instead of nullable parallel fields", () => {
    expect(
      gitStatusResultSchema.safeParse({
        outcome: "available",
        workspace: makeWorkspaceStatus(),
      }).success,
    ).toBe(true);
    expect(
      gitStatusResultSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace status is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      gitStatusResultSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      gitStatusResultSchema.safeParse({
        workspace: null,
        workspaceUnavailable: null,
      }).success,
    ).toBe(false);
  });

  it("uses explicit diff outcomes instead of nullable parallel fields", () => {
    expect(
      gitDiffResultSchema.safeParse({
        outcome: "available",
        diff: {
          diff: "",
          files: "",
          mergeBaseRef: null,
          shortstat: "",
          truncated: false,
        },
      }).success,
    ).toBe(true);
    expect(
      gitDiffResultSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace diff is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      gitDiffResultSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      gitDiffResultSchema.safeParse({
        diff: null,
        workspaceUnavailable: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(false);
  });

});
