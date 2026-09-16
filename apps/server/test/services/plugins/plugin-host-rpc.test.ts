import { projects, updateHost } from "@bb/db";
import { setMachineEnvironmentVariable } from "../../../src/services/machines/environment-storage.js";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callPluginHostRpc } from "../../../src/services/plugins/plugin-host-rpc.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import { stubHostArtifact } from "../../helpers/provider-registry.js";
import { seedHostSession } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const contract = defineRpcContract({
  create: {
    input: z.object({ id: z.string() }),
    output: z.object({ path: z.string() }),
  },
});

describe("callPluginHostRpc", () => {
  it("waits for host execution to stop after forwarding cancellation", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      let releaseCall: (() => void) | undefined;
      const callHeld = new Promise<void>((resolve) => {
        releaseCall = resolve;
      });
      let recordCancel: (() => void) | undefined;
      const cancelReceived = new Promise<void>((resolve) => {
        recordCancel = resolve;
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          if (request.command.type === "plugin.host.call") {
            await callHeld;
            return {
              ok: true,
              result: { output: { path: "/tmp/created" } },
            };
          }
          if (request.command.type === "plugin.host.cancel") {
            recordCancel?.();
            return { ok: true, result: { cancelled: true } };
          }
          throw new Error(`Unexpected RPC ${request.command.type}`);
        },
      });
      const controller = new AbortController();
      const result = callPluginHostRpc(harness.deps, {
        projectId: null,
        pluginId: "environment-test",
        contract,
        method: "create",
        input: { id: "env-1" },
        hostId: host.id,
        signal: controller.signal,
        artifact: stubHostArtifact("environment-test"),
      });
      let settled = false;
      void result.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await vi.waitFor(() =>
        expect(
          responder.requests.some(
            (request) => request.command.type === "plugin.host.call",
          ),
        ).toBe(true),
      );
      controller.abort();
      await cancelReceived;
      await Promise.resolve();
      expect(settled).toBe(false);

      releaseCall?.();
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(settled).toBe(true);
    });
  });
});

it("resolves project scope for a host call without changing host-wide settings", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps);
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "manual",
    });
    harness.db
      .insert(projects)
      .values({ id: "rpc-project", name: "RPC", createdAt: 1, updatedAt: 1 })
      .run();
    await setMachineEnvironmentVariable(
      harness.db,
      harness.config.dataDir,
      { name: "REGION", value: "project-rpc", note: null },
      "rpc-project",
    );
    const captured: unknown[] = [];
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: async (request) => {
        if (request.command.type !== "plugin.host.call")
          throw new Error("Unexpected command");
        captured.push(request.command.contributedEnv);
        return { ok: true, result: { output: { path: "/tmp/rpc" } } };
      },
    });
    for (const projectId of ["rpc-project", null])
      await callPluginHostRpc(harness.deps, {
        projectId,
        pluginId: "rpc-test",
        hostId: host.id,
        contract,
        method: "create",
        input: { id: "a" },
        artifact: stubHostArtifact("rpc-test"),
      });
    expect(captured[0]).toContainEqual(
      expect.objectContaining({
        name: "REGION",
        value: "project-rpc",
        source: { core: "project-environment" },
      }),
    );
    expect(captured[1]).not.toContainEqual(
      expect.objectContaining({ name: "REGION" }),
    );
  });
});
