import type { Host } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { ThreadEnvironmentSelection } from "@/data/compose";
import { describeEnvironmentSelection } from "./environment-picker-model";

const host: Host = {
  id: "host_primary",
  name: "MacBook Pro",
  type: "persistent",
  status: "connected",
  lastSeenAt: null,
  maxPermissionMode: "full",
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};

const worktreeSelection: ThreadEnvironmentSelection = {
  type: "host",
  hostId: host.id,
  workspace: { type: "managed-worktree", baseBranch: null },
};

describe("describeEnvironmentSelection", () => {
  it("omits the machine name from the mobile environment label", () => {
    expect(describeEnvironmentSelection(worktreeSelection, host, []).label).toBe(
      "New worktree",
    );
  });
});
