import { defaultAppSettings } from "@bb/domain";
import { Stack, useLocalSearchParams } from "expo-router";
import { useProfiles } from "@/app-shell";
import { useUpdateGeneralSettings } from "@/data/settings";
import { useSystemConfig } from "@/data/system";
import { EmptyStatePanel } from "@/ui";
import { Screen } from "../shell/Screen";
import { firstParam, type SettingsProviderRoute } from "../shell/hrefs";
import { SettingsSection, SettingsSwitchRow } from "./SettingsRows";

function parseProvider(value: string): SettingsProviderRoute | null {
  return value === "codex" || value === "claude-code" ? value : null;
}

const PROVIDER_TITLES: Record<SettingsProviderRoute, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

/**
 * `/settings/providers/[providerId]`: the provider's memory / subagent /
 * workflow toggles, which live in the server's general settings
 * (`PUT /settings/general`; the web ProviderSettingsSection).
 */
export function ProviderSettingsScreen() {
  const params = useLocalSearchParams<{ providerId?: string | string[] }>();
  const providerId = parseProvider(firstParam(params.providerId));
  const { connection } = useProfiles();
  if (providerId === null) {
    return (
      <Screen testID="provider-settings-screen">
        <EmptyStatePanel>This provider has no settings page.</EmptyStatePanel>
      </Screen>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: PROVIDER_TITLES[providerId] }} />
      {connection ? (
        <ConnectedProviderSettingsScreen providerId={providerId} />
      ) : (
        <Screen testID="provider-settings-screen">
          <EmptyStatePanel>Add a server first.</EmptyStatePanel>
        </Screen>
      )}
    </>
  );
}

function ConnectedProviderSettingsScreen({
  providerId,
}: {
  providerId: SettingsProviderRoute;
}) {
  const configQuery = useSystemConfig();
  const updateGeneral = useUpdateGeneralSettings();
  const settings = configQuery.data?.generalSettings ?? defaultAppSettings;
  const disabled = configQuery.data === undefined;
  const isCodex = providerId === "codex";
  const title = PROVIDER_TITLES[providerId];
  return (
    <Screen testID="provider-settings-screen">
      <SettingsSection title={title}>
        <SettingsSwitchRow
          label={`${title} memory`}
          description={
            isCodex
              ? "Allow Codex to recall existing memories and generate new memories from bb threads."
              : "Allow Claude Code to read and write its native auto-memory for bb threads."
          }
          checked={
            isCodex
              ? settings.codexMemoryEnabled
              : settings.claudeCodeMemoryEnabled
          }
          disabled={disabled}
          onCheckedChange={(enabled) =>
            updateGeneral.mutate({
              ...settings,
              ...(isCodex
                ? { codexMemoryEnabled: enabled }
                : { claudeCodeMemoryEnabled: enabled }),
            })
          }
          testID={`provider-${providerId}-memory`}
        />
        <SettingsSwitchRow
          label="Disable provider subagents"
          description={
            isCodex
              ? "Prevent Codex from starting native subagents so agents use bb for delegation."
              : "Hide Claude Code's native Task tool so agents use bb for delegation."
          }
          checked={
            isCodex
              ? settings.codexSubagentsDisabled
              : settings.claudeCodeSubagentsDisabled
          }
          disabled={disabled}
          onCheckedChange={(value) =>
            updateGeneral.mutate({
              ...settings,
              ...(isCodex
                ? { codexSubagentsDisabled: value }
                : { claudeCodeSubagentsDisabled: value }),
            })
          }
          testID={`provider-${providerId}-subagents-disabled`}
        />
        {isCodex ? null : (
          <SettingsSwitchRow
            label="Disable Workflow tool"
            description="Hide Claude Code's native Workflow tool for bb threads."
            checked={settings.claudeCodeWorkflowsDisabled}
            disabled={disabled}
            onCheckedChange={(value) =>
              updateGeneral.mutate({
                ...settings,
                claudeCodeWorkflowsDisabled: value,
              })
            }
            testID="provider-claude-code-workflows-disabled"
          />
        )}
      </SettingsSection>
    </Screen>
  );
}
