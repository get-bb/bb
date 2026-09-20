import { createContext, useContext, useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { getUiPreferenceDefault } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@bb/shared-ui/dropdown-menu";
import {
  sidebarOrganizationModeAtom,
  sidebarChronologicalSortAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarEnvironmentGroupingAtom,
  sidebarSortDirectionAtom,
  sidebarThreadLifecyclesAtom,
} from "./sidebarCollapsedAtoms";
import {
  ThreadLifecycleFilterItems,
  THREAD_LIFECYCLE_OPTIONS,
} from "@/components/thread/ThreadLifecycleFilter";
import { SidebarControlButton, SidebarRowControls } from "./SidebarRowControls";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "./sidebarRowClasses";

interface HeaderCreationActions {
  onNewProject?: () => void;
  onNewSection?: () => void;
  isCreatingProject?: boolean;
  isCreatingSection?: boolean;
}

const HeaderCreationContext = createContext<HeaderCreationActions>({});
export const SidebarHeaderActionsProvider = HeaderCreationContext.Provider;

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

function useSidebarViewSettings() {
  const [lifecycles, setLifecycles] = useAtom(sidebarThreadLifecyclesAtom);
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [sort, setSort] = useAtom(sidebarChronologicalSortAtom);
  const [savedDirection, setDirection] = useAtom(sidebarSortDirectionAtom);
  const [, setEnvironmentGrouping] = useAtom(sidebarEnvironmentGroupingAtom);
  const groupByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const selectedSort = sort === "none" ? "updated" : sort;
  const direction =
    savedDirection === "default"
      ? selectedSort === "alpha"
        ? "ascending"
        : "descending"
      : savedDirection;
  const defaultOrganization = getUiPreferenceDefault(
    "sidebar.organizationMode",
  );
  const defaultGrouping = getUiPreferenceDefault(
    "sidebar.threadGrouping.environment",
  );
  const defaultSort = getUiPreferenceDefault("sidebar.chronologicalSort");
  const defaultDirection = getUiPreferenceDefault("sidebar.sortDirection");
  const defaultLifecycles = getUiPreferenceDefault("sidebar.threadLifecycles");
  const changed = {
    organize:
      organization !== defaultOrganization ||
      groupByEnvironment !==
        (defaultGrouping === "auto"
          ? organization !== "chronological"
          : defaultGrouping),
    sort:
      selectedSort !== defaultSort ||
      direction !==
        (defaultDirection === "default"
          ? defaultSort === "alpha"
            ? "ascending"
            : "descending"
          : defaultDirection),
    filter:
      lifecycles.length !== defaultLifecycles.length ||
      lifecycles.some((value) => !defaultLifecycles.includes(value)),
  };
  const summary = [
    changed.organize &&
      `Organize: ${SIDEBAR_ORGANIZE_OPTIONS.find((option) => option.mode === organization)?.label}, ${groupByEnvironment ? "grouped by environment" : "ungrouped"}`,
    changed.sort &&
      `Sort by: ${SIDEBAR_SORT_OPTIONS.find((option) => option.sort === selectedSort)?.label}, ${direction}`,
    changed.filter &&
      `Filter threads: ${THREAD_LIFECYCLE_OPTIONS.filter((option) =>
        lifecycles.includes(option.value),
      )
        .map((option) => option.label)
        .join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  return {
    lifecycles,
    setLifecycles,
    organization,
    setOrganization,
    setSort,
    savedDirection,
    setDirection,
    setEnvironmentGrouping,
    groupByEnvironment,
    selectedSort,
    changed,
    summary,
  };
}

function SidebarViewItems({ page }: { page: "organize" | "sort" | "filter" }) {
  const {
    lifecycles,
    setLifecycles,
    organization,
    setOrganization,
    setSort,
    savedDirection,
    setDirection,
    setEnvironmentGrouping,
    groupByEnvironment,
    selectedSort,
    changed,
  } = useSidebarViewSettings();
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
            setEnvironmentGrouping(
              getUiPreferenceDefault("sidebar.threadGrouping.environment"),
            );
          } else if (page === "sort") {
            setSort(getUiPreferenceDefault("sidebar.chronologicalSort"));
            setDirection(getUiPreferenceDefault("sidebar.sortDirection"));
          } else {
            setLifecycles(getUiPreferenceDefault("sidebar.threadLifecycles"));
          }
        }}
      >
        Reset
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
        {reset}
      </>
    );
  }
  return (
    <>
      <DropdownMenuGroup aria-label="Sort by">
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
      {reset}
    </>
  );
}

export function SidebarHeaderControls({
  label,
  onNewThread,
  showNewThread = true,
  children,
  open,
  onOpenChange,
}: {
  label: string;
  onNewThread?: () => void;
  showNewThread?: boolean;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const creation = useContext(HeaderCreationContext);
  const { summary } = useSidebarViewSettings();
  const triggerLabel = summary
    ? `${label} actions; ${summary}`
    : `${label} actions`;
  const compact = useIsCompactViewport();
  const [page, setPage] = useState<"organize" | "sort" | "filter" | null>(null);
  const changeOpen = (next: boolean) => {
    if (!next) setPage(null);
    onOpenChange?.(next);
  };
  return (
    <SidebarRowControls
      primaryAction={
        showNewThread ? (
          <SidebarControlButton
            label={`New thread in ${label}`}
            icon="MessageSquarePlus"
            onClick={() => onNewThread?.()}
            disabled={!onNewThread}
          />
        ) : null
      }
    >
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <Tooltip delayDuration={350} disableHoverableContent>
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={triggerLabel}
                className={cn(
                  SIDEBAR_CONTROL_BUTTON_CLASS,
                  summary &&
                    "bg-state-active text-foreground hover:bg-state-active hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground",
                )}
              >
                <Icon
                  name={summary ? "FilterHorizontal" : "MoreHorizontal"}
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent side="bottom">{triggerLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          mobileTitle={
            page === "organize"
              ? "Organize"
              : page === "sort"
                ? "Sort by"
                : page === "filter"
                  ? "Filter threads"
                  : `${label} actions`
          }
        >
          {compact && page ? (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setPage(null);
                }}
              >
                <Icon name="ChevronLeft" />
                Back
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <SidebarViewItems page={page} />
            </>
          ) : (
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
                  {
                    page: "filter",
                    label: "Filter threads",
                    icon: "SlidersHorizontal",
                  },
                ] as const
              ).map((item) =>
                compact ? (
                  <DropdownMenuItem
                    key={item.page}
                    onSelect={(event) => {
                      event.preventDefault();
                      setPage(item.page);
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
                      <DropdownMenuSubContent className="w-max min-w-28 max-w-64">
                        <SidebarViewItems page={item.page} />
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                ),
              )}
              {children && (
                <>
                  <DropdownMenuSeparator />
                  {children}
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowControls>
  );
}

export function SidebarSectionMenuItems({
  onRename,
  onRemove,
}: {
  onRename?: () => void;
  onRemove?: () => void;
}) {
  return (
    <>
      {onRename && (
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="Edit" />
          Rename
        </DropdownMenuItem>
      )}
      {onRemove && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Icon name="Trash2" />
            Remove
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
