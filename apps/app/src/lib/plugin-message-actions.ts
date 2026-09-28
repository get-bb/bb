import type {
  PluginComposerApi,
  PluginMessageActionContext,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import {
  createComposerHandleBinding,
  detachedComposerController,
} from "./plugin-composer-handle";
import type { MarkdownMessageDirectiveOpenThreadPanel } from "@/components/ui/markdown-message-directives";
import type { PluginMessageActionSlot } from "./plugin-slots";

interface RunPluginMessageActionArgs {
  slot: PluginMessageActionSlot;
  threadId: string;
  message: ThreadChatMessageReference;
  selectedText?: string;
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | undefined;
  composerHost: PluginComposerHost | null;
}

function messageActionComposer(
  pluginId: string,
  threadId: string,
  host: PluginComposerHost | null,
): PluginComposerApi | null {
  if (host === null) return null;
  if (host.scope.kind !== "thread" || host.scope.threadId !== threadId) {
    return null;
  }
  return createComposerHandleBinding(
    host.textEffectKey,
    detachedComposerController(pluginId, host, "a message action's"),
  ).handle;
}

export function runPluginMessageAction({
  slot,
  threadId,
  message,
  selectedText,
  openThreadPanel,
  composerHost,
}: RunPluginMessageActionArgs): void {
  const context: PluginMessageActionContext = {
    threadId,
    message,
    ...(selectedText !== undefined ? { selectedText } : {}),
    openPanel: (options) => {
      if (openThreadPanel === undefined) {
        console.warn(
          `[plugin:${slot.pluginId}] messageAction "${slot.id}" openPanel declined: this surface has no thread side panel`,
        );
        return false;
      }
      return openThreadPanel({ ...options, pluginId: slot.pluginId });
    },
    composer: messageActionComposer(slot.pluginId, threadId, composerHost),
  };
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${slot.pluginId}] messageAction "${slot.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = slot.run(context);
    if (result instanceof Promise) {
      result.catch(warn);
    }
  } catch (error) {
    warn(error);
  }
}
