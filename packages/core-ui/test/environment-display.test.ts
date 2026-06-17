import { describe, expect, it } from "vitest";
import type { Environment } from "@bb/domain";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "../src/environment-display.js";

const localHostContext: EnvironmentDisplayHostContext = {
  locality: "local",
};

const remoteHostContext: EnvironmentDisplayHostContext = {
  locality: "remote",
};

function makeEnvironment(overrides?: Partial<Environment>): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    baseBranch: null,
    branchName: null,
    defaultBranch: null,
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("formatEnvironmentDisplay", () => {
  describe("display labels", () => {
    it("returns 'Working locally' for unmanaged workspace", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        host: localHostContext,
      });
      expect(result).toEqual({
        modeLabel: "Working locally",
        compactModeLabel: "Local",
        id: "env_test",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });

    it("returns a remote label for remote unmanaged workspace", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        host: remoteHostContext,
      });
      expect(result).toEqual({
        modeLabel: "Working remotely",
        compactModeLabel: "Remote",
        id: "env_test",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });

    it("returns 'Worktree' for worktree workspace", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isWorktree: true,
          workspaceProvisionType: "managed-worktree",
        }),
        host: remoteHostContext,
      });
      expect(result).toEqual({
        modeLabel: "Worktree",
        compactModeLabel: "Worktree",
        id: "env_test",
        mode: "worktree",
        workspaceDisplayKind: "managed-worktree",
      });
    });

    it("uses a custom environment name when one is present", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isWorktree: true,
          name: "Review workspace",
          workspaceProvisionType: "managed-worktree",
        }),
        host: remoteHostContext,
      });

      expect(result.modeLabel).toBe("Review workspace");
      expect(result.compactModeLabel).toBe("Review workspace");
    });

    it("does not compact custom names that resemble generated labels", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          name: "Working locally copy",
        }),
        host: remoteHostContext,
      });

      expect(result.modeLabel).toBe("Working locally copy");
      expect(result.compactModeLabel).toBe("Working locally copy");
    });

    it("uses local direct-workspace display for personal environments", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isGitRepo: false,
          workspaceProvisionType: "personal",
        }),
        host: localHostContext,
      });
      expect(result).toMatchObject({
        modeLabel: "Working locally",
        compactModeLabel: "Local",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });
  });

  describe("provisioning", () => {
    it("reports 'Provisioning' for a worktree env before discovery populates isWorktree", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          status: "provisioning",
          workspaceProvisionType: "managed-worktree",
          isWorktree: false,
        }),
        host: remoteHostContext,
      });
      expect(result.modeLabel).toBe("Provisioning");
      expect(result.compactModeLabel).toBe("Provisioning");
      // Discovered structural properties are not yet known mid-provision.
      expect(result.mode).toBe("direct");
    });

    it("reports 'Provisioning' for a prepared managed worktree before the workspace path exists", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          status: "ready",
          path: null,
          workspaceProvisionType: "managed-worktree",
          isWorktree: false,
        }),
        host: remoteHostContext,
      });
      expect(result).toEqual({
        modeLabel: "Provisioning",
        compactModeLabel: "Provisioning",
        id: "env_test",
        mode: "direct",
        workspaceDisplayKind: "managed-worktree",
      });
    });

    it("reports 'Provisioning' for a local unmanaged env", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({ status: "provisioning" }),
        host: localHostContext,
      });
      expect(result.modeLabel).toBe("Provisioning");
      expect(result.compactModeLabel).toBe("Provisioning");
    });

    it("reports 'Provisioning' before local or remote display applies", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({ status: "provisioning" }),
        host: remoteHostContext,
      });
      expect(result).toEqual({
        modeLabel: "Provisioning",
        compactModeLabel: "Provisioning",
        id: "env_test",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });
  });
});
