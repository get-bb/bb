import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import { composerScopeIdentity } from "@/components/plugin/plugin-composer-host";
import { createKeyedListeners } from "./keyed-listeners";

const listeners = createKeyedListeners<string>();

export function subscribeComposerSubmitted(
  scope: PluginComposerScope,
  listener: () => void,
): () => void {
  return listeners.subscribe(composerScopeIdentity(scope), () => {
    try {
      listener();
    } catch (error) {
      console.error("Composer submission listener failed", error);
    }
  });
}

export function notifyComposerSubmitted(scope: PluginComposerScope): void {
  listeners.notify(composerScopeIdentity(scope));
}
