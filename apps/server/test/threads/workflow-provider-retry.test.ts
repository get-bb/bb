import {
  createFakePluginHost,
  makeThreadResponse,
  makeTurnFailedEvent,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { expect, it } from "vitest";

it("does not retry an old workflow worker after Workflows replaces it", async () => {
  const workflowsPlugin: (bb: BbPluginApi) => Promise<void> = (
    await import(
      new URL("../../../../plugins/workflows/src/server.ts", import.meta.url)
        .href
    )
  ).default;
  const retryPlugin: (bb: BbPluginApi) => Promise<void> = (
    await import(
      new URL("../../../../plugins/provider-retry/server.ts", import.meta.url)
        .href
    )
  ).default;
  let spawned = 0;
  const workflows = createFakePluginHost({
    pluginId: "workflows",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            environmentId: "environment-test",
            providerId: "codex",
            originPluginId: threadId === "thread-test" ? null : "workflows",
            status: threadId === "thread-test" ? "idle" : "active",
          }),
        defaultExecutionOptions: async () => ({
          model: "test-model",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "default",
        }),
        spawn: async () => makeThreadResponse({ id: `worker-${++spawned}` }),
        send: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
      },
      providers: {
        list: async () => [
          {
            id: "codex",
            displayName: "Codex",
            logoUrl: null,
            available: true,
            capabilities: {
              supportsThreadArchive: true,
              supportsThreadRename: true,
              supportsServiceTier: true,
              supportsNativeUserQuestion: false,
              supportsFork: true,
              permissionModes: ["full"],
            },
            composerActions: [],
          },
        ],
        models: async () => ({
          providers: [],
          selectedOnlyModels: [],
          modelLoadError: null,
          models: [
            {
              id: "test-model",
              model: "test-model",
              displayName: "Test",
              description: "",
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "" },
              ],
              defaultReasoningEffort: "medium",
              isDefault: true,
            },
          ],
        }),
      },
    },
  });
  const retry = createFakePluginHost({
    pluginId: "provider-retry",
    sdk: {
      plugins: {
        experimental_discoverRpc: async (query) =>
          query?.pluginId === "workflows"
            ? workflows.harness.registrations.rpcMethods
                .filter((method) => method === query.method)
                .map((method) => ({
                  pluginId: "workflows",
                  displayName: "Workflows",
                  method,
                }))
            : [],
        callRpc: async ({ method, input }) =>
          workflows.harness.callRpc(method, input),
      },
      threads: {
        retry: async () => ({
          ok: true,
          delivery: "sent",
          turnRequestId: "creq_retry",
          attempt: 2,
        }),
      },
    },
  });
  try {
    await workflowsPlugin(workflows.bb);
    await retryPlugin(retry.bb);
    const worker = workflows.harness.runService("workflow-worker");
    try {
      const started = await workflows.harness.callAgentTool("bb_workflow_run", {
        source:
          'export const meta = { name: "retry", description: "retry regression" }; return await agent("work");',
      });
      expect(typeof started).toBe("string");
      await expect.poll(() => spawned).toBe(1);
      await workflows.harness.emitThreadEvent("thread.failed", {
        thread: makeThreadResponse({
          id: "worker-1",
          status: "error",
          originPluginId: "workflows",
        }),
        error: "Provider command failed: Provider overload",
      });
      await expect.poll(() => spawned, { timeout: 5_000 }).toBe(2);
      const result = await retry.harness.emitThreadEvent(
        "turn.failed",
        makeTurnFailedEvent({
          threadId: "worker-1",
          originPluginId: "workflows",
          errorInfo: {
            category: "overloaded",
            providerCode: "serverOverloaded",
            httpStatusCode: 529,
          },
          rateLimits: null,
        }),
      );
      expect(result.errors).toEqual([]);
      expect(retry.harness.sdk.callsTo("threads.retry")).toEqual([]);
      await expect(
        workflows.harness.callRpc("provider-retry.v1.consent", {
          threadId: "thread-test",
          requestId: "notification",
          reason: "Provider overloaded",
          sendAt: Date.now(),
        }),
      ).resolves.toEqual({ kind: "allow" });
    } finally {
      worker.controller.abort();
      await worker.done;
    }
  } finally {
    await Promise.all([workflows.harness.dispose(), retry.harness.dispose()]);
  }
});
