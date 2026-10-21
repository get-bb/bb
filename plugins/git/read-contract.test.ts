import { describe, expect, it } from "vitest";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import * as contract from "./read-contract.js";
const WORKSPACE_RESOLUTION_FAILURE = {
  code: "path_not_found",
  workspacePath: "/tmp/missing-workspace",
  message: "Managed workspace path does not exist: /tmp/missing-workspace",
};
describe("Git read response contract", () => {
  it("uses explicit status outcomes instead of nullable parallel fields", () => {
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "available",
        workspace: makeWorkspaceStatus(),
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace status is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        workspace: null,
        workspaceUnavailable: null,
      }).success,
    ).toBe(false);
  });

  it("uses explicit diff outcomes instead of nullable parallel fields", () => {
    expect(
      contract.environmentDiffResponseSchema.safeParse({
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
      contract.environmentDiffResponseSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace diff is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        diff: null,
        workspaceUnavailable: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(false);
  });
});
