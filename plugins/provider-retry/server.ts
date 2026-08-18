import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { providerRetryRpcContract } from "./src/contract.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  ProviderRetryService,
} from "./src/service.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string | boolean | undefined): number | null {
  switch (value) {
    case "6 hours":
      return DEFAULT_MAXIMUM_WAIT_MS;
    case "24 hours":
      return 24 * 60 * 60 * 1_000;
    case "No limit":
      return null;
    default:
      throw new Error(
        `Unsupported maximum provider retry wait: ${String(value)}`,
      );
  }
}

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
  const settings = bb.settings.define({
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a retry when the reported reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  const service = new ProviderRetryService(
    bb,
    undefined,
    maximumWaitMs(initialSettings.maximumWait),
  );
  settings.onChange((next) => {
    service.setMaximumWaitMs(maximumWaitMs(next.maximumWait));
  });
  bb.onDispose(() => service.dispose());

  bb.rpc.register(providerRetryRpcContract, {
    async providerRetryCancel({ threadId }) {
      return { cancelled: await service.cancel(threadId) };
    },
    providerRetryStatus({ threadId }) {
      return { view: service.status(threadId) };
    },
  });
  registerProviderRetryCli(bb, service);

  async function reconcile(
    threadId: string,
    trackedOnly = false,
  ): Promise<void> {
    try {
      await (trackedOnly
        ? service.reconcileTracked(threadId)
        : service.reconcile(threadId));
    } catch (error) {
      logFailure(bb, `Could not inspect provider retry for ${threadId}`, error);
    }
  }

  bb.events.on("thread.failed", async ({ thread }) => {
    await reconcile(thread.id);
  });
  bb.events.on("thread.active", async ({ thread }) => {
    await reconcile(thread.id, true);
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    await reconcile(thread.id, true);
  });
  bb.events.on("thread.archived", ({ thread }) => service.supersede(thread.id));
  bb.events.on("thread.deleted", ({ thread }) =>
    service.deleteThread(thread.id),
  );

  bb.background.service("provider-retry-scheduler", {
    async start(signal) {
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
      try {
        await waitForAbort(signal);
      } finally {
        unsubscribeHost();
      }
    },
  });
}
