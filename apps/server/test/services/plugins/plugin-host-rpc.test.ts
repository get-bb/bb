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

const readContract = defineRpcContract({
  read: {
    experimental_retryable: true,
    input: z.object({ id: z.string() }),
    output: z.object({ path: z.string() }),
  },
});

describe("callPluginHostRpc", () => {
  it("sends a retryable read again with a new call id when the daemon drops its response", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const callIds: string[] = [];
      const cancelled: string[] = [];
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          if (request.command.type === "plugin.host.cancel") {
            cancelled.push(request.command.callId);
            return { ok: true, result: { cancelled: true } };
          }
          if (request.command.type !== "plugin.host.call")
            throw new Error(`Unexpected RPC ${request.command.type}`);
          callIds.push(request.command.callId);
          if (callIds.length === 1) return new Promise(() => {});
          return { ok: true, result: { output: { path: "read" } } };
        },
      });
      await expect(
        callPluginHostRpc(harness.deps, {
          pluginId: "environment-test",
          contract: readContract,
          method: "read",
          input: { id: "env-1" },
          hostId: host.id,
          timeoutMs: 1_000,
          artifact: stubHostArtifact("environment-test"),
        }),
      ).resolves.toEqual({ path: "read" });
      expect(callIds).toHaveLength(2);
      expect(callIds[1]).not.toBe(callIds[0]);
      await vi.waitFor(() => expect(cancelled).toEqual([callIds[0]]));
      responder.unregister();
    });
  });

  it("cancels the retried read on the daemon when the server gives up, and gives it only the time left", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const calls: { callId: string; timeoutMs: number }[] = [];
      const cancelled: string[] = [];
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          if (request.command.type === "plugin.host.cancel") {
            cancelled.push(request.command.callId);
            return { ok: true, result: { cancelled: true } };
          }
          if (request.command.type !== "plugin.host.call")
            throw new Error(`Unexpected RPC ${request.command.type}`);
          calls.push({
            callId: request.command.callId,
            timeoutMs: request.command.timeoutMs,
          });
          return new Promise(() => {});
        },
      });
      await expect(
        callPluginHostRpc(harness.deps, {
          pluginId: "environment-test",
          contract: readContract,
          method: "read",
          input: { id: "env-1" },
          hostId: host.id,
          timeoutMs: 1_000,
          artifact: stubHostArtifact("environment-test"),
        }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(2);
      expect(calls[0]?.timeoutMs).toBe(1_000);
      expect(calls[1]?.timeoutMs).toBeLessThanOrEqual(600);
      await vi.waitFor(() =>
        expect(cancelled).toEqual(
          expect.arrayContaining(calls.map((call) => call.callId)),
        ),
      );
      responder.unregister();
    });
  });

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
