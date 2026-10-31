import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";

export function PluginCreateButton({
  onCreate,
  onInstallFromSource,
}: {
  onCreate: (prompt?: string) => void;
  onInstallFromSource: () => void;
}) {
  return (
    <CreateWithTemplatesButton
      kind="plugin"
      compactWhenNarrow
      label="New plugin"
      menuActions={[
        {
          label: "Install from source",
          icon: "Download",
          onSelect: onInstallFromSource,
        },
      ]}
      onCreate={(prompt) => {
        recordTelemetryEvent({
          name: "plugin_creation_started",
          properties: {},
        });
        onCreate(prompt);
      }}
    />
  );
}
