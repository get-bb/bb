import { Switch } from "@bb/shared-ui/switch";
import { useAtom } from "jotai";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";

export const SPLIT_DIMMING_SETTING_LABEL = "Fade inactive splits";

export function SplitDimmingSetting() {
  const [dimsInactiveSplits, setDimsInactiveSplits] = useAtom(
    dimInactiveSplitsAtom,
  );

  return (
    <SettingsWithControl
      label={SPLIT_DIMMING_SETTING_LABEL}
      description="Fade out splits that do not have focus."
    >
      <Switch
        checked={dimsInactiveSplits}
        onCheckedChange={setDimsInactiveSplits}
        aria-label={SPLIT_DIMMING_SETTING_LABEL}
      />
    </SettingsWithControl>
  );
}
