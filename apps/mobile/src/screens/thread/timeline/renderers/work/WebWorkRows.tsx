import { useCallback } from "react";
import { Linking } from "react-native";
import { useTheme } from "@/theme";
import { Icon, toast } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:web-fetch`: title-only (verb + URL); tapping the row opens the
 * fetched URL in the system browser.
 */
export function WebFetchWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:web-fetch">) {
  const { tokens } = useTheme();
  const url = item.row.url;
  const openUrl = useCallback(() => {
    Linking.openURL(url).catch(() => {
      toast.error("Could not open link", { description: url });
    });
  }, [url]);
  return (
    <WorkRowShell
      item={item}
      expandable={false}
      expanded={expanded}
      onToggle={onToggle}
      onPress={openUrl}
      accessibilityLabel={`Open ${url}`}
      trailing={
        <Icon name="ArrowUpRight" size={14} color={tokens.mutedForeground} />
      }
    />
  );
}
