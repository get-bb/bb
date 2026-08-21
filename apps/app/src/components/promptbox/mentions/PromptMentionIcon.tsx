import type { PromptMentionResource } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
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
  return (
    <Icon
      name={promptMentionIconName(resource)}
      className={className}
      aria-hidden
    />
  );
}
