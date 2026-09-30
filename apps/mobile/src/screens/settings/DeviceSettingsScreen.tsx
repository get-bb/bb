import { nativeApplicationVersion, nativeBuildVersion } from "expo-application";
import { useProfiles } from "@/app-shell";
import { sendShellCommand } from "@/lib/shell";
import {
  ActionSheet,
  GroupedRow,
  Text,
  confirmDestructive,
  toast,
  useSheet,
} from "@/ui";
import { GroupedScreen } from "./GroupedScreen";
import { HapticsSettingsRow } from "./HapticsSettingsRow";
import { LinkRow } from "./LinkRow";
import { settingsSectionHref } from "@/screens/shell/hrefs";
import { SettingsSection } from "./SettingsRows";
import { useBadgeColors } from "./settings-badges";

export function DeviceSettingsScreen() {
  const colors = useBadgeColors();
  const clearDataSheet = useSheet();
  const clearWebsiteData = () => {
    const delivered = sendShellCommand({ kind: "clear-website-data" });
    toast[delivered ? "success" : "info"](
      delivered ? "Cleared" : "Open the web interface first",
    );
  };
  const clearDataMessage =
    "The cached page and this device's session cookie are removed, then the page reloads. Your servers and pairing stay.";
  const { profiles } = useProfiles();
  const version = nativeApplicationVersion ?? "0.0.0";
  const build = nativeBuildVersion ?? "dev";

  return (
    <>
      <GroupedScreen testID="device-settings-screen">
        <SettingsSection
          title="This device"
          footnote="Preferences for this phone."
        >
          <HapticsSettingsRow />
          <LinkRow
            title="Appearance"
            badge={{
              icon: "Palette",
              symbol: "paintpalette",
              color: colors.gray,
            }}
            href={settingsSectionHref("appearance")}
            testID="device-appearance"
          />
          <LinkRow
            title="Servers"
            subtitle={
              profiles.length === 1 ? "1 server" : `${profiles.length} servers`
            }
            badge={{ icon: "Cloud", symbol: "server.rack", color: colors.blue }}
            href="/settings/servers"
            testID="device-servers"
          />
          <LinkRow
            title="Notifications"
            badge={{ icon: "Bell", symbol: "bell.badge", color: colors.red }}
            href={settingsSectionHref("notifications")}
            testID="device-notifications"
          />
        </SettingsSection>

        <SettingsSection
          title="Page"
          footnote="Reload or clear cached data if the app gets stuck. Your saved servers stay paired."
        >
          <GroupedRow
            title="Reload the page"
            badge={{
              icon: "RotateCcw",
              symbol: "arrow.clockwise",
              color: colors.gray,
            }}
            onPress={() => {
              const delivered = sendShellCommand({ kind: "reload" });
              toast[delivered ? "success" : "info"](
                delivered ? "Reloading" : "Open the web interface first",
              );
            }}
            testID="device-reload-page"
          />
          <GroupedRow
            title="Clear website data"
            destructive
            badge={{ icon: "Trash2", symbol: "trash", color: colors.red }}
            onPress={() => {
              if (process.env.EXPO_OS === "ios") {
                confirmDestructive({
                  title: "Clear website data?",
                  message: clearDataMessage,
                  actionLabel: "Clear",
                  onConfirm: clearWebsiteData,
                });
              } else {
                clearDataSheet.present();
              }
            }}
            testID="device-clear-website-data"
          />
        </SettingsSection>

        <SettingsSection title="About">
          <GroupedRow
            title="Version"
            trailing={
              <Text className="text-sm text-muted-foreground">
                {version} ({build})
              </Text>
            }
            testID="device-version"
          />
        </SettingsSection>
      </GroupedScreen>
      {process.env.EXPO_OS !== "ios" ? (
        <ActionSheet
          controller={clearDataSheet}
          presentation="prompt"
          title="Clear website data?"
          message={clearDataMessage}
          actions={[
            {
              key: "clear",
              label: "Clear website data",
              icon: "Trash2",
              destructive: true,
              onPress: clearWebsiteData,
            },
          ]}
        />
      ) : null}
    </>
  );
}
