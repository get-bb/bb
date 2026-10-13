import { useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  ThreadLifecycleFilterItems,
  threadLifecycleFilterLabel,
} from "@/components/thread/ThreadLifecycleFilter";
import {
  PALETTE_THREAD_SORT_OPTIONS,
  type PaletteThreadSort,
  type PaletteThreadSortDirection,
} from "@/lib/command-palette/palette-preferences";
import type { ThreadArchiveFilter } from "@/lib/thread-lifecycle-filter";

const MENU_SECTION_LABEL_CLASS = "font-normal text-subtle-foreground";

const MENU_GAP_PX = 8;

function sortLabel(value: PaletteThreadSort): string {
  return (
    PALETTE_THREAD_SORT_OPTIONS.find((option) => option.value === value)
      ?.label ?? PALETTE_THREAD_SORT_OPTIONS[0].label
  );
}

export function PaletteThreadViewMenu({
  lifecycles,
  onLifecyclesChange,
  sort,
  sortDirection,
  onSortChange,
  onCloseAutoFocus,
}: {
  lifecycles: readonly ThreadArchiveFilter[];
  onLifecyclesChange: (value: ThreadArchiveFilter[]) => void;
  sort: PaletteThreadSort;
  sortDirection: PaletteThreadSortDirection;
  onSortChange: (
    sort: PaletteThreadSort,
    direction: PaletteThreadSortDirection,
  ) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const isPointerCoarse = usePointerCoarse();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [sideOffset, setSideOffset] = useState(MENU_GAP_PX);
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        const trigger = triggerRef.current;
        const palette = trigger?.closest("[role=dialog]");
        if (!open || isPointerCoarse || !trigger || !palette) return;
        setSideOffset(
          palette.getBoundingClientRect().right -
            trigger.getBoundingClientRect().right +
            MENU_GAP_PX,
        );
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          className="w-8 justify-center px-0 text-subtle-foreground"
          aria-label={`Filter and sort: ${threadLifecycleFilterLabel(lifecycles)}, ${sortLabel(sort)}${
            sort === "relevance" ? "" : `, ${sortDirection}`
          }`}
        >
          <Icon
            name="SlidersHorizontal"
            className="size-3.5 shrink-0"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isPointerCoarse ? "bottom" : "right"}
        align={isPointerCoarse ? "end" : "start"}
        sideOffset={isPointerCoarse ? undefined : sideOffset}
        mobileTitle="Filter and sort"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuGroup aria-label="Filter">
          <DropdownMenuLabel className={MENU_SECTION_LABEL_CLASS}>
            Filter
          </DropdownMenuLabel>
          <ThreadLifecycleFilterItems
            value={lifecycles}
            onChange={onLifecyclesChange}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Sort by">
          <DropdownMenuLabel className={MENU_SECTION_LABEL_CLASS}>
            Sort by
          </DropdownMenuLabel>
          {PALETTE_THREAD_SORT_OPTIONS.map((option) => {
            const selected = option.value === sort;
            const reversible = option.value !== "relevance";
            const direction = selected ? sortDirection : "descending";
            const nextDirection =
              selected && reversible
                ? direction === "ascending"
                  ? "descending"
                  : "ascending"
                : "descending";
            return (
              <DropdownMenuItem
                key={option.value}
                role="menuitemradio"
                aria-checked={selected}
                aria-label={
                  selected && reversible
                    ? `${option.label}, ${direction}. Sort ${nextDirection}`
                    : option.label
                }
                onSelect={(event) => {
                  event.preventDefault();
                  onSortChange(option.value, nextDirection);
                }}
              >
                {option.label}
                <span className="ml-auto inline-flex size-4 items-center justify-center">
                  {selected && (
                    <Icon
                      name={direction === "ascending" ? "ArrowUp" : "ArrowDown"}
                      className="size-4"
                    />
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
