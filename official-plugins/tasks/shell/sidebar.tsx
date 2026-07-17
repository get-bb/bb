import { useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Folder,
  Preset,
  Project,
  SidebarProjectSummary,
  Task,
} from "../shared/contract.js";
import { useTasksRpc } from "./data.js";
import type { TasksRoute } from "./routes.js";
import {
  PresetDialog,
  savePresetDraft,
} from "../views/manage/preset-dialog.js";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";

const SIDEBAR_WIDTH_KEY = "bb-tasks:sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 208; // matches the old fixed w-52
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 340;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function loadSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampSidebarWidth(stored)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function storeSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Persistence is best-effort (e.g. sandboxed iframes without storage).
  }
}

interface SidebarRowProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}

function SidebarRow({ active, onClick, children, title }: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-9",
        onClick ? "cursor-pointer" : "cursor-default",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground",
        onClick && !active && "hover:bg-state-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const content = (
    <>
      {onToggle ? (
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      ) : null}
      {label}
    </>
  );
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="mt-3.5 flex w-full items-center gap-1 rounded-md px-2 pb-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="mt-3.5 flex items-center gap-1 px-2 pb-1 text-xs font-semibold text-muted-foreground">
      {content}
    </div>
  );
}

function ProjectDot({ color }: { color: string }) {
  // Project colors are user data, not theme tokens, so an inline style is the
  // only way to render them.
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}

function WorkingDot() {
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
    />
  );
}

function RowCount({ value }: { value: number }) {
  return (
    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}

function ProjectRow({
  project,
  summary,
  active,
  onClick,
}: {
  project: Project;
  summary: SidebarProjectSummary | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarRow active={active} onClick={onClick} title={project.name}>
      <ProjectDot color={project.color} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {summary && summary.activeAgentCount > 0 ? <WorkingDot /> : null}
      {summary ? <RowCount value={summary.taskCount} /> : null}
    </SidebarRow>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-2">
      {["w-3/4", "w-2/3", "w-4/5", "w-3/5", "w-2/3"].map((width, index) => (
        <div className="flex h-7 items-center gap-2 px-2" key={index}>
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton className={cn("h-3", width)} />
        </div>
      ))}
    </div>
  );
}

export interface TasksSidebarProps {
  route: TasksRoute;
  folders: Folder[] | undefined;
  projects: Project[] | undefined;
  summaries: SidebarProjectSummary[] | undefined;
  presets: Preset[] | undefined;
  activeTasks: Task[] | undefined;
  isLoading: boolean;
  /**
   * Rendered as an overlay drawer over the list (narrow containers). Uses a
   * fixed drawer width and hides the resize handle; the stored desktop width
   * is left untouched.
   */
  overlay?: boolean;
  onNavigate: (route: TasksRoute) => void;
  onNewProject: () => void;
}

export function TasksSidebar({
  route,
  folders,
  projects,
  summaries,
  presets,
  activeTasks,
  isLoading,
  overlay = false,
  onNavigate,
  onNewProject,
}: TasksSidebarProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const rpc = useTasksRpc();
  // Keyed remount resets the dialog draft per open/target. Saving publishes
  // projects:changed, which refreshes the shell's presets query.
  const [presetDialog, setPresetDialog] = useState<{
    key: number;
    editing: Preset | null;
  } | null>(null);
  const [width, setWidth] = useState(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    // The sidebar sits on the right, so width is measured from its right
    // edge (fixed during the drag) back to the pointer.
    const rightEdge = asideRef.current?.getBoundingClientRect().right;
    if (rightEdge === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    const rightEdge = asideRef.current?.getBoundingClientRect().right;
    if (rightEdge === undefined) return;
    setWidth(clampSidebarWidth(Math.round(rightEdge - event.clientX)));
  };
  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setResizing(false);
    storeSidebarWidth(widthRef.current);
  };
  const resetWidth = () => {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
    storeSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  };
  const summaryByProject = useMemo(
    () => new Map((summaries ?? []).map((entry) => [entry.projectId, entry])),
    [summaries],
  );
  const totalTasks = useMemo(
    () => (summaries ?? []).reduce((sum, entry) => sum + entry.taskCount, 0),
    [summaries],
  );
  const activeProjectId = route.kind === "project" ? route.projectId : null;
  const openProject = (projectId: string) =>
    onNavigate({
      kind: "project",
      projectId,
      view: route.kind === "project" ? route.view : "list",
    });
  const toggleFolder = (folderId: string) =>
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

  const ungrouped = (projects ?? []).filter((p) => p.folderId === null);
  const rootFolders = (folders ?? []).filter((f) => f.parentFolderId === null);
  const childFolders = (folders ?? []).filter((f) => f.parentFolderId !== null);

  const renderFolder = (folder: Folder, indent: boolean) => {
    const collapsed = collapsedFolders.has(folder.id);
    const folderProjects = (projects ?? []).filter(
      (p) => p.folderId === folder.id,
    );
    const children = childFolders.filter((f) => f.parentFolderId === folder.id);
    return (
      <div key={folder.id} className={cn(indent && "pl-3")}>
        <SectionHeader
          label={folder.name}
          collapsed={collapsed}
          onToggle={() => toggleFolder(folder.id)}
        />
        {!collapsed ? (
          <div className="space-y-px">
            {folderProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                summary={summaryByProject.get(project.id)}
                active={activeProjectId === project.id}
                onClick={() => openProject(project.id)}
              />
            ))}
            {/* Folders nest one level; children only render under roots. */}
            {!indent
              ? children.map((child) => renderFolder(child, true))
              : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      ref={asideRef}
      style={overlay ? undefined : { width }}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l border-border-seam-vertical bg-sidebar",
        overlay && "w-72 min-w-0 max-w-full shrink shadow-lg",
        resizing && "select-none",
      )}
    >
      {!overlay ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · double-click to reset"
          className={cn(
            "absolute inset-y-0 -left-px z-10 w-1 cursor-col-resize transition-colors",
            resizing ? "bg-primary/50" : "hover:bg-primary/30",
          )}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={resetWidth}
        />
      ) : null}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
        <div className="space-y-px">
          <SidebarRow
            active={route.kind === "all"}
            onClick={() => onNavigate({ kind: "all" })}
          >
            <Icon name="ListView" className="size-3.5 shrink-0" />
            <span className="flex-1">All tasks</span>
            {summaries ? <RowCount value={totalTasks} /> : null}
          </SidebarRow>
          <SidebarRow
            active={route.kind === "active"}
            onClick={() => onNavigate({ kind: "active" })}
          >
            <Icon name="Zap" className="size-3.5 shrink-0" />
            <span className="flex-1">Active</span>
            {activeTasks && activeTasks.length > 0 ? <WorkingDot /> : null}
            {activeTasks ? <RowCount value={activeTasks.length} /> : null}
          </SidebarRow>
        </div>
        {isLoading ? (
          <SidebarSkeleton />
        ) : (
          <>
            {ungrouped.length > 0 ? (
              <>
                <SectionHeader label="Projects" />
                <div className="space-y-px">
                  {ungrouped.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      summary={summaryByProject.get(project.id)}
                      active={activeProjectId === project.id}
                      onClick={() => openProject(project.id)}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {rootFolders.map((folder) => renderFolder(folder, false))}
            {/* With zero projects the main pane's empty-state CTA is the
                single New-project affordance. */}
            {(projects ?? []).length > 0 ? (
              <div className="mt-1.5">
                <SidebarRow onClick={onNewProject} title="New project">
                  <Icon name="Plus" className="size-3.5 shrink-0" />
                  <span className="flex-1">New project</span>
                </SidebarRow>
              </div>
            ) : null}
            {presets ? (
              <>
                <SectionHeader label="Agent presets" />
                <div className="space-y-px">
                  {presets.map((preset) => (
                    <SidebarRow
                      key={preset.id}
                      title={`Edit preset ${preset.name}`}
                      onClick={() =>
                        setPresetDialog({ key: Date.now(), editing: preset })
                      }
                    >
                      <Icon name="Brain" className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {preset.name}
                      </span>
                      {preset.environmentKind === "new-worktree" ? (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                aria-label="Spawns a new worktree"
                                className="flex shrink-0 text-muted-foreground/70"
                              >
                                <Icon name="GitBranch" className="size-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              Spawns a new worktree
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </SidebarRow>
                  ))}
                  {presets.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      No presets yet.
                    </div>
                  ) : null}
                  <SidebarRow
                    title="New preset"
                    onClick={() =>
                      setPresetDialog({ key: Date.now(), editing: null })
                    }
                  >
                    <Icon name="Plus" className="size-3.5 shrink-0" />
                    <span className="flex-1">New preset</span>
                  </SidebarRow>
                </div>
              </>
            ) : null}
          </>
        )}
      </nav>
      <div className="shrink-0 border-t border-border-hairline px-2 py-1.5">
        <SidebarRow
          active={route.kind === "manage"}
          onClick={() => onNavigate({ kind: "manage" })}
        >
          <Icon name="Settings" className="size-3.5 shrink-0" />
          <span className="flex-1">Manage</span>
        </SidebarRow>
      </div>
      {presetDialog ? (
        <PresetDialog
          key={presetDialog.key}
          open
          onOpenChange={(open) => {
            if (!open) setPresetDialog(null);
          }}
          editing={presetDialog.editing}
          onSave={(draft) => savePresetDraft(rpc, presetDialog.editing, draft)}
        />
      ) : null}
    </aside>
  );
}
