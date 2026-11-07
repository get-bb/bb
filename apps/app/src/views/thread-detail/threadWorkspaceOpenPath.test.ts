import type { Environment } from "@bb/domain";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { resolveThreadWorkspaceOpenPath } from "./threadWorkspaceOpenPath";

function makeWorkspaceEnvironment(
  overrides: Partial<Environment> = {},
): Environment {
  return makeEnvironment({
    baseBranch: null,
    branchName: "feature/test",
    createdAt: 1,
    hostId: "host-1",
    id: "environment-1",
    mergeBaseBranch: "main",
    path: "/tmp/workspace",
    projectId: "project-1",
    updatedAt: 1,
    ...overrides,
  });
}

describe("resolveThreadWorkspaceOpenPath", () => {
  it("hides when workspace open preconditions are missing", () => {
    expect(
      resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: true,
        environment: makeWorkspaceEnvironment(),
        hasWorkspaceOpenTargets: true,
      }),
    ).toBe("/tmp/workspace");
    expect(
      resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: true,
        environment: makeWorkspaceEnvironment({ path: null }),
        hasWorkspaceOpenTargets: true,
      }),
    ).toBeNull();
    expect(
      resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: false,
        environment: makeWorkspaceEnvironment(),
        hasWorkspaceOpenTargets: true,
      }),
    ).toBeNull();
    expect(
      resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: true,
        environment: makeWorkspaceEnvironment(),
        hasWorkspaceOpenTargets: false,
      }),
    ).toBeNull();
  });

  it("still resolves when the environment is not ready, as long as it has a path", () => {
    expect(
      resolveThreadWorkspaceOpenPath({
        canOpenWorkspace: true,
        environment: makeWorkspaceEnvironment({ status: "destroyed" }),
        hasWorkspaceOpenTargets: true,
      }),
    ).toBe("/tmp/workspace");
  });
});
