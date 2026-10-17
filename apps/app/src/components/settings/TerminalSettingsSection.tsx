import { defaultAppSettings } from "@bb/domain";
import { Switch } from "@bb/shared-ui/switch";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";

export function TerminalSettingsSection() {
  const config = useSystemConfig();
  const updateGeneralSettings = useUpdateGeneralSettings();
  const generalSettings = config.data?.generalSettings ?? defaultAppSettings;

  return (
    <SettingsSection
      description="Control how typing appears in persistent terminals."
      title="Terminal"
    >
      <SettingsWithControl
        description="At high latency, the first single printable key waits for real echo; later keys appear dim and underlined. Control keys, escape-heavy output, and the alternate screen pause prediction until echo resumes. Turn this off before entering secrets if a program can disable echo without output."
        label="Predictive local echo"
      >
        <Switch
          aria-label="Predictive local echo"
          checked={generalSettings.terminalPredictiveEcho}
          disabled={config.data === undefined}
          onCheckedChange={(terminalPredictiveEcho) =>
            updateGeneralSettings.mutate({ terminalPredictiveEcho })
          }
        />
      </SettingsWithControl>
    </SettingsSection>
  );
}
