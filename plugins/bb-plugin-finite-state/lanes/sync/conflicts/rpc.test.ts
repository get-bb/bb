import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { registerSyncRpc } from "../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("sync conflict RPC authorization", () => {
  it("accepts the frozen typed input then fails closed without treating request evidence as approval", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-conflict-rpc" });
    hosts.push(host);
    registerSyncRpc(host.bb, {
      db: createPluginContext(host.bb).db(),
      worktreeRoot: null,
    });
    await expect(host.harness.behavior.callRpc("syncConflictResolve", {
      projectId: "project-rpc",
      projectVersionId: "version-rpc",
      planId: "01K00000000000000000000000",
      expectedPlanSha256: "a".repeat(64),
      expectedBaseStateSha256: "b".repeat(64),
      pageSize: 50,
      continuation: null,
      humanApprovalCapability: "request-input-is-not-human-approval",
      kind: "vexDecision",
      key: "stable-vex-key",
      field: "/status",
      expectedBaseContentHash: "c".repeat(64),
      resolution: { choice: "take-theirs" },
    })).rejects.toMatchObject({
      code: "handler_error",
      message: expect.stringContaining("authorization-unavailable"),
    });
  });
});
