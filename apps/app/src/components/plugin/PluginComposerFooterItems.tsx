import { useResolvedComposerFooterItems } from "./composer-slot-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  useOptionalPluginComposerStaticView,
} from "./plugin-composer-host";

export function ComposerFooterItemsSlot({ side }: { side: "start" | "end" }) {
  const view = useOptionalPluginComposerStaticView();
  const items = useResolvedComposerFooterItems(view?.scope.kind ?? null, side);
  if (view === undefined || items.length === 0) return null;
  const scopeKey = composerScopeIdentity(view.scope);
  return (
    <>
      {items.map(({ key, pluginId, customizationId, item }) => (
        <div
          key={`${key}/${scopeKey}`}
          data-plugin-composer-footer-item={side}
          className="flex max-h-6 min-w-0 max-w-48 shrink-0 items-center overflow-hidden text-xs text-subtle-foreground"
        >
          <PluginSlotMount
            pluginId={pluginId}
            slotKind="composerFooterItem"
            slotId={`${customizationId}/${side}/${item.id}`}
            crashFallback={<></>}
          >
            <item.component />
          </PluginSlotMount>
        </div>
      ))}
    </>
  );
}
