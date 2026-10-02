import type { ResolvedComposerPopup } from "@/lib/plugin-slot-resolvers";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginComposerPopup({
  contribution,
  onClose,
}: {
  contribution: ResolvedComposerPopup;
  onClose(): void;
}) {
  const { pluginId, customizationId, popup } = contribution;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover text-popover-foreground">
      <PluginSlotMount
        pluginId={pluginId}
        slotKind="composerPopup"
        slotId={customizationId}
        crashFallback={
          <button type="button" onClick={onClose}>
            Close popup
          </button>
        }
      >
        <popup.component />
      </PluginSlotMount>
    </div>
  );
}
