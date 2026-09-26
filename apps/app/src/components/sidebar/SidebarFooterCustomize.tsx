import { useEffect, useRef } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { FooterItemIcon } from "@/components/plugin/PluginSidebarFooterItems";
import {
  type FooterItem,
  SIDEBAR_FOOTER_MAX_ICONS,
  useSidebarFooterPreferences,
} from "./sidebarFooterPreferences";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import { useSidebarSortable } from "./sortableMotion";

const BADGE_CLASS =
  "flex size-4 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground outline-none after:absolute after:-inset-1.5 after:content-[''] hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-default disabled:opacity-40";

export function SidebarFooterCustomize({ onDone }: { onDone: () => void }) {
  const preferences = useSidebarFooterPreferences();
  const containerRef = useRef<HTMLDivElement>(null);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (typeof active.id === "string" && typeof over?.id === "string") {
      preferences.move(active.id, over.id);
    }
  };
  const footerDnd = useSidebarReorderDnd({
    axis: "free",
    collisionDetection: closestCenter,
    onDragEnd: handleDragEnd,
  });
  const moreDnd = useSidebarReorderDnd({ onDragEnd: handleDragEnd });
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLButtonElement>("[data-footer-placement-toggle]")
      ?.focus();
  }, []);
  const emptySlots = SIDEBAR_FOOTER_MAX_ICONS - preferences.footer.length;

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
          className="h-6 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
      <ZoneLabel
        label="Footer"
        detail={`${preferences.footer.length} of ${SIDEBAR_FOOTER_MAX_ICONS}`}
      />
      <div className="flex items-center gap-2 rounded-md bg-sidebar-accent p-2">
        <ul
          aria-label="Footer icons"
          className="flex min-w-0 flex-1 items-center gap-2"
          onClickCapture={footerDnd.onClickCapture}
        >
          <DndContext {...footerDnd.dndContextProps}>
            <SortableContext
              items={preferences.footer.map((item) => item.key)}
              strategy={horizontalListSortingStrategy}
            >
              {preferences.footer.map((item) => (
                <FooterIconTile
                  key={item.key}
                  item={item}
                  reorderDisabled={preferences.footer.length < 2}
                  onRemove={() => preferences.hideFromFooter(item.key)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {Array.from({ length: emptySlots }, (_, index) => (
            <li
              key={index}
              aria-hidden="true"
              className={cn(
                SIDEBAR_FOOTER_ACTION_CLASS,
                "shrink-0 rounded-md border border-dashed border-sidebar-foreground/20",
              )}
            />
          ))}
        </ul>
        <span
          aria-hidden="true"
          className={cn(
            SIDEBAR_FOOTER_ACTION_CLASS,
            "flex shrink-0 items-center justify-center text-muted-foreground",
          )}
        >
          <Icon name="MoreHorizontal" />
        </span>
      </div>
      <ZoneLabel label="More menu" />
      {preferences.more.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Every icon is in the footer.
        </p>
      ) : (
        <ul
          aria-label="More menu items"
          className="space-y-0.5"
          onClickCapture={moreDnd.onClickCapture}
        >
          <DndContext {...moreDnd.dndContextProps}>
            <SortableContext
              items={preferences.more.map((item) => item.key)}
              strategy={verticalListSortingStrategy}
            >
              {preferences.more.map((item) => (
                <MoreMenuRow
                  key={item.key}
                  item={item}
                  reorderDisabled={preferences.more.length < 2}
                  addDisabled={preferences.isFull}
                  onAdd={() => preferences.addToFooter(item.key)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </ul>
      )}
      <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
        {preferences.isFull && preferences.more.length > 0
          ? "Footer is full. Remove an icon to add another."
          : "Drag to reorder."}
      </p>
    </div>
  );
}

function ZoneLabel({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2 text-xs text-muted-foreground">
      <span>{label}</span>
      {detail !== undefined && <span className="tabular-nums">{detail}</span>}
    </div>
  );
}

function FooterIconTile({
  item,
  reorderDisabled,
  onRemove,
}: {
  item: FooterItem;
  reorderDisabled: boolean;
  onRemove: () => void;
}) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.key,
    disabled: reorderDisabled,
  });
  return (
    <li ref={setNodeRef} style={style} className="relative flex shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={dragBindings.setActivatorNodeRef}
            {...dragBindings.attributes}
            {...dragBindings.listeners}
            aria-label={`Reorder ${item.label}`}
            data-footer-icon={item.key}
            className={cn(
              SIDEBAR_FOOTER_ACTION_CLASS,
              "flex touch-none items-center justify-center rounded-md border border-sidebar-foreground/15 bg-sidebar outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              !reorderDisabled && "cursor-grab active:cursor-grabbing",
            )}
          >
            <FooterItemIcon item={item} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{item.label}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={`Remove ${item.label} from footer`}
        data-footer-placement-toggle={item.key}
        className={cn(BADGE_CLASS, "absolute -right-1.5 -top-1.5")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <Icon name="Minus" className="size-3" />
      </button>
    </li>
  );
}

function MoreMenuRow({
  item,
  reorderDisabled,
  addDisabled,
  onAdd,
}: {
  item: FooterItem;
  reorderDisabled: boolean;
  addDisabled: boolean;
  onAdd: () => void;
}) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.key,
    disabled: reorderDisabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex min-h-7 items-center gap-1 rounded-md px-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent focus-within:bg-sidebar-accent"
      data-footer-more-item={item.key}
    >
      <button
        type="button"
        ref={dragBindings.setActivatorNodeRef}
        {...dragBindings.attributes}
        {...dragBindings.listeners}
        aria-label={`Reorder ${item.label}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
      >
        <Icon name="DragDropVertical" className="size-4" />
      </button>
      <FooterItemIcon item={item} />
      <span className="min-w-0 flex-1 truncate px-1">{item.label}</span>
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <button
          type="button"
          aria-label={`Add ${item.label} to footer`}
          data-footer-placement-toggle={item.key}
          disabled={addDisabled}
          className={cn(BADGE_CLASS, "relative")}
          onClick={onAdd}
        >
          <Icon name="Plus" className="size-3" />
        </button>
      </span>
    </li>
  );
}
