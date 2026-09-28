import type {
  PluginComposerApi,
  PluginMessageActionContext,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { subscribeComposerSubmitted } from "./composer-submissions";
import { createComposerHandleBinding } from "./plugin-composer-handle";
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
  const scope = host.scope;
  const warnNoLifecycle = (method: string) => {
    console.warn(
      `[plugin:${pluginId}] a message action's composer.${method} has no effect; call it from a component.`,
    );
  };
  return createComposerHandleBinding(host.textEffectKey, {
    pluginId,
    target: {
      key: host.textEffectKey,
      scope,
      getCurrent: host.getCurrent,
      setDraft: host.setDraft,
      isAvailable: host.isAvailable ?? (() => true),
      focus: host.focus,
      ...(host.submit !== undefined ? { submit: host.submit } : {}),
      ...(host.setSelection !== undefined
        ? { setSelection: host.setSelection }
        : {}),
    },
    setTextEffect: () => warnNoLifecycle("setTextEffect"),
    setInputLock: () => warnNoLifecycle("setInputLock"),
    onSubmitted: (listener) => subscribeComposerSubmitted(scope, listener),
  }).handle;
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
