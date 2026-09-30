import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function draftsPlugin(bb: BbPluginApi): void {
  bb.experimental_hooks.on("message.dispatch", (context) => {
    const isCustomDraft =
      context.experimental_customOptions?.kind === "draft" &&
      context.queuedMessages.length === 0 &&
      context.experimental_isRetry !== true;
    const isNewDraft =
      context.experimental_submission?.pluginId === bb.pluginId &&
      context.experimental_submission.data !== null &&
      typeof context.experimental_submission.data === "object" &&
      !Array.isArray(context.experimental_submission.data) &&
      context.experimental_submission.data.kind === "draft";
    const firstQueuedMessage = context.queuedMessages[0];
    const isQueuedDraft =
      firstQueuedMessage?.waitingOn?.kind === "plugin" &&
      firstQueuedMessage.waitingOn.pluginId === bb.pluginId;
    return isCustomDraft || isNewDraft || isQueuedDraft
      ? { action: "wait", reason: "Draft" }
      : { action: "proceed" };
  });
}
