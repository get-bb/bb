import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerRefusalFallbackCli } from "./src/cli.js";
import { RefusalFallbackService } from "./src/service.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function plugin(bb: BbPluginApi) {
  const service = new RefusalFallbackService(bb);
  registerRefusalFallbackCli(bb, service);

  const reconcile = async (threadId: string): Promise<void> => {
    try {
      await service.reconcile(threadId);
    } catch (error) {
      bb.log.warn(
        `Refusal fallback for thread ${threadId} failed: ${errorMessage(error)}`,
      );
    }
  };

  bb.events.on("thread.failed", async ({ thread }) => {
    await reconcile(thread.id);
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    await reconcile(thread.id);
  });
}
