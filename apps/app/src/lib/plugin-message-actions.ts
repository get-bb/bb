import type {
  PluginComposerApi,
  PluginMessageActionContext,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import { detachedComposerController } from "./plugin-composer-handle";
import type { PluginMessageActionSlot } from "./plugin-slots";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import {
  createPluginPanelController,
  createRetiredOpenPanel,
} from "./plugin-panel-controller";

interface RunPluginMessageActionArgs {
  slot: PluginMessageActionSlot;
  threadId: string;
  message: ThreadChatMessageReference;
  selectedText?: string;
  panel: AppPanelController;
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
  panel,
  composerHost,
}: RunPluginMessageActionArgs): void {
  const experimental_panel = createPluginPanelController(
    slot.pluginId,
    () => panel,
  );
  const context: PluginMessageActionContext & {
    openPanel: ReturnType<typeof createRetiredOpenPanel>;
  } = {
    threadId,
    message,
    ...(selectedText !== undefined ? { selectedText } : {}),
    experimental_panel,
    openPanel: createRetiredOpenPanel(experimental_panel),
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
