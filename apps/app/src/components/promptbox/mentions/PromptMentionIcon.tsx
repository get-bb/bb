import type { PromptMentionResource } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { promptMentionIconName } from "./prompt-mention-display";

export function PromptMentionIcon({
  className,
  resource,
}: {
  className?: string;
  resource: PromptMentionResource;
}) {
  if (resource.kind === "plugin") {
    return (
      <PluginIcon
        pluginId={resource.pluginId}
        icon={resource.icon ?? null}
        className={className}
      />
    );
  }
  if (resource.kind === "section") {
    return (
      <span
        aria-hidden
        data-section-mention-marker
        className={cn(
          "inline-flex items-center justify-center text-xs font-medium leading-none",
          className,
        )}
      >
        #
      </span>
    );
  }
  const iconName = promptMentionIconName(resource);
  if (iconName === null) {
    return null;
  }
  return (
    <Icon name={iconName} className={className} aria-hidden />
  );
}
