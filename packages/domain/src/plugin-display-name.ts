const PLUGIN_NAME_TAG_MAX_LENGTH = 24;

export type PluginNameTagTone = "attention" | "neutral";

export interface PluginNameTag {
  label: string;
  tone: PluginNameTagTone;
}

const RESERVED_PLUGIN_NAME_TAGS: ReadonlyMap<string, PluginNameTag> = new Map<
  string,
  PluginNameTag
>([
  ["experimental", { label: "Experimental", tone: "attention" }],
]);

export function splitPluginDisplayName(displayName: string): {
  name: string;
  tag: PluginNameTag | null;
} {
  const plain = { name: displayName, tag: null };
  const trimmed = displayName.trimEnd();
  if (!trimmed.endsWith("]")) return plain;
  const open = trimmed.lastIndexOf("[");
  if (open <= 0) return plain;
  const label = trimmed.slice(open + 1, -1).trim();
  const key = label.toLowerCase();
  if (
    label.length === 0 ||
    label.length > PLUGIN_NAME_TAG_MAX_LENGTH ||
    label.includes("[") ||
    label.includes("]")
  ) {
    return plain;
  }
  const name = trimmed.slice(0, open).trimEnd();
  if (name.length === 0) return plain;
  const tag: PluginNameTag = RESERVED_PLUGIN_NAME_TAGS.get(key) ?? {
    label,
    tone: "neutral",
  };
  return { name, tag };
}
