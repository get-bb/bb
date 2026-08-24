import type { PromptMentionResource } from "@bb/domain";
import type { PluginComposerMention } from "@get-bb/plugin-sdk/app";

/**
 * Namespaces a plugin-authored mention into bb's durable prompt resource.
 * Shared by insert and clipboard-copy so both paths resolve identically.
 */
export function pluginComposerMentionResource(
  pluginId: string,
  mention: PluginComposerMention,
): Extract<PromptMentionResource, { kind: "plugin" }> | null {
  const provider = mention.provider.trim();
  if (provider.length === 0 || provider.includes(":")) return null;
  return {
    kind: "plugin",
    pluginId,
    icon: null,
    itemId: `${provider}:${mention.id}`,
    label: mention.label.trim() || mention.id,
  };
}
