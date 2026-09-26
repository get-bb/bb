import { useEffect, useRef } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { FooterItemIcon } from "@/components/plugin/PluginSidebarFooterItems";
import {
  type FooterItem,
  useSidebarFooterPreferences,
} from "./sidebarFooterPreferences";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import { useSidebarSortable } from "./sortableMotion";

export function SidebarFooterCustomize({ onDone }: { onDone: () => void }) {
  const preferences = useSidebarFooterPreferences();
  const containerRef = useRef<HTMLDivElement>(null);
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    axis: "free",
    collisionDetection: closestCenter,
    onDragEnd: ({ active, over }) => {
      if (typeof active.id === "string" && typeof over?.id === "string") {
        preferences.move(active.id, over.id);
      }
    },
  });
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLButtonElement>("[data-footer-visibility-toggle]")
      ?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-sidebar-border/40 bg-sidebar-accent/40 p-1"
      data-testid="sidebar-footer-customize-inline"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onDone();
      }}
    >
      <div className="flex items-center gap-1 pb-1">
        <div
          className={cn("min-w-0 flex-1 px-2 py-1", CHROME_SECTION_LABEL_CLASS)}
        >
          Customize footer
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
      <ul
        aria-label="Footer icons"
        className="flex flex-wrap items-center gap-2 rounded-md bg-sidebar-accent p-2"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={preferences.items.map((item) => item.key)}
            strategy={rectSortingStrategy}
          >
            {preferences.items.map((item) => (
              <FooterIconTile
                key={item.key}
                item={item}
                shown={!preferences.hidden.includes(item.key)}
                reorderDisabled={preferences.items.length < 2}
                onVisibleChange={(visible) =>
                  preferences.setVisible(item.key, visible)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </ul>
      <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
        Drag icons to reorder.
      </p>
    </div>
  );
}

function FooterIconTile({
  item,
  shown,
  reorderDisabled,
  onVisibleChange,
}: {
  item: FooterItem;
  shown: boolean;
  reorderDisabled: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.key,
    disabled: reorderDisabled,
  });
  const toggleLabel = shown
    ? `Hide ${item.label} from footer`
    : `Show ${item.label} in footer`;
  return (
    <li ref={setNodeRef} style={style} className="relative flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            ref={dragBindings.setActivatorNodeRef}
            aria-hidden="true"
            data-footer-icon={item.key}
            className={cn(
              SIDEBAR_FOOTER_ACTION_CLASS,
              "flex touch-none items-center justify-center rounded-md border",
              shown
                ? "border-sidebar-foreground/15"
                : "border-dashed border-sidebar-foreground/25 opacity-50",
              !reorderDisabled && "cursor-grab active:cursor-grabbing",
            )}
            {...dragBindings.listeners}
            onKeyDown={undefined}
          >
            <FooterItemIcon item={item} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{item.label}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={toggleLabel}
        data-footer-visibility-toggle={item.key}
        className="absolute -right-1.5 -top-1.5 flex size-4 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground outline-none after:absolute after:-inset-1.5 after:content-[''] hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onVisibleChange(!shown)}
      >
        <Icon name={shown ? "Minus" : "Plus"} className="size-3" />
      </button>
    </li>
  );
}
