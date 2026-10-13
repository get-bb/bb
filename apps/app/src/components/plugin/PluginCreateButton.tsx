import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";

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
      onCreate={onCreate}
    />
  );
}
