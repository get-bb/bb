import { defaultExperiments, type ExperimentKey } from "@bb/domain";
import { useProfiles } from "@/app-shell";
import { useUpdateExperiments } from "@/data/settings";
import { useSystemConfig } from "@/data/system";
import { EmptyStatePanel } from "@/ui";
import { Screen } from "../shell/Screen";
import { SettingsSection, SettingsSwitchRow } from "./SettingsRows";

interface ExperimentRow {
  key: ExperimentKey;
  label: string;
  description: string;
  badge?: string;
}

/** Same copy as the web Experiments section (SettingsView.tsx). */
const EXPERIMENT_ROWS: readonly ExperimentRow[] = [
  {
    key: "editMessages",
    label: "Edit messages",
    description:
      "Edit a sent message and replace the conversation from that point. Workspace changes are kept.",
  },
  {
    key: "mobileApp",
    label: "Mobile app",
    description:
      "Pair the bb mobile app over bb connect: shows Add mobile device under Remote access (web and desktop) and enables bb connect machine-code.",
  },
  {
    key: "providerSessionReaping",
    label: "Idle provider session release",
    description:
      "Release restorable provider sessions after 30 idle minutes. A change can take up to five minutes.",
  },
];

/** `/settings/experiments`: the server-persisted opt-in toggles (`PUT /settings/experiments`). */
export function ExperimentsSettingsScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="experiments-settings-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedExperimentsSettingsScreen />;
}

function ConnectedExperimentsSettingsScreen() {
  const configQuery = useSystemConfig();
  const updateExperiments = useUpdateExperiments();
  const experiments = configQuery.data?.experiments ?? defaultExperiments;
  const disabled = configQuery.data === undefined;
  return (
    <Screen testID="experiments-settings-screen">
      <SettingsSection
        title="Experiments"
        description="Early features that are off by default. Opt in to try them. Shared with every bb client on this server."
      >
        {EXPERIMENT_ROWS.map((row) => (
          <SettingsSwitchRow
            key={row.key}
            label={row.label}
            description={row.description}
            badge={row.badge}
            checked={experiments[row.key] ?? false}
            disabled={disabled}
            onCheckedChange={(value) =>
              updateExperiments.mutate({ ...experiments, [row.key]: value })
            }
            testID={`experiment-${row.key}`}
          />
        ))}
      </SettingsSection>
    </Screen>
  );
}
