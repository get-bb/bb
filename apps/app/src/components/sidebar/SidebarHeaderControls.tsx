import { createContext, useContext, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  sidebarSortGroupsByRecencyAtom,
} from "./sidebarCollapsedAtoms";
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

type SidebarViewPage = "organize" | "sort" | "updated";

function SidebarViewItems({
  page,
  onOpenUpdated,
}: {
  page: SidebarViewPage;
  onOpenUpdated?: () => void;
}) {
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [sort, setSort] = useAtom(sidebarChronologicalSortAtom);
  const [savedDirection, setDirection] = useAtom(sidebarSortDirectionAtom);
  const [sortGroupsByRecency, setSortGroupsByRecency] = useAtom(
    sidebarSortGroupsByRecencyAtom,
  );
  const setEnvironmentGrouping = useSetAtom(sidebarEnvironmentGroupingAtom);
  const groupByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const selectedSort = sort === "none" ? "updated" : sort;
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
  if (page === "updated") {
    const direction =
      savedDirection === "default" ? "descending" : savedDirection;
    const active = selectedSort === "updated" && sortGroupsByRecency;
    const unit =
      organization === "project"
        ? "projects"
        : organization === "machine"
          ? "machines"
          : "sections";
    return (
      <DropdownMenuGroup aria-label="Updated at">
        {(
          [
            { label: "Newest first", direction: "descending" },
            { label: "Oldest first", direction: "ascending" },
          ] as const
        ).map((option) => (
          <DropdownMenuItem
            key={option.direction}
            role="menuitemradio"
            aria-checked={
              selectedSort === "updated" && direction === option.direction
            }
            onSelect={(event) => {
              event.preventDefault();
              setSort("updated");
              setDirection(option.direction);
            }}
          >
            {option.label}
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {selectedSort === "updated" && direction === option.direction && (
                <Icon name="Check" className="size-4" />
              )}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={active}
          onSelect={(event) => {
            event.preventDefault();
            setSort("updated");
            if (selectedSort !== "updated") setDirection("descending");
            setSortGroupsByRecency(!active);
          }}
        >
          Sort {unit} too
          <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
            {active && <Icon name="Check" className="size-4" />}
          </span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    );
  }
  return (
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
        if (option.sort === "updated") {
          const label = selected ? `${option.label}, ${direction}` : option.label;
          const contents = (
            <>
              {option.label}
              {selected && (
                <Icon
                  name={direction === "ascending" ? "ArrowUp" : "ArrowDown"}
                  className="ml-auto size-4"
                />
              )}
            </>
          );
          return onOpenUpdated ? (
            <DropdownMenuItem
              key={option.sort}
              aria-label={label}
              onSelect={(event) => {
                event.preventDefault();
                onOpenUpdated();
              }}
            >
              {contents}
              <Icon name="ChevronRight" className="ml-auto" />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub key={option.sort}>
              <DropdownMenuSubTrigger aria-label={label}>
                {contents}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <SidebarViewItems page="updated" />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          );
        }
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
  const compact = useIsCompactViewport();
  const [page, setPage] = useState<SidebarViewPage | null>(null);
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
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label} actions`}
            className={SIDEBAR_CONTROL_BUTTON_CLASS}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          mobileTitle={
            page === "organize"
              ? "Organize"
              : page === "sort"
                ? "Sort by"
                : page === "updated"
                  ? "Updated at"
                  : `${label} actions`
          }
        >
          {compact && page ? (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setPage(page === "updated" ? "sort" : null);
                }}
              >
                <Icon name="ChevronLeft" />
                Back
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <SidebarViewItems
                page={page}
                onOpenUpdated={() => setPage("updated")}
              />
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
                  { page: "sort", label: "Sort by", icon: "Sort" },
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
                      <DropdownMenuSubContent className="min-w-32">
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
