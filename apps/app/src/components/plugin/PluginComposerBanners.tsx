import type { PluginComposerScope } from "@bb/plugin-sdk";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

function composerScopeKey(scope: PluginComposerScope): string {
  switch (scope.kind) {
    case "thread":
      return `thread/${scope.threadId}`;
    case "queued-message":
      return `queued-message/${scope.threadId}/${scope.queuedMessageId}`;
    case "side-chat":
      return `side-chat/${scope.projectId}/${scope.parentThreadId}/${scope.tabId}/${scope.childThreadId ?? "draft"}`;
    case "new-thread":
      return `new-thread/${scope.projectId ?? "unresolved"}`;
  }
}

/** Plugin banner rows rendered at the bottom of a composer's measured stack. */
export function PluginComposerBanners({
  scope,
}: {
  scope: PluginComposerScope;
}) {
  const { composerCustomizations } = usePluginSlots();
  const scopeKey = composerScopeKey(scope);

  return (
    <>
      {composerCustomizations.map((customization) => {
        if (
          customization.scopes !== undefined &&
          !customization.scopes.includes(scope.kind)
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
            </PluginSlotMount>
          );
        });
      })}
    </>
  );
}
