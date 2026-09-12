import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function draftsPlugin(bb: BbPluginApi): void {
  bb.experimental_hooks.on("message.dispatch", (context) => {
    const isDraft =
      context.experimental_submission?.pluginId === bb.pluginId &&
      context.experimental_submission.data !== null &&
      typeof context.experimental_submission.data === "object" &&
      !Array.isArray(context.experimental_submission.data) &&
      context.experimental_submission.data.kind === "draft";
    return isDraft
      ? { action: "wait", reason: "Draft" }
      : { action: "proceed" };
  });
}
