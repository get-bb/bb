export type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";

export const DEFAULT_PLUGIN_MENTION_TRIGGER: PluginMentionTrigger = "@";
export const PLUGIN_MENTION_TRIGGER_VALUES = [
  "@",
  "#",
  "$",
  "!",
  "~",
] as const satisfies readonly PluginMentionTrigger[];

export function isPluginMentionTrigger<T>(
  value: T,
): value is PluginMentionTrigger & T {
  switch (value) {
    case "@":
    case "#":
    case "$":
    case "!":
    case "~":
      return true;
    default:
      return false;
  }
}

export function normalizePluginMentionTriggers<T>(
  value: T,
): readonly PluginMentionTrigger[] | null {
  if (value === undefined) {
    return [DEFAULT_PLUGIN_MENTION_TRIGGER];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const triggers: PluginMentionTrigger[] = [];
  for (const trigger of value) {
    if (!isPluginMentionTrigger(trigger) || triggers.includes(trigger)) {
      return null;
    }
    triggers.push(trigger);
  }
  return triggers;
}
