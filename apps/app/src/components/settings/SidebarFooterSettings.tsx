import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Switch } from "@bb/shared-ui/switch";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { useReorderDnd } from "@/components/ui/useReorderDnd";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import {
  useSidebarFooterPreferences,
  type FooterItem,
} from "@/components/sidebar/sidebarFooterPreferences";
import { FooterItemIcon } from "@/components/plugin/PluginSidebarFooterItems";

export function SidebarFooterSettings() {
  const preferences = useSidebarFooterPreferences();
  const { dndContextProps, onClickCapture } = useReorderDnd({
    onDragEnd(event) {
      if (
        typeof event.active.id === "string" &&
        typeof event.over?.id === "string"
      )
        preferences.move(event.active.id, event.over.id);
    },
  });
  return (
    <SettingsWithControl
      label="Sidebar footer"
      description="Drag to reorder. Icons that don't fit the sidebar's width stay in the footer's More menu."
      controlPlacement="below"
    >
      <div
        className="rounded-md border border-border"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={preferences.items.map((item) => item.key)}
            strategy={verticalListSortingStrategy}
          >
            {preferences.items.map((item) => (
              <FooterSettingsRow
                key={item.key}
                item={item}
                visible={preferences.footer.includes(item)}
                disabled={
                  preferences.isFull && !preferences.footer.includes(item)
                }
                onVisibleChange={(visible) =>
                  visible
                    ? preferences.addToFooter(item.key)
                    : preferences.hideFromFooter(item.key)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </SettingsWithControl>
  );
}

function FooterSettingsRow({
  item,
  visible,
  disabled,
  onVisibleChange,
}: {
  item: FooterItem;
  visible: boolean;
  disabled: boolean;
  onVisibleChange(visible: boolean): void;
}) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.key,
    disabled: false,
  });
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0"
      data-footer-setting={item.key}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-7 touch-none text-muted-foreground"
        ref={dragBindings.setActivatorNodeRef}
        {...dragBindings.attributes}
        {...dragBindings.listeners}
        aria-label={`Reorder ${item.label}`}
      >
        <Icon name="DragDropVertical" className="size-4" />
      </Button>
      <FooterItemIcon item={item} />
      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
      <Switch
        checked={visible}
        disabled={disabled}
        onCheckedChange={onVisibleChange}
        aria-label={`Show ${item.label} in footer`}
      />
    </div>
  );
}
