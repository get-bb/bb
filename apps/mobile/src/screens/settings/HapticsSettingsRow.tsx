import { useHapticsEnabled } from "@/lib/haptics";
import { SettingsSwitchRow } from "./SettingsRows";

/**
 * The client-local Haptics toggle (MMKV `bb.haptics.enabled`, honored by
 * `@/lib/haptics`): selection ticks in pickers, impacts on send / long-press
 * menus, success / warning notifications on approve / save / destructive
 * confirmations.
 */
export function HapticsSettingsRow() {
  const [enabled, setEnabled] = useHapticsEnabled();
  return (
    <SettingsSwitchRow
      label="Haptics"
      description="Vibration feedback on pickers, send, approvals, and destructive actions"
      icon="Smartphone"
      checked={enabled}
      onCheckedChange={setEnabled}
      testID="settings-haptics"
    />
  );
}
