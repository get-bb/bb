import type { BbPluginApi } from "@bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { providerRetryRpcContract } from "./src/contract.js";
import { ProviderRetryService } from "./src/service.js";

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function logFailure(bb: BbPluginApi, operation: string, error: unknown): void {
  bb.log.warn(
    `${operation}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export default async function plugin(bb: BbPluginApi) {
  const service = new ProviderRetryService(bb);
  bb.onDispose(() => service.dispose());

  bb.rpc.register(providerRetryRpcContract, {
    async providerRetryStatus({ threadId }) {
      return { view: service.status(threadId) };
    },
    async providerRetryNow({ threadId }) {
      const started = await service.retryNow(threadId);
      return { started, view: service.status(threadId) };
    },
    providerRetryCancel({ threadId }) {
      return { cancelled: service.cancel(threadId) };
    },
    async providerRetryRefresh({ threadId }) {
      return { view: await service.refresh(threadId) };
    },
  });
  registerProviderRetryCli(bb, service);

  bb.events.on("thread.failed", async ({ thread }) => {
    try {
      await service.reconcile(thread.id);
    } catch (error) {
      logFailure(
        bb,
        `Could not inspect provider retry for ${thread.id}`,
        error,
      );
    }
  });
  bb.events.on("thread.active", ({ thread }) => service.supersede(thread.id));
  bb.events.on("thread.idle", ({ thread }) => service.supersede(thread.id));
  bb.events.on("thread.archived", ({ thread }) => service.supersede(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => service.supersede(thread.id));

  bb.background.service("provider-retry-scheduler", {
    async start(signal) {
      const unsubscribeThread = bb.sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (event.id === undefined || service.status(event.id) === null)
            return;
          void service
            .reconcile(event.id)
            .catch((error) =>
              logFailure(
                bb,
                `Could not refresh provider retry for ${event.id}`,
                error,
              ),
            );
        },
      });
      const unsubscribeHost = bb.sdk.subscribe({
        event: "host:changed",
        callback: (event) => {
          if (
            event.id !== undefined &&
            event.changes.includes("host-connected")
          ) {
            service.hostChanged(event.id);
          }
        },
      });
      const unsubscribeConnection = bb.sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          if (event.state !== "connected" || !event.reconnected) return;
          for (const view of service.list()) {
            void service
              .reconcile(view.threadId)
              .catch((error) =>
                logFailure(
                  bb,
                  `Could not reconcile provider retry for ${view.threadId}`,
                  error,
                ),
              );
          }
        },
      });
      try {
        await waitForAbort(signal);
      } finally {
        unsubscribeConnection();
        unsubscribeHost();
        unsubscribeThread();
      }
    },
  });
}
