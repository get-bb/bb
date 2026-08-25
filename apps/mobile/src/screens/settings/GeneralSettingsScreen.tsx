import { defaultAppSettings } from "@bb/domain";
import { useProfiles } from "@/app-shell";
import { useComposePreferences } from "@/data/compose";
import { useLocalPreferences, useUpdateGeneralSettings } from "@/data/settings";
import { useSystemConfig } from "@/data/system";
import { EmptyStatePanel } from "@/ui";
import { GroupedScreen } from "./GroupedScreen";
import { SettingsSection, SettingsSwitchRow } from "./SettingsRows";

/**
 * `/settings/general`: the server-persisted General toggles
 * (`PUT /settings/general`; `showKeyboardHints` has no meaning on a phone
 * and is left out) plus the two device-local ones the web keeps in
 * localStorage (navigate after create, rewrite localhost links). Each
 * toggle's explanation is its group's footer, like iOS Settings.
 */
export function GeneralSettingsScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="general-settings-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
    );
  }
  return <ConnectedGeneralSettingsScreen />;
}

function ConnectedGeneralSettingsScreen() {
  const configQuery = useSystemConfig();
  const updateGeneral = useUpdateGeneralSettings();
  const [composePrefs, composeStore] = useComposePreferences();
  const [localPrefs, localStore] = useLocalPreferences();
  const settings = configQuery.data?.generalSettings ?? defaultAppSettings;
  const serverDisabled = configQuery.data === undefined;

  return (
    <GroupedScreen testID="general-settings-screen">
      <SettingsSection
        title="Threads"
        footnote="While a thread is running, a tap on Send queues a follow-up and a long-press steers the current run. Turn on “Steer running threads on send” to swap them: tap steers, long-press queues. Shared with the web's “Steer running threads on Enter”."
      >
        <SettingsSwitchRow
          label="Open threads after creating"
          checked={composePrefs.navigateAfterCreate}
          onCheckedChange={(value) =>
            composeStore.setNavigateAfterCreate(value)
          }
          testID="general-navigate-after-create"
        />
        <SettingsSwitchRow
          label="Steer running threads on send"
          checked={settings.steerActiveThreadOnEnter}
          disabled={serverDisabled}
          onCheckedChange={(value) =>
            updateGeneral.mutate({
              ...settings,
              steerActiveThreadOnEnter: value,
            })
          }
          testID="general-steer-on-enter"
        />
      </SettingsSection>

      <SettingsSection
        title="Links"
        footnote="Point localhost links an agent emits at the server's host so they open from this phone. Stored on this device."
      >
        <SettingsSwitchRow
          label="Rewrite localhost links"
          checked={localPrefs.rewriteLocalhostLinks}
          onCheckedChange={(value) =>
            localStore.setRewriteLocalhostLinks(value)
          }
          testID="general-rewrite-localhost-links"
        />
      </SettingsSection>

      <SettingsSection
        title="Privacy"
        footnote="Hide the custom models from config.json in every model picker, so a screen share does not show them."
      >
        <SettingsSwitchRow
          label="Streamer mode"
          checked={settings.streamerMode}
          disabled={serverDisabled}
          onCheckedChange={(value) =>
            updateGeneral.mutate({
              ...settings,
              streamerMode: value,
            })
          }
          testID="general-streamer-mode"
        />
      </SettingsSection>

      <SettingsSection
        title="Debug"
        footnote="Show raw provider events bb does not recognize. Development builds always show these events."
      >
        <SettingsSwitchRow
          label="Show unhandled provider events"
          checked={settings.showUnhandledProviderEvents}
          disabled={serverDisabled}
          onCheckedChange={(value) =>
            updateGeneral.mutate({
              ...settings,
              showUnhandledProviderEvents: value,
            })
          }
          testID="general-unhandled-provider-events"
        />
      </SettingsSection>
    </GroupedScreen>
  );
}
