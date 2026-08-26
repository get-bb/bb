import { useHapticsEnabled } from "@/lib/haptics";
import { useBadgeColors } from "./settings-badges";
import { SettingsSwitchRow } from "./SettingsRows";

/**
 * The client-local Haptics toggle (MMKV `bb.haptics.enabled`, honored by
 * `@/lib/haptics`): selection ticks in pickers, impacts on send / long-press
 * menus, success / warning notifications on approve / save / destructive
 * confirmations.
 */
export function HapticsSettingsRow() {
  const [enabled, setEnabled] = useHapticsEnabled();
  const colors = useBadgeColors();
  return (
    <SettingsSwitchRow
      label="Haptics"
      badge={{
        icon: "Smartphone",
        symbol: "iphone.radiowaves.left.and.right",
        color: colors.gray,
      }}
      checked={enabled}
      onCheckedChange={setEnabled}
      testID="settings-haptics"
    />
  );
}
