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
  it("forwards a 20MB recording through the existing daemon wire contract", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const audioBase64 = Buffer.alloc(20 * 1024 * 1024).toString("base64");
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          if (request.command.type !== "plugin.host.call")
            throw new Error("Unexpected RPC");
          expect(request.command.input).toEqual({ id: audioBase64 });
          return { ok: true, result: { output: { path: "accepted" } } };
        },
      });
      const args = {
        pluginId: "environment-test",
        contract,
        method: "create",
        input: { id: audioBase64 },
        hostId: host.id,
        artifact: stubHostArtifact("environment-test"),
      };
      await expect(callPluginHostRpc(harness.deps, args)).resolves.toEqual({
        path: "accepted",
      });
      await expect(
        callPluginHostRpc(harness.deps, {
          ...args,
          input: { id: "x".repeat(32 * 1024 * 1024) },
        }),
      ).rejects.toThrow("exceeds 33554432 bytes");
      expect(responder.requests).toHaveLength(1);
    });
  });

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
