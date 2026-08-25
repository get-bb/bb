import { View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Text, type IconName } from "@/ui";
import { describePanelTab } from "./panel-model";
import type {
  PanelLauncherContentProps,
  PanelTabContentProps,
} from "./registry";

/** iOS empty state: a large light symbol, a headline, a footnote. */
function PlaceholderCard({
  icon,
  title,
  message,
  testID,
}: {
  icon: IconName;
  title: string;
  message: string;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      className="flex-1 items-center justify-center px-8 pb-12"
      testID={testID}
    >
      <View className="max-w-[320px] items-center gap-2">
        <Icon
          name={icon}
          size={40}
          weight="light"
          color={tokens.subtleForeground}
        />
        <Text variant="headline" className="text-center" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" tone="muted" className="text-center">
          {message}
        </Text>
      </View>
    </View>
  );
}

/**
 * Tab kinds mobile does not render (browser tabs need the desktop app's
 * native web view, plugin panels the web plugin runtime). The tab still
 * shows in the strip — it is part of the thread's synced strip — and can be
 * closed from here like any other.
 */
export function UnsupportedTabContent({ tab }: PanelTabContentProps) {
  const descriptor = describePanelTab(tab);
  return (
    <PlaceholderCard
      icon={descriptor.icon}
      title={descriptor.label}
      message="Available on desktop/web"
      testID="panel-content-unsupported"
    />
  );
}

/** A supported kind whose content has not been registered in this build. */
export function UnregisteredTabContent({ tab }: PanelTabContentProps) {
  const descriptor = describePanelTab(tab);
  return (
    <PlaceholderCard
      icon={descriptor.icon}
      title={descriptor.label}
      message="This view is not available in this build yet."
      testID={`panel-content-placeholder-${tab.kind}`}
    />
  );
}

export function UnregisteredLauncherContent({
  launcher,
}: PanelLauncherContentProps) {
  return (
    <PlaceholderCard
      icon={launcher === "files" ? "FolderOpen" : "Terminal"}
      title={launcher === "files" ? "Files" : "Terminal"}
      message="This view is not available in this build yet."
      testID={`panel-content-placeholder-${launcher}`}
    />
  );
}
