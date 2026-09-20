import { getUiPreferenceDefault } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@bb/shared-ui/dropdown-menu";
import { ThreadLifecycleFilterItems } from "@/components/thread/ThreadLifecycleFilter";
import type { SidebarViewItemsProps } from "./SidebarHeaderControls";

export function SidebarViewItems({
  page,
  settings,
  organizeOptions,
  sortOptions,
}: SidebarViewItemsProps) {
  const {
    lifecycles,
    setLifecycles,
    organization,
    setOrganization,
    setSort,
    savedDirection,
    setDirection,
    selectedSort,
    changed,
  } = settings;
  const reset = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="text-xs text-muted-foreground"
        disabled={!changed[page]}
        onSelect={(event) => {
          event.preventDefault();
          if (page === "organize") {
            setOrganization(getUiPreferenceDefault("sidebar.organizationMode"));
          } else if (page === "sort") {
            setSort(getUiPreferenceDefault("sidebar.chronologicalSort"));
            setDirection(getUiPreferenceDefault("sidebar.sortDirection"));
          } else {
            setLifecycles(getUiPreferenceDefault("sidebar.threadLifecycles"));
          }
        }}
      >
        Reset to default
      </DropdownMenuItem>
    </>
  );
  if (page === "filter") {
    return (
      <>
        <DropdownMenuGroup aria-label="Thread lifecycle">
          <ThreadLifecycleFilterItems
            value={lifecycles}
            onChange={setLifecycles}
          />
        </DropdownMenuGroup>
        {reset}
      </>
    );
  }
  if (page === "organize") {
    return (
      <>
        <DropdownMenuGroup aria-label="Sections">
          <DropdownMenuLabel>Sections</DropdownMenuLabel>
          {organizeOptions.map((option) => (
            <DropdownMenuItem
              key={option.mode}
              role="menuitemradio"
              aria-checked={organization === option.mode}
              onSelect={(event) => {
                event.preventDefault();
                setOrganization(option.mode);
              }}
            >
              {option.label}
              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
                {organization === option.mode && (
                  <Icon name="Check" className="size-4" />
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {reset}
      </>
    );
  }
  return (
    <>
      <DropdownMenuGroup aria-label="Sort">
        {sortOptions.map((option) => {
          const selected = selectedSort === option.sort;
          const direction =
            savedDirection === "default" ? option.direction : savedDirection;
          const nextDirection = selected
            ? direction === "ascending"
              ? "descending"
              : "ascending"
            : option.direction;
          return (
            <DropdownMenuItem
              key={option.sort}
              role="menuitemradio"
              aria-checked={selected}
              aria-label={
                selected
                  ? `${option.label}, ${direction}. Sort ${nextDirection}`
                  : option.label
              }
              onSelect={(event) => {
                event.preventDefault();
                setSort(option.sort);
                setDirection(nextDirection);
              }}
            >
              {option.label}
              {selected && (
                <span className="sr-only">
                  , {direction}. Sort {nextDirection}
                </span>
              )}
              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
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
      {reset}
    </>
  );
}
