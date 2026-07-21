import type { ComposerView } from "@bb/plugin-sdk";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  PluginComposerViewProvider,
} from "./plugin-composer-host";

/** Plugin banner rows rendered at the bottom of a composer's measured stack. */
export function PluginComposerBanners({ view }: { view: ComposerView }) {
  const { composerCustomizations } = usePluginSlots();
  const scopeKey = composerScopeIdentity(view.scope);

  return (
    <>
      {composerCustomizations.map((customization) => {
        if (
          customization.scopes !== undefined &&
          !customization.scopes.includes(view.scope.kind)
        ) {
          return null;
        }
        return customization.banners?.map((banner) => {
          const slotId = `${customization.id}/${banner.id}`;
          return (
            <PluginSlotMount
              key={`${customization.pluginId}/${slotId}/${customization.generation}/${scopeKey}`}
              pluginId={customization.pluginId}
              slotKind="composerBanner"
              slotId={slotId}
              crashFallback={<></>}
            >
              <PluginComposerViewProvider value={view}>
                {banner.chrome === "bare" ? (
                  <banner.component />
                ) : (
                  <PromptStackCard
                    ariaLabel={customization.pluginId}
                    className="empty:hidden"
                  >
                    <banner.component />
                  </PromptStackCard>
                )}
              </PluginComposerViewProvider>
            </PluginSlotMount>
          );
        });
      })}
    </>
  );
}
