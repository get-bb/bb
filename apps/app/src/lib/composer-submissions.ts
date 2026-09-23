import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import type { PromptDraftState } from "@bb/client-core";
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

export function removePluginMention(
  draft: PromptDraftState,
  pluginId: string,
  provider: string,
  id: string,
): PromptDraftState {
  let next = draft;
  const matches = draft.mentions
    .filter(
      ({ resource }) =>
        resource.kind === "plugin" &&
        resource.pluginId === pluginId &&
        resource.itemId === `${provider}:${id}`,
    )
    .sort((a, b) => b.start - a.start);
  for (const match of matches) {
    const length = match.end - match.start;
    next = {
      ...next,
      text: next.text.slice(0, match.start) + next.text.slice(match.end),
      mentions: next.mentions
        .filter((mention) => mention !== match)
        .map((mention) =>
          mention.start >= match.end
            ? {
                ...mention,
                start: mention.start - length,
                end: mention.end - length,
              }
            : mention,
        ),
    };
  }
  return next;
}
