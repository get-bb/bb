import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@bb/shared-ui/dropdown-menu";
import type { HeaderCreationActions } from "./SidebarHeaderControls";
import { ThreadListVisibilityMenuItems } from "./ThreadListVisibility";
import { ThreadLifecycleFilterItems } from "@/components/thread/ThreadLifecycleFilter";
import {
  sidebarOrganizationModeAtom,
  sidebarChronologicalSortAtom,
  sidebarSortDirectionAtom,
  sidebarThreadLifecyclesAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarEnvironmentGroupingAtom,
} from "./sidebarCollapsedAtoms";

const SIDEBAR_ORGANIZE_OPTIONS = [
  { label: "By project", mode: "project" },
  { label: "By machine", mode: "machine" },
  { label: "Custom", mode: "chronological" },
] as const;

const SIDEBAR_SORT_OPTIONS = [
  { label: "Updated at", sort: "updated", direction: "descending" },
  { label: "Created at", sort: "created", direction: "descending" },
  { label: "Alphabetical", sort: "alpha", direction: "ascending" },
] as const;

type SidebarViewPage = "organize" | "sort" | "filter";

export function SidebarHeaderMenuContents({
  creation,
  compact,
  page,
  onPageChange,
  children,
}: {
  creation: HeaderCreationActions;
  compact: boolean;
  page: SidebarViewPage | null;
  onPageChange: (page: SidebarViewPage | null) => void;
  children?: ReactNode;
}) {
  if (compact && page) {
    return (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onPageChange(null);
          }}
        >
          <Icon name="ChevronLeft" />
          Back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SidebarViewItems page={page} />
      </>
    );
  }
  return (
    <>
      <DropdownMenuItem
        disabled={!creation.onNewProject || creation.isCreatingProject}
        onSelect={creation.onNewProject}
      >
        <Icon name="FolderPlus" />
        New project
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!creation.onNewSection || creation.isCreatingSection}
        onSelect={creation.onNewSection}
      >
        <Icon name="SectionAdd" />
        New section
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {(
        [
          { page: "organize", label: "Organize", icon: "Layers" },
          { page: "sort", label: "Sort by", icon: "ArrowUpDown" },
          { page: "filter", label: "Filter", icon: "SlidersHorizontal" },
        ] as const
      ).map((item) =>
        compact ? (
          <DropdownMenuItem
            key={item.page}
            onSelect={(event) => {
              event.preventDefault();
              onPageChange(item.page);
            }}
          >
            <Icon name={item.icon} />
            {item.label}
            <Icon name="ChevronRight" className="ml-auto" />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={item.page}>
            <DropdownMenuSubTrigger>
              <Icon name={item.icon} />
              {item.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                className={
                  item.page === "organize"
                    ? "min-w-32"
                    : "w-max min-w-28 max-w-64"
                }
              >
                <SidebarViewItems page={item.page} />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ),
      )}
      {children ? (
        <>
          <DropdownMenuSeparator />
          {children}
        </>
      ) : (
        <ThreadListVisibilityMenuItems />
      )}
    </>
  );
}

function SidebarViewItems({
  page,
}: {
  page: SidebarViewPage;
}) {
  const [lifecycles, setLifecycles] = useAtom(sidebarThreadLifecyclesAtom);
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [sort, setSort] = useAtom(sidebarChronologicalSortAtom);
  const [savedDirection, setDirection] = useAtom(sidebarSortDirectionAtom);
  const setEnvironmentGrouping = useSetAtom(sidebarEnvironmentGroupingAtom);
  const groupByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const selectedSort = sort === "none" ? "updated" : sort;
  if (page === "filter") {
    return (
      <DropdownMenuGroup aria-label="Filter">
        <ThreadLifecycleFilterItems
          value={lifecycles}
          onChange={setLifecycles}
        />
      </DropdownMenuGroup>
    );
  }
  if (page === "organize") {
    return (
      <>
        <DropdownMenuGroup aria-label="Sections">
          <DropdownMenuLabel>Sections</DropdownMenuLabel>
          {SIDEBAR_ORGANIZE_OPTIONS.map((option) => (
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
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Groups">
          <DropdownMenuLabel>Groups</DropdownMenuLabel>
          <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={groupByEnvironment}
            onSelect={(event) => {
              event.preventDefault();
              setEnvironmentGrouping(!groupByEnvironment);
            }}
          >
            By environment
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {groupByEnvironment && <Icon name="Check" className="size-4" />}
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </>
    );
  }
  return (
    <DropdownMenuGroup aria-label="Sort">
      {SIDEBAR_SORT_OPTIONS.map((option) => {
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
  );
}
import type { ReactNode } from "react";
