import { composerRendererProviderAtom } from "@/components/promptbox/composer-provider";
import { diffRendererProviderAtom } from "@/components/code/codeRendererProvider";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function CodeRendererSettings() {
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const composers = usePluginSlotKind("composers");
  return (
    <>
      <ReplacementProviderSetting
        label="Diffs"
        triggerAriaLabel="Diffs"
        description="Applies to file diffs in threads, the diff panel, and plugin views."
        builtInDescription="Unified and split diffs from the bb code theme."
        preferenceAtom={diffRendererProviderAtom}
        slots={diffRenderers}
      />
      <ReplacementProviderSetting
        label="Composer"
        triggerAriaLabel="Composer"
        description="The prompt box in threads, the New thread screen, and message editors."
        preferenceAtom={composerRendererProviderAtom}
        slots={composers}
      />
    </>
  );
}
