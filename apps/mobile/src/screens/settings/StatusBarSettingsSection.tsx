import { useWindowLayout } from "@/app-shell";
import {
  showsStatusBarSetting,
  useStatusBarPlacement,
} from "@/lib/window-layout";
import { useBadgeColors } from "./settings-badges";
import { SettingsSection, SettingsSwitchRow } from "./SettingsRows";

export function StatusBarSettingsSection() {
  const [placement, setPlacement] = useStatusBarPlacement();
  const layout = useWindowLayout();
  const colors = useBadgeColors();
  if (
    !showsStatusBarSetting({
      platform: process.env.EXPO_OS ?? "unknown",
      placement,
      layout,
    })
  ) {
    return null;
  }
  return (
    <SettingsSection
      title="Cover screen"
      footnote="On a folded iPhone Duo, moves the iOS status bar out of the side rail to the top of the screen, so the app can use the full width."
      testID="device-status-bar-section"
    >
      <SettingsSwitchRow
        label="Status bar at top"
        badge={{
          icon: "Smartphone",
          symbol: "menubar.rectangle",
          color: colors.gray,
        }}
        checked={placement === "top"}
        onCheckedChange={(checked) => setPlacement(checked ? "top" : "system")}
        testID="settings-status-bar-top"
      />
    </SettingsSection>
  );
}
