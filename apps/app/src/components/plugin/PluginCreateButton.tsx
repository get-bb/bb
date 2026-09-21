import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { useNavigate } from "react-router-dom";
import { getRootComposeRoutePath } from "@/lib/route-paths";

export function useCreatePlugin() {
  const navigate = useNavigate();
  return (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };
}

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
