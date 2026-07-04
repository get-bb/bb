import type { PromptInput } from "@bb/domain";
import { ApiError } from "../../errors.js";
import { resolvePluginMention } from "./plugin-agent-contributions.js";

type PluginMentionResource = Extract<
  Extract<PromptInput, { type: "text" }>["mentions"][number]["resource"],
  { kind: "plugin" }
>;
type ResolvablePluginMentionResource = PluginMentionResource & {
  itemId: string;
};

/** Unique plugin provider-item mentions in `input`, in first-appearance order. */
function collectPluginMentionResources(
  input: readonly PromptInput[],
): ResolvablePluginMentionResource[] {
  const seen = new Set<string>();
  const resources: ResolvablePluginMentionResource[] = [];
  for (const item of input) {
    if (item.type !== "text") continue;
    for (const mention of item.mentions) {
      const resource = mention.resource;
      if (resource.kind !== "plugin") continue;
      // Plain installed-plugin mentions (`@codex`) identify a plugin bundle
      // but do not ask a mention provider to attach extra context.
      if (resource.itemId === undefined) continue;
      const key = `${resource.pluginId}::${resource.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push({ ...resource, itemId: resource.itemId });
    }
  }
  return resources;
}

/**
 * Resolve every plugin provider-item mention in a submitted message once
 * (design §4.9 resolve-at-send) and return the agent-visible context inputs
 * to append. Plain installed-plugin mentions such as `@codex` have no
 * `itemId`, so they remain user-visible prompt text only. Duplicate provider
 * mentions of the same (pluginId, itemId) resolve once. A resolve failure
 * throws a 422 ApiError so the composer surfaces it and the send is blocked —
 * silently dropping the context the user attached would be worse than failing
 * loudly.
 */
export async function resolvePluginMentionContextInputs(
  input: readonly PromptInput[],
): Promise<PromptInput[]> {
  const resources = collectPluginMentionResources(input);
  if (resources.length === 0) return [];
  const contextInputs: PromptInput[] = [];
  for (const resource of resources) {
    const result = await resolvePluginMention({
      pluginId: resource.pluginId,
      itemId: resource.itemId,
    });
    if (!result.ok) {
      throw new ApiError(
        422,
        "plugin_mention_resolve_failed",
        `Could not resolve @${resource.label} (plugin "${resource.pluginId}"): ${result.error}`,
      );
    }
    contextInputs.push({
      type: "text",
      text: `Context for @${resource.label} (resolved by plugin "${resource.pluginId}"):\n\n${result.context}`,
      mentions: [],
      visibility: "agent-only",
    });
  }
  return contextInputs;
}
