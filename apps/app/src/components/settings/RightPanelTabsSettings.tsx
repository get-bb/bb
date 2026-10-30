import { useMemo } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Switch } from "@bb/shared-ui/switch";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { useReorderDnd } from "@bb/shared-ui/use-reorder-dnd";
import { useSidebarSortable } from "@bb/shared-ui/sortable-motion";
import { createPluginFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  isThreadTab,
  usePluginSlots,
  type PluginThreadFixedTabSlot,
} from "@/lib/plugin-slots";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import { useRightPanelFixedTabPreferences } from "@/components/secondary-panel/rightPanelFixedTabPreferences";

interface FixedTabSetting {
  id: string;
  slot: PluginThreadFixedTabSlot;
}

function getFixedTabSettingId(item: FixedTabSetting) {
  return item.id;
}

export function RightPanelTabsSettings() {
  const { tabs } = usePluginSlots();
  const items = useMemo(
    () =>
      tabs
        .filter(isThreadTab)
        .filter(
          (slot): slot is PluginThreadFixedTabSlot =>
            slot.availability === "fixed",
        )
        .map((slot) => ({
          id: createPluginFixedPanelTab({
            pluginId: slot.pluginId,
            tabId: slot.id,
          }).id,
          slot,
        })),
    [tabs],
  );
  const preferences = useRightPanelFixedTabPreferences({
    items,
    getId: getFixedTabSettingId,
    activeId: null,
  });
  const { dndContextProps, onClickCapture } = useReorderDnd({
    onDragEnd(event) {
      if (
        typeof event.active.id === "string" &&
        typeof event.over?.id === "string"
      )
        preferences.move(event.active.id, event.over.id);
    },
  });
  if (items.length === 0) return null;
  return (
    <SettingsWithControl
      label="Right panel tabs"
      description="Icon tabs at the top of a thread's right panel. Drag to reorder."
      controlPlacement="below"
    >
      <div
        className="rounded-md border border-border"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={preferences.ordered.map(getFixedTabSettingId)}
            strategy={verticalListSortingStrategy}
          >
            {preferences.ordered.map((item) => (
              <RightPanelTabSettingsRow
                key={item.id}
                item={item}
                visible={!preferences.isHidden(item.id)}
                onVisibleChange={(visible) =>
                  preferences.setShown(item.id, visible)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </SettingsWithControl>
  );
}

function RightPanelTabSettingsRow({
  item,
  visible,
  onVisibleChange,
}: {
  item: FixedTabSetting;
  visible: boolean;
  onVisibleChange(visible: boolean): void;
}) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.id,
    disabled: false,
  });
  const label = item.slot.tooltip ?? item.slot.title;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0"
      data-right-panel-tab-setting={item.id}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-7 touch-none text-muted-foreground"
        ref={dragBindings.setActivatorNodeRef}
        {...dragBindings.attributes}
        {...dragBindings.listeners}
        aria-label={`Reorder ${label}`}
      >
        <Icon name="DragDropVertical" className="size-4" />
      </Button>
      <PluginItemIcon
        pluginId={item.slot.pluginId}
        icon={item.slot.icon}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Switch
        checked={visible}
        onCheckedChange={onVisibleChange}
        aria-label={`Show ${label} in the right panel`}
      />
    </div>
  );
}
