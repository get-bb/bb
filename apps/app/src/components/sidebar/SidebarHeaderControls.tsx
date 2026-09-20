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
  hasCustomSections: boolean;
  onNewProject?: () => void;
  onNewSection?: () => void;
  isCreatingProject?: boolean;
  isCreatingSection?: boolean;
}

const HeaderCreationContext = createContext<HeaderCreationActions>({
  hasCustomSections: false,
});
export const SidebarHeaderActionsProvider = HeaderCreationContext.Provider;

const SIDEBAR_ORGANIZE_OPTIONS = [
  { label: "By project", mode: "project" },
  { label: "By machine", mode: "machine" },
  { label: "Custom", mode: "chronological" },
] as const;

type SidebarViewPage = "organize" | "sort";

function SidebarViewItems({ page }: { page: SidebarViewPage }) {
  const { hasCustomSections } = useContext(HeaderCreationContext);
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
  const unit =
    organization === "project"
      ? "projects"
      : organization === "machine"
        ? "machines"
        : "sections";
  const sortOptions = [
    {
      label: "Updated at",
      sort: "updated",
      direction: "descending",
      includeGroups: false,
    },
    {
      label: `Updated at (include ${unit})`,
      sort: "updated",
      direction: "descending",
      includeGroups: true,
    },
    { label: "Created at", sort: "created", direction: "descending" },
    { label: "Alphabetical", sort: "alpha", direction: "ascending" },
  ] as const;
  return (
    <DropdownMenuGroup aria-label="Sort by">
      {sortOptions.map((option) => {
        const selected =
          selectedSort === option.sort &&
          (option.sort !== "updated" ||
            sortGroupsByRecency === option.includeGroups);
        const direction =
          savedDirection === "default" ? option.direction : savedDirection;
        const nextDirection = selected
          ? direction === "ascending"
            ? "descending"
            : "ascending"
          : option.direction;
        return (
          <DropdownMenuItem
            key={option.label}
            disabled={
              option.sort === "updated" &&
              option.includeGroups &&
              organization === "chronological" &&
              !hasCustomSections
            }
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
              if (option.sort === "updated") {
                setSortGroupsByRecency(option.includeGroups);
              }
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
