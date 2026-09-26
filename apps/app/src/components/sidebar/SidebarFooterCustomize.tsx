import { useEffect, useRef, useState } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
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
  const shown = preferences.items.filter(
    (item) => !preferences.hidden.includes(item.key),
  );
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
      ?.querySelector<HTMLButtonElement>("[data-footer-action-slot]")
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
      <div
        role="group"
        aria-label="Footer action slots"
        className="flex flex-wrap items-center gap-1 rounded-md bg-sidebar-accent p-2"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={shown.map((item) => item.key)}
            strategy={rectSortingStrategy}
          >
            {shown.map((item, index) => (
              <FooterActionSlot
                key={item.key}
                item={item}
                index={index}
                items={preferences.items}
                reorderDisabled={shown.length < 2}
                onChange={(key) => preferences.assign(item.key, key)}
              />
            ))}
            {shown.length < preferences.items.length && (
              <FooterActionSlot
                item={null}
                index={shown.length}
                items={preferences.items}
                reorderDisabled
                onChange={(key) => preferences.assign(null, key)}
              />
            )}
          </SortableContext>
        </DndContext>
        <span
          aria-hidden="true"
          className={cn(
            SIDEBAR_FOOTER_ACTION_CLASS,
            "flex items-center justify-center",
          )}
        >
          <Icon name="MoreHorizontal" />
        </span>
      </div>
      <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
        Click an icon to choose an action. Drag to reorder.
      </p>
    </div>
  );
}

function FooterActionSlot({
  item,
  index,
  items,
  reorderDisabled,
  onChange,
}: {
  item: FooterItem | null;
  index: number;
  items: readonly FooterItem[];
  reorderDisabled: boolean;
  onChange: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item?.key ?? "empty-footer-slot",
    disabled: reorderDisabled,
  });
  const label = `Footer action ${index + 1}: ${item?.label ?? "None"}`;
  return (
    <Tooltip>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <span ref={setNodeRef} style={style} className="flex">
            <TooltipTrigger asChild>
              <button
                ref={(element) => {
                  buttonRef.current = element;
                  dragBindings.setActivatorNodeRef(element);
                }}
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                data-footer-action-slot={item?.key ?? "none"}
                className={cn(
                  SIDEBAR_FOOTER_ACTION_CLASS,
                  "flex cursor-pointer touch-none items-center justify-center rounded-md border outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  item
                    ? "border-sidebar-foreground/15"
                    : "border-dashed border-sidebar-foreground/25",
                  !reorderDisabled && "active:cursor-grabbing",
                )}
                {...dragBindings.listeners}
                onKeyDown={undefined}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setOpen(true)}
              >
                {item && <FooterItemIcon item={item} />}
              </button>
            </TooltipTrigger>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          mobileTitle="Choose footer action"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = buttonRef.current?.isConnected
              ? buttonRef.current
              : document.querySelector<HTMLButtonElement>(
                  "[data-footer-action-slot]",
                );
            target?.focus();
          }}
        >
          {items.map((option) => (
            <DropdownMenuItem
              key={option.key}
              role="menuitemradio"
              aria-checked={item?.key === option.key}
              onSelect={() => onChange(option.key)}
            >
              <FooterItemIcon item={option} />
              {option.label}
              {item?.key === option.key && (
                <Icon name="Check" className="ml-auto" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            role="menuitemradio"
            aria-checked={item === null}
            onSelect={() => onChange(null)}
          >
            <Icon name="X" />
            None
            {item === null && <Icon name="Check" className="ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="top" hidden={open}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
