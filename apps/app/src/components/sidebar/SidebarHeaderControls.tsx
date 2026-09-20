import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { getUiPreferenceDefault } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  sidebarSortDirectionAtom,
  sidebarThreadLifecyclesAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarEnvironmentGroupingAtom,
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

const LazySidebarViewItems = lazy(() =>
  import("./SidebarViewItems").then(({ SidebarViewItems }) => ({
    default: SidebarViewItems,
  })),
);

export interface SidebarViewItemsProps {
  page: "organize" | "sort" | "filter";
  settings: ReturnType<typeof useSidebarViewSettings>;
  organizeOptions: typeof SIDEBAR_ORGANIZE_OPTIONS;
  sortOptions: typeof SIDEBAR_SORT_OPTIONS;
}

function useSidebarViewSettings() {
  const [lifecycles, setLifecycles] = useAtom(sidebarThreadLifecyclesAtom);
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [sort, setSort] = useAtom(sidebarChronologicalSortAtom);
  const [savedDirection, setDirection] = useAtom(sidebarSortDirectionAtom);
  const setEnvironmentGrouping = useSetAtom(sidebarEnvironmentGroupingAtom);
  const groupByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const selectedSort = sort === "none" ? "updated" : sort;
  const direction =
    savedDirection === "default"
      ? selectedSort === "alpha"
        ? "ascending"
        : "descending"
      : savedDirection;
  const defaultSort = getUiPreferenceDefault("sidebar.chronologicalSort");
  const defaultDirection = getUiPreferenceDefault("sidebar.sortDirection");
  const defaultLifecycles = getUiPreferenceDefault("sidebar.threadLifecycles");
  const changed = {
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
  return {
    lifecycles,
    setLifecycles,
    organization,
    setOrganization,
    groupByEnvironment,
    setEnvironmentGrouping,
    setSort,
    savedDirection,
    setDirection,
    selectedSort,
    changed,
  };
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
  const settings = useSidebarViewSettings();
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
                : page === "filter"
                  ? "Filter"
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
              <Suspense
                fallback={<DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
              >
                <LazySidebarViewItems
                  page={page}
                  settings={settings}
                  organizeOptions={SIDEBAR_ORGANIZE_OPTIONS}
                  sortOptions={SIDEBAR_SORT_OPTIONS}
                />
              </Suspense>
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
                    label: "Filter",
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
                      <DropdownMenuSubContent
                        className={
                          item.page === "organize"
                            ? "min-w-32"
                            : "w-max min-w-28 max-w-64"
                        }
                      >
                        <Suspense
                          fallback={
                            <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                          }
                        >
                          <LazySidebarViewItems
                            page={item.page}
                            settings={settings}
                            organizeOptions={SIDEBAR_ORGANIZE_OPTIONS}
                            sortOptions={SIDEBAR_SORT_OPTIONS}
                          />
                        </Suspense>
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
