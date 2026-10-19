import {
  splitPluginDisplayName,
  type PluginNameTag as PluginNameTagValue,
} from "@bb/domain/plugin-display-name";
import { cn } from "@bb/shared-ui/lib/utils";

const TONE_CLASS: Record<PluginNameTagValue["tone"], string> = {
  attention: "border-attention/50 bg-surface-attention text-foreground",
  neutral: "border-border bg-surface-recessed text-muted-foreground",
};

export function PluginNameTag({ tag }: { tag: PluginNameTagValue }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 align-middle text-2xs font-medium leading-none",
        TONE_CLASS[tag.tone],
      )}
    >
      {tag.label}
    </span>
  );
}

export function PluginDisplayName({
  displayName,
  nameClassName,
}: {
  displayName: string;
  nameClassName?: string;
}) {
  const { name, tag } = splitPluginDisplayName(displayName);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={nameClassName}>{name}</span>
      {tag ? <PluginNameTag tag={tag} /> : null}
    </span>
  );
}
