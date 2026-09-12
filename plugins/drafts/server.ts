import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function draftsPlugin(bb: BbPluginApi): void {
  bb.experimental_hooks.on("message.dispatch", (context) => {
    const isDraft =
      context.originPluginId === bb.pluginId ||
      (context.queuedMessage?.waitingOn?.kind === "plugin" &&
        context.queuedMessage.waitingOn.pluginId === bb.pluginId);
    return isDraft
      ? { action: "wait", reason: "Draft" }
      : { action: "proceed" };
  });
}
