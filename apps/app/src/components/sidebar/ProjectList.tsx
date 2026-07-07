import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  ProjectResponse,
  ThreadFolderResponse,
} from "@bb/server-contract";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
import { useRouteState } from "@/hooks/useRouteState";
import {
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useReorderProject } from "@/hooks/mutations/project-mutations";
import { useReorderPinnedThread } from "@/hooks/mutations/thread-state-mutations";
import {
  useCreateThreadFolder,
  useDeleteThreadFolder,
  useUpdateThreadFolder,
} from "@/hooks/mutations/thread-folder-mutations";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import { useDialogState } from "@/hooks/useDialogState";
import {
  getFolderArchivedRoutePath,
  getProjectlessArchivedRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import {
  ThreadFolderCreateDialog,
  ThreadFolderRenameDialog,
  type ThreadFolderRenameDialogTarget,
} from "@/components/dialogs/ThreadFolderCreateDialog";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  SidebarGroupContent,
  SidebarStickyGroup,
  SidebarStickyStack,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  ChronologicalFolderThreadSections,
  ProjectThreadTree,
} from "./ProjectRow";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";
import type { ProjectThreadListState } from "./ProjectRow";
import {
  compareByCreatedAtDescending,
  compareStandardThreads,
  type ProjectThreadItem,
  type SidebarFolderDefinition,
  type ThreadComparator,
} from "./projectThreadGroups";
import {
  ProjectListProjects,
  type ProjectListReorderBindings,
  type ProjectListRowModel,
} from "./ProjectListProjects";
import {
  PinnedThreadTree,
  type PinnedThreadTreeProps,
} from "./PinnedThreadTree";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";
import {
  collapsedEnvironmentIdsAtom,
  collapsedThreadIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
  DEFAULT_SIDEBAR_SECTION_ORDER,
  sidebarChronologicalSortAtom,
  sidebarCollapsedFoldersAtom,
  sidebarOrganizationModeAtom,
  sidebarSectionOrderAtom,
  sidebarSortDirectionAtom,
  type SidebarChronologicalSort,
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
  type SidebarSortDirection,
} from "./sidebarCollapsedAtoms";
import { folderKeyForThreadFolder } from "./folderKeys";
import { CHRONOLOGICAL_CONTAINER_ID } from "./projectThreadGroups";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  SIDEBAR_LEADING_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
} from "./sidebarRowClasses";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "./useNeighborReorderSortable";
import {
  getSidebarThreadSearchShortcutLabel,
  SIDEBAR_THREAD_SEARCH_LISTBOX_ID,
  type SidebarThreadSearchInputController,
  type SidebarThreadSearchPanelController,
} from "./sidebarThreadSearch";

interface ProjectListProps {
  onNewProject?: () => void;
  onProjectSelect?: () => void;
  isCreatingProject?: boolean;
  threadSearch?: SidebarThreadSearchPanelController;
}

export interface ProjectListActionButtonsProps {
  onNewChat?: () => void;
  threadSearch?: SidebarThreadSearchInputController;
}

interface ProjectListShellProps {
  children: ReactNode;
}

interface ProjectListSectionIconButtonProps {
  ariaLabel: string;
  disabled?: boolean;
  iconName: IconName;
  onClick: () => void;
  title: string;
}

interface ProjectListProjectsSectionActionsProps {
  isCreatingProject: boolean;
  onNewProject: () => void;
}

interface ProjectListThreadsSectionActionsProps {
  isCreatingFolder: boolean;
  onNewFolder?: () => void;
  onNewThread: () => void;
}

interface SidebarGroupOptionsMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarSortOptionsMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ProjectListNavigationLoadingRowProps {
  textWidthClassName: string;
}

interface LocalSourcePathTarget {
  path: string;
  projectId: string;
}

// Exported for plugin nav entries that render as sibling primary action rows.
export const PROJECT_LIST_ACTION_BUTTON_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  LIST_HOVER_TRANSITION,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  "min-w-0 cursor-pointer justify-start overflow-hidden font-normal ring-sidebar-ring focus-visible:ring-2 disabled:cursor-default disabled:opacity-70 max-md:pointer-coarse:[&_svg]:size-5",
);

const PROJECT_LIST_ACTION_ICON_BUTTON_CLASS = cn(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/85 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:cursor-default disabled:opacity-50",
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  "w-8",
);

const PROJECT_LIST_SEARCH_INPUT_ROW_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_STANDARD_ROW_PADDING_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
  "min-w-0 overflow-hidden bg-sidebar-accent pr-1 font-normal text-sidebar-foreground shadow-[0_0_0_1px_var(--sidebar-accent)] transition-shadow focus-within:shadow-[0_0_0_1px_var(--sidebar-border)]",
);

const PROJECT_LIST_SEARCH_INPUT_CLASS = cn(
  "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
  COARSE_POINTER_TEXT_SM_CLASS,
);

const PROJECT_LIST_SEARCH_CLOSE_BUTTON_CLASS =
  "h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground ring-sidebar-ring hover:bg-sidebar-border/60 hover:text-sidebar-foreground focus-visible:ring-2 max-md:pointer-coarse:h-8 max-md:pointer-coarse:w-8";

const PROJECT_LIST_SECTION_ACTION_BUTTON_CLASS = cn(
  "inline-flex items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 disabled:opacity-50",
  LIST_HOVER_TRANSITION,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
);

const PROJECT_LIST_SECTION_ACTION_TOOLTIP_DELAY_MS = 350;

interface ProjectThreadListStateArgs {
  status: ConnectionAwareQueryStatus | undefined;
  threads: ThreadListEntry[] | undefined;
}

interface ToggleCollapsedIdListArgs {
  current: string[];
  id: string;
}

interface SelectedThreadSidebarExpansionArgs {
  isFolderOrganizationMode: boolean;
  isPinned: boolean;
  selectedThread: ThreadListEntry;
}

interface SelectedThreadSidebarExpansion {
  folderKey?: string;
  projectId?: string;
  sidebarSectionId?: CollapsibleSidebarSectionId;
}

type ToggleCollapsedId = (id: string) => void;
type ToggleCollapsedSidebarSectionId = (
  id: CollapsibleSidebarSectionId,
) => void;
type SidebarDisplayOptionsMenuKind = "group" | "sort";

interface TopLevelSidebarSectionProps {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  actionsMobileAlways?: boolean;
  actionsOpen?: boolean;
  collapseControl?: TopLevelSidebarSectionCollapseControl;
  dragBindings?: SidebarSortableDragBindings;
  sectionRef?: (element: HTMLDivElement | null) => void;
  sectionStyle?: CSSProperties;
  consumeClickSuppression?: ConsumeDragClickSuppression;
}

interface SortableSidebarSectionProps extends TopLevelSidebarSectionProps {
  id: SidebarSectionId;
  disabled: boolean;
}

interface TopLevelSidebarSectionCollapseControl {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

function hasSameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((sectionId, index) => sectionId === right[index]);
}

function removeCollapsedIds<T extends string>(
  current: T[],
  idsToRemove: ReadonlySet<string>,
): T[] {
  if (idsToRemove.size === 0) {
    return current;
  }
  let removed = false;
  const next = current.filter((id) => {
    if (!idsToRemove.has(id)) {
      return true;
    }
    removed = true;
    return false;
  });
  return removed ? next : current;
}

export function getSelectedThreadSidebarExpansion({
  isFolderOrganizationMode,
  isPinned,
  selectedThread,
}: SelectedThreadSidebarExpansionArgs): SelectedThreadSidebarExpansion {
  if (isPinned) {
    return {};
  }

  if (isFolderOrganizationMode) {
    const folderKey = folderKeyForThreadFolder(
      CHRONOLOGICAL_CONTAINER_ID,
      selectedThread.folderId,
    );
    return folderKey ? { folderKey } : { sidebarSectionId: "threads" };
  }

  if (selectedThread.projectId === PERSONAL_PROJECT_ID) {
    return { sidebarSectionId: "threads" };
  }

  return {
    projectId: selectedThread.projectId,
    sidebarSectionId: "projects",
  };
}

function isSidebarSectionId(value: string): value is SidebarSectionId {
  return value === "pinned" || value === "projects" || value === "threads";
}

function isCollapsibleSidebarSectionId(
  value: string,
): value is CollapsibleSidebarSectionId {
  return value === "projects" || value === "threads";
}

function normalizeSidebarSectionOrder(
  order: readonly SidebarSectionId[],
): SidebarSectionId[] {
  const seen = new Set<SidebarSectionId>();
  const normalized: SidebarSectionId[] = [];
  for (const sectionId of order) {
    if (!isSidebarSectionId(sectionId) || seen.has(sectionId)) {
      continue;
    }
    seen.add(sectionId);
    normalized.push(sectionId);
  }
  if (!seen.has("pinned")) {
    seen.add("pinned");
    normalized.unshift("pinned");
  }
  for (const sectionId of DEFAULT_SIDEBAR_SECTION_ORDER) {
    if (seen.has(sectionId)) {
      continue;
    }
    normalized.push(sectionId);
  }
  return normalized;
}

const EMPTY_PROJECT_THREAD_LIST_STATE: ProjectThreadListState = {
  status: "loading",
};

const EMPTY_PROJECTS: readonly ProjectResponse[] = [];
const EMPTY_FOLDER_DEFINITIONS: readonly ThreadFolderResponse[] = [];

function getProjectId(project: ProjectResponse): string {
  return project.id;
}

function getProjectThreadListState({
  status,
  threads,
}: ProjectThreadListStateArgs): ProjectThreadListState {
  switch (status) {
    case "ready":
      return {
        status: "ready",
        threads: threads ?? [],
      };
    case "unavailable":
      return { status: "unavailable" };
    case "loading":
    case undefined:
      return EMPTY_PROJECT_THREAD_LIST_STATE;
  }
}

function toggleCollapsedIdList({
  current,
  id,
}: ToggleCollapsedIdListArgs): string[] {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return Array.from(next);
}

function normalizeCollapsedSidebarSectionIds(
  sectionIds: readonly CollapsibleSidebarSectionId[],
): CollapsibleSidebarSectionId[] {
  const seen = new Set<CollapsibleSidebarSectionId>();
  const normalized: CollapsibleSidebarSectionId[] = [];
  for (const sectionId of sectionIds) {
    if (!isCollapsibleSidebarSectionId(sectionId) || seen.has(sectionId)) {
      continue;
    }
    seen.add(sectionId);
    normalized.push(sectionId);
  }
  return normalized;
}

function compareByTitleAscending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const titleDelta = getThreadDisplayTitle(left).localeCompare(
    getThreadDisplayTitle(right),
  );
  if (titleDelta !== 0) {
    return titleDelta;
  }

  return left.id.localeCompare(right.id);
}

function getProjectThreadItemAlphaLabel(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return getThreadDisplayTitle(item.node.thread);
    case "environment":
      return getThreadDisplayTitle(item.group.nodes[0].thread);
    case "folder":
      return item.group.name;
  }
}

function compareProjectThreadItemsByTitleAscending(
  left: ProjectThreadItem,
  right: ProjectThreadItem,
): number {
  const labelDelta = getProjectThreadItemAlphaLabel(left).localeCompare(
    getProjectThreadItemAlphaLabel(right),
  );
  if (labelDelta !== 0) {
    return labelDelta;
  }

  const kindDelta = left.kind.localeCompare(right.kind);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  return left.kind === "folder" && right.kind === "folder"
    ? left.group.key.localeCompare(right.group.key)
    : 0;
}

function invertNumber(value: number): number {
  return value === 0 ? 0 : -value;
}

function invertThreadComparator(
  compareThreads: ThreadComparator,
): ThreadComparator {
  return (left, right) => {
    const result = compareThreads(left, right);
    return invertNumber(result);
  };
}

export function getSidebarThreadComparator({
  direction,
  sort,
}: {
  direction: SidebarSortDirection;
  sort: SidebarChronologicalSort;
}): ThreadComparator {
  const normalizedSort = sort === "none" ? "updated" : sort;

  if (normalizedSort === "alpha") {
    // Title sort's base is *ascending* (A→Z), unlike the time sorts whose
    // bases descend. So here asc keeps the base and desc inverts it — and the
    // leaf-thread and mixed folder/thread comparators must apply the same
    // direction, or folders and threads would sort in opposite order.
    const comparator: ThreadComparator =
      direction === "asc"
        ? compareByTitleAscending
        : invertThreadComparator(compareByTitleAscending);
    comparator.compareItems =
      direction === "asc"
        ? compareProjectThreadItemsByTitleAscending
        : (left, right) =>
            invertNumber(
              compareProjectThreadItemsByTitleAscending(left, right),
            );
    return comparator;
  }

  // "created"/"updated" bases list newest / most-recently-active first, so desc
  // keeps the base and asc inverts it.
  const baseComparator: ThreadComparator =
    normalizedSort === "created"
      ? compareByCreatedAtDescending
      : compareStandardThreads;
  return direction === "asc"
    ? invertThreadComparator(baseComparator)
    : baseComparator;
}

function ProjectListSectionIconButton({
  ariaLabel,
  disabled = false,
  iconName,
  onClick,
  title,
}: ProjectListSectionIconButtonProps) {
  const handleClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      onClick();
    },
    [onClick],
  );

  const button = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={ariaLabel}
      disabled={disabled}
      className={PROJECT_LIST_SECTION_ACTION_BUTTON_CLASS}
      onClick={handleClick}
    >
      <Icon name={iconName} className={COARSE_POINTER_ICON_SIZE_CLASS} />
    </Button>
  );

  return (
    <Tooltip
      delayDuration={PROJECT_LIST_SECTION_ACTION_TOOLTIP_DELAY_MS}
      disableHoverableContent
    >
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  );
}

function ProjectListProjectsSectionActions({
  isCreatingProject,
  onNewProject,
}: ProjectListProjectsSectionActionsProps) {
  return (
    <ProjectListSectionIconButton
      ariaLabel="New project"
      title="New project"
      disabled={isCreatingProject}
      iconName="FolderPlus"
      onClick={onNewProject}
    />
  );
}

function ProjectListThreadsSectionActions({
  isCreatingFolder,
  onNewFolder,
  onNewThread,
}: ProjectListThreadsSectionActionsProps) {
  return (
    <>
      {onNewFolder ? (
        <ProjectListSectionIconButton
          ariaLabel="New folder"
          title="New folder"
          disabled={isCreatingFolder}
          iconName="FolderPlus"
          onClick={onNewFolder}
        />
      ) : null}
      <ProjectListSectionIconButton
        ariaLabel="New thread"
        title="New thread"
        iconName="MessageSquarePlus"
        onClick={onNewThread}
      />
    </>
  );
}

interface SidebarGroupMenuOptionProps {
  disabled?: boolean;
  label: string;
  selected: boolean;
  onSelect: (event: Event) => void;
}

function SidebarGroupMenuOption({
  disabled = false,
  label,
  selected,
  onSelect,
}: SidebarGroupMenuOptionProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className="flex items-center justify-between gap-3"
    >
      <span className="truncate text-xs">{label}</span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}

interface SidebarSortMenuOptionProps {
  direction: SidebarSortDirection;
  keepOpenOnSelect: boolean;
  label: string;
  selected: boolean;
  sort: SidebarChronologicalSort;
  // Selecting an inactive field activates it descending; selecting the active
  // field flips its direction.
  onToggle: (sort: SidebarChronologicalSort) => void;
}

function SidebarDisplayMenuTrigger({
  ariaLabel,
  iconName,
  tooltip,
}: {
  ariaLabel: string;
  iconName: IconName;
  tooltip: string;
}) {
  return (
    <Tooltip
      delayDuration={PROJECT_LIST_SECTION_ACTION_TOOLTIP_DELAY_MS}
      disableHoverableContent
    >
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            className={cn(
              "rounded-md p-0 text-muted-foreground",
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              LIST_HOVER_TRANSITION,
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon name={iconName} className={COARSE_POINTER_ICON_SIZE_CLASS} />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="px-2 py-1">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarSortMenuOption({
  direction,
  keepOpenOnSelect,
  label,
  selected,
  sort,
  onToggle,
}: SidebarSortMenuOptionProps) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        if (keepOpenOnSelect) {
          event.preventDefault();
        }
        onToggle(sort);
      }}
      className="flex items-center justify-between gap-3"
    >
      <span className="truncate text-xs">{label}</span>
      {/* No sort field shows no glyph; the active field shows a single arrow
          that points down for descending and up for ascending. */}
      <Icon
        name={direction === "asc" ? "ArrowUp" : "ArrowDown"}
        aria-hidden="true"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}

// Shared organization menu rendered on both the Projects and Threads section
// headers. The organization mode is global, so either header's menu drives the
// whole sidebar.
export function SidebarGroupOptionsMenu({
  open,
  onOpenChange,
}: SidebarGroupOptionsMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  const [organizationMode, setOrganizationMode] = useAtom(
    sidebarOrganizationModeAtom,
  );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <SidebarDisplayMenuTrigger
        ariaLabel="Sidebar organize options"
        iconName="Layers"
        tooltip="Organize by"
      />
      <DropdownMenuContent
        align="end"
        mobileTitle="Organize by"
        className="min-w-0"
      >
        <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
          Organize by
        </DropdownMenuLabel>
        <SidebarGroupMenuOption
          label="Projects"
          selected={organizationMode === "project"}
          onSelect={(event) => {
            if (!isCompactViewport || organizationMode === "project") {
              event.preventDefault();
            }
            setOrganizationMode("project");
          }}
        />
        <SidebarGroupMenuOption
          label="Manually"
          selected={organizationMode === "chronological"}
          onSelect={(event) => {
            if (!isCompactViewport || organizationMode === "chronological") {
              event.preventDefault();
            }
            setOrganizationMode("chronological");
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarSortOptionsMenu({
  open,
  onOpenChange,
}: SidebarSortOptionsMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  const [chronologicalSort, setChronologicalSort] = useAtom(
    sidebarChronologicalSortAtom,
  );
  const [sortDirection, setSortDirection] = useAtom(sidebarSortDirectionAtom);
  const selectedSort: SidebarChronologicalSort =
    chronologicalSort === "none" ? "updated" : chronologicalSort;
  const handleSortToggle = useCallback(
    (sort: SidebarChronologicalSort) => {
      if (selectedSort === sort) {
        // Re-selecting the active field flips its direction.
        setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
        return;
      }
      // A newly selected field starts in its natural direction: time sorts show
      // newest first (desc); alphabetical starts A→Z (asc).
      setChronologicalSort(sort);
      setSortDirection(sort === "alpha" ? "asc" : "desc");
    },
    [selectedSort, setChronologicalSort, setSortDirection],
  );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <SidebarDisplayMenuTrigger
        ariaLabel="Sidebar sort options"
        iconName="ArrowUpDown"
        tooltip="Sort"
      />
      <DropdownMenuContent align="end" mobileTitle="Sort" className="min-w-0">
        <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
          Sort by
        </DropdownMenuLabel>
        <SidebarSortMenuOption
          label="Updated at"
          sort="updated"
          selected={selectedSort === "updated"}
          direction={sortDirection}
          keepOpenOnSelect={!isCompactViewport}
          onToggle={handleSortToggle}
        />
        <SidebarSortMenuOption
          label="Created at"
          sort="created"
          selected={selectedSort === "created"}
          direction={sortDirection}
          keepOpenOnSelect={!isCompactViewport}
          onToggle={handleSortToggle}
        />
        <SidebarSortMenuOption
          label="Alphabetical"
          sort="alpha"
          selected={selectedSort === "alpha"}
          direction={sortDirection}
          keepOpenOnSelect={!isCompactViewport}
          onToggle={handleSortToggle}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SidebarDisplayOptionsActionsProps {
  open: SidebarDisplayOptionsMenuKind | null;
  onOpenChange: (menu: SidebarDisplayOptionsMenuKind, open: boolean) => void;
}

// The Group + Sort menu pair shown on the primary section header (Projects in
// project mode, Folders in the folders view). Shared so both headers stay
// identical and changes land in one place instead of being copied per view.
function SidebarDisplayOptionsActions({
  open,
  onOpenChange,
}: SidebarDisplayOptionsActionsProps) {
  return (
    <>
      <SidebarGroupOptionsMenu
        open={open === "group"}
        onOpenChange={(next) => onOpenChange("group", next)}
      />
      <SidebarSortOptionsMenu
        open={open === "sort"}
        onOpenChange={(next) => onOpenChange("sort", next)}
      />
    </>
  );
}

interface SidebarThreadsSectionActionsProps {
  displayOptionsOpen: SidebarDisplayOptionsMenuKind | null;
  onDisplayOptionsOpenChange: (
    menu: SidebarDisplayOptionsMenuKind,
    open: boolean,
  ) => void;
  onOpenArchivedThreads?: () => void;
  isCreatingFolder: boolean;
  onNewThread: () => void;
}

interface SidebarAllThreadsOverflowMenuProps {
  isCreatingFolder: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewFolder: () => void;
  onOpenArchivedThreads: () => void;
}

// The complete Threads-section header cluster (archived menu + sort + new
// thread). One component drives the Threads header in both project mode and the
// folders view, so they can never drift apart. The Threads section is always the
// loose/unfiled set, so it offers sorting but not the Group-by toggle (that
// lives on the primary section header).
function SidebarThreadsSectionActions({
  displayOptionsOpen,
  onDisplayOptionsOpenChange,
  onOpenArchivedThreads,
  isCreatingFolder,
  onNewThread,
}: SidebarThreadsSectionActionsProps) {
  return (
    <>
      {onOpenArchivedThreads ? (
        <ProjectListSectionIconButton
          ariaLabel="Archived threads"
          title="Archived threads"
          iconName="Archive"
          onClick={onOpenArchivedThreads}
        />
      ) : null}
      <SidebarSortOptionsMenu
        open={displayOptionsOpen === "sort"}
        onOpenChange={(next) => onDisplayOptionsOpenChange("sort", next)}
      />
      <ProjectListThreadsSectionActions
        isCreatingFolder={isCreatingFolder}
        onNewThread={onNewThread}
      />
    </>
  );
}

function SidebarAllThreadsOverflowMenu({
  isCreatingFolder,
  open,
  onOpenChange,
  onNewFolder,
  onOpenArchivedThreads,
}: SidebarAllThreadsOverflowMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <SidebarDisplayMenuTrigger
        ariaLabel="All Threads actions"
        iconName="MoreHorizontal"
        tooltip="More actions"
      />
      <DropdownMenuContent
        align="end"
        mobileTitle="All Threads actions"
        className="min-w-0"
      >
        <DropdownMenuItem disabled={isCreatingFolder} onSelect={onNewFolder}>
          <Icon name="FolderPlus" aria-hidden="true" />
          New folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenArchivedThreads}>
          <Icon name="Archive" aria-hidden="true" />
          Archived threads
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectListNavigationLoadingState() {
  return (
    <div
      aria-label="Loading sidebar navigation"
      className="space-y-1.5 px-2 pt-1 group-data-[collapsible=icon]:hidden"
    >
      <ProjectListNavigationLoadingRow textWidthClassName="w-2/3" />
      <ProjectListNavigationLoadingRow textWidthClassName="w-1/2" />
    </div>
  );
}

function ProjectListNavigationLoadingRow({
  textWidthClassName,
}: ProjectListNavigationLoadingRowProps) {
  return (
    <div
      data-sidebar="navigation-loading-row"
      className="flex h-7 items-center gap-2 rounded-md"
    >
      <Skeleton className="size-4 shrink-0 rounded-md bg-sidebar-border/60" />
      <Skeleton
        className={cn(
          "h-3 rounded-sm bg-sidebar-border/50",
          textWidthClassName,
        )}
      />
    </div>
  );
}

export function TopLevelSidebarSection({
  label,
  children,
  actions,
  actionsAlwaysVisible = false,
  actionsMobileAlways = false,
  actionsOpen = false,
  collapseControl,
  dragBindings,
  sectionRef,
  sectionStyle,
  consumeClickSuppression,
}: TopLevelSidebarSectionProps) {
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression],
  );
  const handleCollapseControlClick = useCallback<
    MouseEventHandler<HTMLButtonElement>
  >(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      collapseControl?.onToggleCollapsed();
    },
    [collapseControl],
  );
  const stopActionsClick = useCallback<MouseEventHandler<HTMLSpanElement>>(
    (event) => {
      event.stopPropagation();
    },
    [],
  );
  const stopCollapseControlPointerDown = useCallback<
    PointerEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);
  const stopCollapseControlKeyDown = useCallback<
    KeyboardEventHandler<HTMLButtonElement>
  >((event) => {
    event.stopPropagation();
  }, []);

  return (
    <SidebarStickyGroup
      ref={sectionRef}
      style={sectionStyle}
      className="group/sidebar-section min-w-0"
      onClickCapture={handleClickCapture}
    >
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        tier="label"
        className={cn(
          SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
          CHROME_SECTION_LABEL_CLASS,
          // Align the label with the sidebar's standard content inset so the
          // header text sits in the same column as the rows below it, rather
          // than hanging left on the narrower inherited group-label padding.
          SIDEBAR_STANDARD_ROW_PADDING_CLASS,
          "rounded-md pr-1 transition-colors",
          dragBindings && !dragBindings.disabled && "select-none",
        )}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
      >
        <span
          className={cn(
            "relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left",
            actions && "pr-[7.5rem] max-md:pointer-coarse:pr-[9.75rem]",
          )}
        >
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          {/* Reserve room for the compact section action cluster on the right;
              coarse pointers need a little more. */}
          {collapseControl ? (
            <button
              type="button"
              aria-expanded={!collapseControl.isCollapsed}
              data-sidebar-hover-actions-mobile={
                SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
              }
              aria-label={
                collapseControl.isCollapsed
                  ? `Expand ${label} section`
                  : `Collapse ${label} section`
              }
              className={cn(
                !collapseControl.isCollapsed && SIDEBAR_HOVER_ACTIONS_CLASS,
                "relative z-20 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
                LIST_HOVER_TRANSITION,
              )}
              onClick={handleCollapseControlClick}
              onPointerDown={stopCollapseControlPointerDown}
              onKeyDown={stopCollapseControlKeyDown}
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-3 transition-transform duration-150",
                  !collapseControl.isCollapsed && "rotate-90",
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
        {actions ? (
          <span
            className="absolute right-0 top-1/2 z-20 inline-flex -translate-y-1/2 items-center"
            onClick={stopActionsClick}
          >
            <span
              data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
              data-sidebar-hover-actions-mobile={
                actionsMobileAlways
                  ? SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
                  : undefined
              }
              className={cn(
                "inline-flex shrink-0 items-center",
                SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
                !actionsAlwaysVisible && SIDEBAR_HOVER_ACTIONS_CLASS,
              )}
            >
              {actions}
            </span>
          </span>
        ) : null}
      </SidebarStickyTier>
      {collapseControl?.isCollapsed ? null : (
        <div className="mt-1">{children}</div>
      )}
    </SidebarStickyGroup>
  );
}

const SortableSidebarSection = memo(function SortableSidebarSection({
  id,
  disabled,
  ...props
}: SortableSidebarSectionProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id,
    disabled,
  });

  return (
    <TopLevelSidebarSection
      {...props}
      dragBindings={dragBindings}
      sectionRef={setNodeRef}
      sectionStyle={style}
    />
  );
});

export function ProjectListActionButtons({
  onNewChat,
  threadSearch,
}: ProjectListActionButtonsProps) {
  const isNewChatDisabled = !onNewChat;
  const threadSearchShortcut = getSidebarThreadSearchShortcutLabel();
  // One click on the X fully dismisses search — it clears the query and closes
  // the input in a single step (onClose resets the query too). Previously this
  // was a two-step clear-then-close, which felt like the X "needed two presses".
  const handleSearchClose = useCallback(() => {
    threadSearch?.onClose();
  }, [threadSearch]);

  return (
    <div className="space-y-1">
      {threadSearch?.isActive ? (
        <div className={PROJECT_LIST_SEARCH_INPUT_ROW_CLASS}>
          <span className={SIDEBAR_LEADING_GLYPH_SLOT_CLASS}>
            <Icon
              name="Search"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
              aria-hidden="true"
            />
          </span>
          <input
            ref={threadSearch.inputRef}
            value={threadSearch.query}
            role="combobox"
            aria-label="Search threads"
            aria-autocomplete="list"
            aria-activedescendant={threadSearch.activeDescendantId}
            aria-controls={SIDEBAR_THREAD_SEARCH_LISTBOX_ID}
            aria-expanded="true"
            placeholder="Search threads"
            className={PROJECT_LIST_SEARCH_INPUT_CLASS}
            onChange={(event) =>
              threadSearch.onQueryChange(event.currentTarget.value)
            }
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={
              threadSearch.query.trim()
                ? "Clear and close search"
                : "Close search"
            }
            className={PROJECT_LIST_SEARCH_CLOSE_BUTTON_CLASS}
            onClick={handleSearchClose}
          >
            <Icon name="X" className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS} />
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "flex-1")}
            onClick={onNewChat}
            disabled={isNewChatDisabled}
          >
            <Icon name="MessageSquarePlus" />
            <span className="min-w-0 flex-1 truncate text-left">
              New thread
            </span>
          </Button>
          {threadSearch ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Search threads (${threadSearchShortcut})`}
              className={PROJECT_LIST_ACTION_ICON_BUTTON_CLASS}
              onClick={threadSearch.onActivate}
            >
              <Icon name="Search" className={COARSE_POINTER_ICON_SIZE_CLASS} />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ProjectListShell({ children }: ProjectListShellProps) {
  return (
    <SidebarStickyStack data-sidebar-sticky-density="compact-actions">
      <SidebarGroupContent>{children}</SidebarGroupContent>
    </SidebarStickyStack>
  );
}

function ProjectListComponent({
  onNewProject,
  onProjectSelect,
  isCreatingProject = false,
  threadSearch,
}: ProjectListProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const sidebarNavigationQuery = useSidebarNavigation();
  const sidebarNavigation = sidebarNavigationQuery.data;
  const folders = sidebarNavigation?.folders ?? EMPTY_FOLDER_DEFINITIONS;
  const projects = useMemo(
    () => sidebarNavigation?.projects.map(stripProjectThreads),
    [sidebarNavigation],
  );
  const threads = useMemo(() => {
    if (!sidebarNavigation) {
      return [];
    }
    const sidebarThreads: ThreadListEntry[] = [];
    for (const project of sidebarNavigation.projects) {
      sidebarThreads.push(...project.threads);
    }
    sidebarThreads.push(...sidebarNavigation.personalProject.threads);
    return sidebarThreads;
  }, [sidebarNavigation]);
  const projectNamesById = useMemo(() => {
    const namesById = new Map<string, string>();
    if (!sidebarNavigation) {
      return namesById;
    }
    for (const project of sidebarNavigation.projects) {
      namesById.set(project.id, project.name);
    }
    namesById.set(PERSONAL_PROJECT_ID, sidebarNavigation.personalProject.name);
    return namesById;
  }, [sidebarNavigation]);
  const folderNamesById = useMemo(() => {
    const namesById = new Map<string, string>();
    for (const folder of folders) {
      namesById.set(folder.id, folder.name);
    }
    return namesById;
  }, [folders]);
  const threadById = useMemo(() => {
    const map = new Map<string, ThreadListEntry>();
    for (const thread of threads) {
      map.set(thread.id, thread);
    }
    return map;
  }, [threads]);
  const projectsState = useConnectionAwareQueryState({
    hasResolvedData: projects !== undefined,
    isFetching: sidebarNavigationQuery.isFetching,
    isLoadingError: sidebarNavigationQuery.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(
      sidebarNavigationQuery.error,
    ),
  });
  const primaryHost = usePrimaryHost();
  const workHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const { threadId: selectedThreadId } = useRouteState();

  const localSourceTargets = useMemo(() => {
    if (!workHostId || !projects) return [];
    const targets: LocalSourcePathTarget[] = [];
    for (const project of projects) {
      const source = findLocalPathProjectSourceForHost(
        project.sources,
        workHostId,
      );
      if (source) {
        targets.push({
          path: source.path,
          projectId: project.id,
        });
      }
    }
    return targets;
  }, [workHostId, projects]);

  const localSourcePathsByProjectId = useMemo(() => {
    const pathsByProjectId = new Map<string, string>();
    for (const target of localSourceTargets) {
      pathsByProjectId.set(target.projectId, target.path);
    }
    return pathsByProjectId;
  }, [localSourceTargets]);

  const localPaths = useMemo(() => {
    if (!workHostId) return [];
    return localSourceTargets.map((target) => target.path);
  }, [workHostId, localSourceTargets]);
  const pathExistence = useHostPathExistence(workHostId, localPaths);
  const { isPending: isProjectReorderPending, mutate: reorderProjectMutate } =
    useReorderProject();
  const {
    isPending: isPinnedReorderPending,
    mutate: reorderPinnedThreadMutate,
  } = useReorderPinnedThread();
  const {
    isPending: isCreateThreadFolderPending,
    mutate: createThreadFolderMutate,
  } = useCreateThreadFolder();
  const {
    isPending: isUpdateThreadFolderPending,
    mutate: updateThreadFolderMutate,
  } = useUpdateThreadFolder();
  const {
    isPending: isDeleteThreadFolderPending,
    mutate: deleteThreadFolderMutate,
  } = useDeleteThreadFolder();
  const projectItems = projects ?? EMPTY_PROJECTS;
  const handleReorderProject = useCallback<
    UseNeighborReorderSortableArgs<ProjectResponse>["onReorder"]
  >(
    (request, callbacks) => {
      reorderProjectMutate(
        {
          projectId: request.itemId,
          previousProjectId: request.previousItemId,
          nextProjectId: request.nextItemId,
        },
        {
          onSettled: callbacks.onSettled,
        },
      );
    },
    [reorderProjectMutate],
  );
  const projectReorderDisabled =
    isProjectReorderPending || projectItems.length < 2;
  const {
    handleDragEnd: handleSortableProjectDragEnd,
    itemIds: renderedProjectIds,
    renderedItems: renderedProjects,
  } = useNeighborReorderSortable({
    disabled: projectReorderDisabled,
    getId: getProjectId,
    items: projectItems,
    onReorder: handleReorderProject,
  });
  const {
    dndContextProps: projectDndContextProps,
    consumeClickSuppression: consumeProjectClickSuppression,
  } = useSidebarReorderDnd({ onDragEnd: handleSortableProjectDragEnd });
  const handleReorderPinnedRoot = useCallback<
    NonNullable<PinnedThreadTreeProps["onReorderPinnedRoot"]>
  >(
    (request, callbacks) => {
      reorderPinnedThreadMutate(
        {
          id: request.itemId,
          previousThreadId: request.previousItemId,
          nextThreadId: request.nextItemId,
        },
        {
          onSettled: callbacks.onSettled,
        },
      );
    },
    [reorderPinnedThreadMutate],
  );
  const openRootComposeForProject = useCallback(
    (projectId: string, folderId?: string) => {
      setRootComposeProjectId(projectId);
      onProjectSelect?.();
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          ...(folderId ? { folderId } : {}),
        },
      });
    },
    [navigate, onProjectSelect, setRootComposeProjectId],
  );
  const handleCreateProjectThread = useCallback(
    (projectId: string) => {
      openRootComposeForProject(projectId);
    },
    [openRootComposeForProject],
  );
  const handleCreateProjectlessThread = useCallback(() => {
    openRootComposeForProject(PERSONAL_PROJECT_ID);
  }, [openRootComposeForProject]);
  const handleCreateThreadInFolder = useCallback(
    (folderId: string) => {
      openRootComposeForProject(PERSONAL_PROJECT_ID, folderId);
    },
    [openRootComposeForProject],
  );
  const handleViewArchivedThreadsInFolder = useCallback(
    (folderId: string) => {
      onProjectSelect?.();
      navigate(getFolderArchivedRoutePath(folderId));
    },
    [navigate, onProjectSelect],
  );
  const [isFolderCreateDialogOpen, setIsFolderCreateDialogOpen] =
    useState(false);
  const [folderCreateErrorMessage, setFolderCreateErrorMessage] = useState<
    string | null
  >(null);
  const [folderRenameErrorMessage, setFolderRenameErrorMessage] = useState<
    string | null
  >(null);
  const folderRenameDialog = useDialogState<ThreadFolderRenameDialogTarget>();
  const folderDeleteDialog = useDialogState<SidebarFolderDefinition>();
  const handleOpenCreateFolderDialog = useCallback(() => {
    setFolderCreateErrorMessage(null);
    setIsFolderCreateDialogOpen(true);
  }, []);
  const handleCreateFolderDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setFolderCreateErrorMessage(null);
      setIsFolderCreateDialogOpen(false);
    }
  }, []);
  const handleCreateThreadFolder = useCallback(
    (name: string) => {
      setFolderCreateErrorMessage(null);
      createThreadFolderMutate(
        { name },
        {
          onSuccess: () => setIsFolderCreateDialogOpen(false),
          onError: (error) =>
            setFolderCreateErrorMessage(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to create folder.",
              }),
            ),
        },
      );
    },
    [createThreadFolderMutate],
  );
  const handleOpenRenameThreadFolder = useCallback(
    (folder: SidebarFolderDefinition) => {
      setFolderRenameErrorMessage(null);
      folderRenameDialog.onOpen({ id: folder.id, name: folder.name });
    },
    [folderRenameDialog],
  );
  const handleRenameThreadFolder = useCallback(
    (id: string, name: string) => {
      setFolderRenameErrorMessage(null);
      updateThreadFolderMutate(
        { id, name },
        {
          onSuccess: () => folderRenameDialog.onClose(),
          onError: (error) =>
            setFolderRenameErrorMessage(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to rename folder.",
              }),
            ),
        },
      );
    },
    [folderRenameDialog, updateThreadFolderMutate],
  );
  const handleRemoveThreadFolder = useCallback(
    (folder: SidebarFolderDefinition) => {
      folderDeleteDialog.onOpen(folder);
    },
    [folderDeleteDialog],
  );
  const handleConfirmRemoveThreadFolder = useCallback(() => {
    const folder = folderDeleteDialog.target;
    if (!folder) {
      return;
    }
    deleteThreadFolderMutate(
      { id: folder.id },
      { onSuccess: () => folderDeleteDialog.onClose() },
    );
  }, [deleteThreadFolderMutate, folderDeleteDialog]);
  const handleFolderDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        return;
      }
      folderDeleteDialog.onClose();
    },
    [folderDeleteDialog],
  );
  const handleRenameThreadFolderOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setFolderRenameErrorMessage(null);
      }
      folderRenameDialog.onOpenChange(open);
    },
    [folderRenameDialog],
  );
  const handleOpenProjectlessArchivedThreads = useCallback(() => {
    onProjectSelect?.();
    navigate(getProjectlessArchivedRoutePath());
  }, [navigate, onProjectSelect]);
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [collapsedEnvironmentIdList, setCollapsedEnvironmentIdList] = useAtom(
    collapsedEnvironmentIdsAtom,
  );
  const [collapsedSidebarSectionIdList, setCollapsedSidebarSectionIdList] =
    useAtom(collapsedSidebarSectionIdsAtom);
  const [sidebarSectionOrderList, setSidebarSectionOrderList] = useAtom(
    sidebarSectionOrderAtom,
  );
  const [projectsDisplayOptionsMenuOpen, setProjectsDisplayOptionsMenuOpen] =
    useState<SidebarDisplayOptionsMenuKind | null>(null);
  const [threadsDisplayOptionsMenuOpen, setThreadsDisplayOptionsMenuOpen] =
    useState<SidebarDisplayOptionsMenuKind | null>(null);
  const [allThreadsOverflowMenuOpen, setAllThreadsOverflowMenuOpen] =
    useState(false);
  const handleProjectsDisplayOptionsMenuOpenChange = useCallback(
    (menu: SidebarDisplayOptionsMenuKind, open: boolean) => {
      setProjectsDisplayOptionsMenuOpen(open ? menu : null);
      if (open) {
        setThreadsDisplayOptionsMenuOpen(null);
        setAllThreadsOverflowMenuOpen(false);
      }
    },
    [],
  );
  const handleThreadsDisplayOptionsMenuOpenChange = useCallback(
    (menu: SidebarDisplayOptionsMenuKind, open: boolean) => {
      setThreadsDisplayOptionsMenuOpen(open ? menu : null);
      if (open) {
        setProjectsDisplayOptionsMenuOpen(null);
        setAllThreadsOverflowMenuOpen(false);
      }
    },
    [],
  );
  const handleAllThreadsOverflowMenuOpenChange = useCallback(
    (open: boolean) => {
      setAllThreadsOverflowMenuOpen(open);
      if (open) {
        setProjectsDisplayOptionsMenuOpen(null);
        setThreadsDisplayOptionsMenuOpen(null);
      }
    },
    [],
  );
  const [organizationMode] = useAtom(sidebarOrganizationModeAtom);
  const [chronologicalSort, setChronologicalSort] = useAtom(
    sidebarChronologicalSortAtom,
  );
  const [sortDirection] = useAtom(sidebarSortDirectionAtom);
  const isFolderOrganizationMode = organizationMode === "chronological";
  const [, setCollapsedFolderList] = useAtom(sidebarCollapsedFoldersAtom);
  const sidebarThreadComparator = useMemo<ThreadComparator>(
    () =>
      getSidebarThreadComparator({
        direction: sortDirection,
        sort: chronologicalSort,
      }),
    [chronologicalSort, sortDirection],
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const collapsedEnvironmentIds = useMemo(
    () => new Set(collapsedEnvironmentIdList),
    [collapsedEnvironmentIdList],
  );
  const sidebarSectionOrder = useMemo(
    () => normalizeSidebarSectionOrder(sidebarSectionOrderList),
    [sidebarSectionOrderList],
  );
  const normalizedCollapsedSidebarSectionIds = useMemo(
    () => normalizeCollapsedSidebarSectionIds(collapsedSidebarSectionIdList),
    [collapsedSidebarSectionIdList],
  );
  const collapsedSidebarSectionIds = useMemo(
    () => new Set(normalizedCollapsedSidebarSectionIds),
    [normalizedCollapsedSidebarSectionIds],
  );
  useEffect(() => {
    if (hasSameStringList(sidebarSectionOrderList, sidebarSectionOrder)) {
      return;
    }
    setSidebarSectionOrderList(sidebarSectionOrder);
  }, [
    setSidebarSectionOrderList,
    sidebarSectionOrder,
    sidebarSectionOrderList,
  ]);
  useEffect(() => {
    if (
      hasSameStringList(
        collapsedSidebarSectionIdList,
        normalizedCollapsedSidebarSectionIds,
      )
    ) {
      return;
    }
    setCollapsedSidebarSectionIdList(normalizedCollapsedSidebarSectionIds);
  }, [
    collapsedSidebarSectionIdList,
    normalizedCollapsedSidebarSectionIds,
    setCollapsedSidebarSectionIdList,
  ]);
  useEffect(() => {
    if (chronologicalSort === "none") {
      setChronologicalSort("updated");
    }
  }, [chronologicalSort, setChronologicalSort]);
  const pinnedSidebarState = useMemo(
    () => buildPinnedSidebarState({ threads }),
    [threads],
  );
  const hasPinnedSection = pinnedSidebarState.rootNodes.length > 0;
  const visibleSidebarSectionOrder = useMemo(
    () =>
      sidebarSectionOrder.filter((sectionId) => {
        if (sectionId === "pinned") return hasPinnedSection;
        return true;
      }),
    [hasPinnedSection, sidebarSectionOrder],
  );
  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    const selectedThread = threadById.get(selectedThreadId);
    if (!selectedThread) {
      return;
    }
    if (
      (selectedThread.originKind ?? selectedThread.childOrigin) === "side-chat"
    ) {
      return;
    }

    const threadIdsToExpand = new Set<string>();
    const environmentIdsToExpand = new Set<string>();
    let currentThread: ThreadListEntry | undefined = selectedThread;
    let remainingHops = threadById.size;
    while (currentThread && remainingHops > 0) {
      if (currentThread.environmentId !== null) {
        environmentIdsToExpand.add(currentThread.environmentId);
      }
      const parentThreadId = currentThread.parentThreadId;
      if (parentThreadId === null) {
        break;
      }
      const parentThread = threadById.get(parentThreadId);
      if (!parentThread) {
        break;
      }
      threadIdsToExpand.add(parentThread.id);
      currentThread = parentThread;
      remainingHops -= 1;
    }

    setCollapsedThreadIdList((current) =>
      removeCollapsedIds(current, threadIdsToExpand),
    );
    setCollapsedEnvironmentIdList((current) =>
      removeCollapsedIds(current, environmentIdsToExpand),
    );

    const isPinned =
      pinnedSidebarState.effectivePinnedThreadIds.has(selectedThreadId);
    const expansion = getSelectedThreadSidebarExpansion({
      isFolderOrganizationMode,
      isPinned,
      selectedThread,
    });
    if (expansion.folderKey) {
      const folderKey = expansion.folderKey;
      setCollapsedFolderList((current) =>
        removeCollapsedIds(current, new Set([folderKey])),
      );
    }
    if (expansion.projectId) {
      const projectId = expansion.projectId;
      setCollapsedProjectIdList((current) =>
        removeCollapsedIds(current, new Set([projectId])),
      );
    }
    if (expansion.sidebarSectionId) {
      const sidebarSectionId = expansion.sidebarSectionId;
      setCollapsedSidebarSectionIdList((current) =>
        removeCollapsedIds(current, new Set([sidebarSectionId])),
      );
    }
  }, [
    isFolderOrganizationMode,
    pinnedSidebarState.effectivePinnedThreadIds,
    selectedThreadId,
    setCollapsedEnvironmentIdList,
    setCollapsedFolderList,
    setCollapsedProjectIdList,
    setCollapsedSidebarSectionIdList,
    setCollapsedThreadIdList,
    threadById,
  ]);
  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, ThreadListEntry[]>();

    for (const thread of threads) {
      if (pinnedSidebarState.effectivePinnedThreadIds.has(thread.id)) {
        continue;
      }
      const existing = grouped.get(thread.projectId);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(thread.projectId, [thread]);
      }
    }

    return grouped;
  }, [pinnedSidebarState.effectivePinnedThreadIds, threads]);

  // Pre-build per-project list state once per inputs so each ProjectRow can
  // bail out of memo when none of its data changed.
  const threadListStatesByProjectId = useMemo(() => {
    const map = new Map<string, ProjectThreadListState>();
    for (const project of renderedProjects) {
      const projectThreads = threadsByProject.get(project.id);
      map.set(
        project.id,
        getProjectThreadListState({
          status: projectsState.status,
          threads: projectThreads,
        }),
      );
    }
    return map;
  }, [projectsState.status, renderedProjects, threadsByProject]);

  const projectRows = useMemo<ProjectListRowModel[]>(
    () =>
      renderedProjects.map((project) => ({
        project,
        threadListState:
          threadListStatesByProjectId.get(project.id) ??
          EMPTY_PROJECT_THREAD_LIST_STATE,
        isActive: false,
        isLocalPathInvalid: isHostPathMissing(
          pathExistence,
          localSourcePathsByProjectId.get(project.id),
        ),
      })),
    [
      localSourcePathsByProjectId,
      pathExistence,
      renderedProjects,
      threadListStatesByProjectId,
    ],
  );

  const projectReorder = useMemo<ProjectListReorderBindings>(
    () => ({
      dndContextProps: projectDndContextProps,
      itemIds: renderedProjectIds,
      disabled: projectReorderDisabled,
      consumeClickSuppression: consumeProjectClickSuppression,
    }),
    [
      consumeProjectClickSuppression,
      projectDndContextProps,
      projectReorderDisabled,
      renderedProjectIds,
    ],
  );

  const toggleProjectCollapsed = useCallback<ToggleCollapsedId>(
    (projectId) => {
      setCollapsedProjectIdList((current) => {
        return toggleCollapsedIdList({ current, id: projectId });
      });
    },
    [setCollapsedProjectIdList],
  );

  const toggleThreadCollapsed = useCallback<ToggleCollapsedId>(
    (threadId) => {
      setCollapsedThreadIdList((current) => {
        return toggleCollapsedIdList({ current, id: threadId });
      });
    },
    [setCollapsedThreadIdList],
  );

  const toggleEnvironmentCollapsed = useCallback<ToggleCollapsedId>(
    (environmentId) => {
      setCollapsedEnvironmentIdList((current) => {
        return toggleCollapsedIdList({ current, id: environmentId });
      });
    },
    [setCollapsedEnvironmentIdList],
  );

  const toggleSidebarSectionCollapsed =
    useCallback<ToggleCollapsedSidebarSectionId>(
      (sectionId) => {
        setCollapsedSidebarSectionIdList((current) => {
          return toggleCollapsedIdList({ current, id: sectionId }).filter(
            isCollapsibleSidebarSectionId,
          );
        });
      },
      [setCollapsedSidebarSectionIdList],
    );

  const handleReorderSidebarSection = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string" ||
        !isSidebarSectionId(active.id) ||
        !isSidebarSectionId(over.id)
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: visibleSidebarSectionOrder.map((id) => ({ id })),
      });
      if (!request) {
        return;
      }
      const nextOrder = applyNeighborReorder({
        items: visibleSidebarSectionOrder.map((id) => ({ id })),
        request,
      });
      setSidebarSectionOrderList(
        nextOrder.map((item) => item.id).filter(isSidebarSectionId),
      );
    },
    [setSidebarSectionOrderList, visibleSidebarSectionOrder],
  );
  const {
    dndContextProps: sidebarSectionDndContextProps,
    consumeClickSuppression: consumeSidebarSectionClickSuppression,
  } = useSidebarReorderDnd({ onDragEnd: handleReorderSidebarSection });

  const projectlessThreadListState = getProjectThreadListState({
    status: projectsState.status,
    threads: threadsByProject.get(PERSONAL_PROJECT_ID),
  });

  // Folders mode flattens every non-pinned thread across projects into one
  // folder-aware bucket. Pinned threads and descendants stay in Pinned,
  // matching how project mode excludes them.
  const nonPinnedThreads = useMemo(
    () =>
      threads.filter(
        (thread) => !pinnedSidebarState.effectivePinnedThreadIds.has(thread.id),
      ),
    [pinnedSidebarState.effectivePinnedThreadIds, threads],
  );
  const allThreadsListState = getProjectThreadListState({
    status: projectsState.status,
    threads: nonPinnedThreads,
  });

  const pinnedSectionContent = (
    <PinnedThreadTree
      rootNodes={pinnedSidebarState.rootNodes}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      isPinnedReorderPending={isPinnedReorderPending}
      onReorderPinnedRoot={handleReorderPinnedRoot}
    />
  );
  const projectsSectionContent = (
    <ProjectListProjects
      status={projectsState.status}
      rows={projectRows}
      selectedThreadId={selectedThreadId}
      collapsedProjectIds={collapsedProjectIds}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      compareThreads={sidebarThreadComparator}
      onProjectSelect={onProjectSelect}
      onCreateProjectThread={handleCreateProjectThread}
      onToggleProjectCollapsed={toggleProjectCollapsed}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      reorder={projectReorder}
    />
  );
  const threadsSectionContent = (
    <ProjectThreadTree
      projectId={PERSONAL_PROJECT_ID}
      threadListState={projectlessThreadListState}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      compareThreads={sidebarThreadComparator}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
    />
  );
  // The "primary" section (Projects in project mode, Folders in the folders
  // view) and the Threads section each own one display-options menu state, so
  // both can be open independently — and never both at once across sections.
  const projectsSectionActions = (
    <>
      <SidebarDisplayOptionsActions
        open={projectsDisplayOptionsMenuOpen}
        onOpenChange={handleProjectsDisplayOptionsMenuOpenChange}
      />
      {onNewProject ? (
        <ProjectListProjectsSectionActions
          onNewProject={onNewProject}
          isCreatingProject={isCreatingProject}
        />
      ) : null}
    </>
  );
  const folderSectionActions = (
    <>
      <SidebarDisplayOptionsActions
        open={projectsDisplayOptionsMenuOpen}
        onOpenChange={handleProjectsDisplayOptionsMenuOpenChange}
      />
      <ProjectListSectionIconButton
        ariaLabel="New folder"
        title="New folder"
        disabled={isCreateThreadFolderPending}
        iconName="FolderPlus"
        onClick={handleOpenCreateFolderDialog}
      />
    </>
  );
  const allThreadsSectionActions = (
    <>
      <SidebarDisplayOptionsActions
        open={projectsDisplayOptionsMenuOpen}
        onOpenChange={handleProjectsDisplayOptionsMenuOpenChange}
      />
      <SidebarAllThreadsOverflowMenu
        isCreatingFolder={isCreateThreadFolderPending}
        open={allThreadsOverflowMenuOpen}
        onOpenChange={handleAllThreadsOverflowMenuOpenChange}
        onNewFolder={handleOpenCreateFolderDialog}
        onOpenArchivedThreads={handleOpenProjectlessArchivedThreads}
      />
      <ProjectListThreadsSectionActions
        isCreatingFolder={isCreateThreadFolderPending}
        onNewThread={handleCreateProjectlessThread}
      />
    </>
  );
  // One Threads-header cluster shared by project mode and the folders view.
  const threadsSectionActions = (
    <SidebarThreadsSectionActions
      displayOptionsOpen={threadsDisplayOptionsMenuOpen}
      onDisplayOptionsOpenChange={handleThreadsDisplayOptionsMenuOpenChange}
      onOpenArchivedThreads={handleOpenProjectlessArchivedThreads}
      isCreatingFolder={isCreateThreadFolderPending}
      onNewThread={handleCreateProjectlessThread}
    />
  );
  const folderModeSectionsContent = (
    <ChronologicalFolderThreadSections
      threadListState={allThreadsListState}
      compareThreads={sidebarThreadComparator}
      folders={folders}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={onProjectSelect}
      onCreateThreadInFolder={handleCreateThreadInFolder}
      onViewArchivedThreadsInFolder={handleViewArchivedThreadsInFolder}
      onRenameFolder={handleOpenRenameThreadFolder}
      onRemoveFolder={handleRemoveThreadFolder}
      onToggleThreadCollapsed={toggleThreadCollapsed}
      onToggleEnvironmentCollapsed={toggleEnvironmentCollapsed}
      renderAllThreadsSection={(content) => (
        <TopLevelSidebarSection
          label="All Threads"
          actions={allThreadsSectionActions}
          actionsOpen={
            projectsDisplayOptionsMenuOpen !== null ||
            allThreadsOverflowMenuOpen
          }
          actionsMobileAlways
          collapseControl={{
            isCollapsed: collapsedSidebarSectionIds.has("threads"),
            onToggleCollapsed: () => toggleSidebarSectionCollapsed("threads"),
          }}
        >
          {content}
        </TopLevelSidebarSection>
      )}
      renderFoldersSection={(content) => (
        <TopLevelSidebarSection
          label="Folders"
          actions={folderSectionActions}
          actionsOpen={projectsDisplayOptionsMenuOpen !== null}
          actionsMobileAlways
        >
          {content}
        </TopLevelSidebarSection>
      )}
      renderThreadsSection={(content) => (
        <TopLevelSidebarSection
          label="Threads"
          actions={threadsSectionActions}
          actionsOpen={threadsDisplayOptionsMenuOpen !== null}
          actionsMobileAlways
          collapseControl={{
            isCollapsed: collapsedSidebarSectionIds.has("threads"),
            onToggleCollapsed: () => toggleSidebarSectionCollapsed("threads"),
          }}
        >
          {content}
        </TopLevelSidebarSection>
      )}
    />
  );
  const folderCreateDialog = (
    <ThreadFolderCreateDialog
      errorMessage={folderCreateErrorMessage}
      open={isFolderCreateDialogOpen}
      pending={isCreateThreadFolderPending}
      onOpenChange={handleCreateFolderDialogOpenChange}
      onCreate={handleCreateThreadFolder}
    />
  );
  const folderRenameDialogContent = (
    <ThreadFolderRenameDialog
      errorMessage={folderRenameErrorMessage}
      target={folderRenameDialog.target}
      pending={isUpdateThreadFolderPending}
      onOpenChange={handleRenameThreadFolderOpenChange}
      onRename={handleRenameThreadFolder}
    />
  );
  const folderDeleteDialogContent = (
    <ConfirmDeleteDialog
      open={folderDeleteDialog.target !== null}
      onOpenChange={handleFolderDeleteDialogOpenChange}
    >
      {folderDeleteDialog.target ? (
        <ConfirmDeleteDialogContent
          title="Remove folder?"
          description="Threads in this folder will move to the Threads section."
          confirmLabel="Remove folder"
          pending={isDeleteThreadFolderPending}
          onConfirm={handleConfirmRemoveThreadFolder}
          onCancel={folderDeleteDialog.onClose}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );

  if (threadSearch?.isActive) {
    return (
      <ProjectListShell>
        <SidebarThreadSearchPanel
          activeIndex={threadSearch.activeIndex}
          isRecentsLoading={projectsState.status === "loading"}
          onActiveIndexChange={threadSearch.onActiveIndexChange}
          onNavigationItemsChange={threadSearch.onNavigationItemsChange}
          onSelect={threadSearch.onSelectItem}
          folderNamesById={folderNamesById}
          projectNamesById={projectNamesById}
          query={threadSearch.query}
          recentThreads={threads}
          showFolderLabels={isFolderOrganizationMode}
        />
      </ProjectListShell>
    );
  }

  if (projectsState.status === "loading") {
    return (
      <ProjectListShell>
        <ProjectListNavigationLoadingState />
      </ProjectListShell>
    );
  }

  if (isFolderOrganizationMode) {
    return (
      <ProjectListShell>
        <div className="space-y-4">
          {hasPinnedSection ? (
            <TopLevelSidebarSection label="Pinned">
              {pinnedSectionContent}
            </TopLevelSidebarSection>
          ) : null}
          {folderModeSectionsContent}
        </div>
        {folderCreateDialog}
        {folderRenameDialogContent}
        {folderDeleteDialogContent}
      </ProjectListShell>
    );
  }

  return (
    <ProjectListShell>
      <DndContext {...sidebarSectionDndContextProps}>
        <SortableContext
          items={visibleSidebarSectionOrder}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {visibleSidebarSectionOrder.map((sectionId) =>
              sectionId === "pinned" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Pinned"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {pinnedSectionContent}
                </SortableSidebarSection>
              ) : sectionId === "projects" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Projects"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  actions={projectsSectionActions}
                  actionsOpen={projectsDisplayOptionsMenuOpen !== null}
                  actionsMobileAlways
                  collapseControl={{
                    isCollapsed: collapsedSidebarSectionIds.has("projects"),
                    onToggleCollapsed: () =>
                      toggleSidebarSectionCollapsed("projects"),
                  }}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {projectsSectionContent}
                </SortableSidebarSection>
              ) : sectionId === "threads" ? (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  label="Threads"
                  disabled={visibleSidebarSectionOrder.length < 2}
                  actions={threadsSectionActions}
                  actionsOpen={threadsDisplayOptionsMenuOpen !== null}
                  actionsMobileAlways
                  collapseControl={{
                    isCollapsed: collapsedSidebarSectionIds.has("threads"),
                    onToggleCollapsed: () =>
                      toggleSidebarSectionCollapsed("threads"),
                  }}
                  consumeClickSuppression={
                    consumeSidebarSectionClickSuppression
                  }
                >
                  {threadsSectionContent}
                </SortableSidebarSection>
              ) : null,
            )}
          </div>
        </SortableContext>
      </DndContext>
      {folderCreateDialog}
      {folderRenameDialogContent}
      {folderDeleteDialogContent}
    </ProjectListShell>
  );
}

export const ProjectList = memo(ProjectListComponent);
