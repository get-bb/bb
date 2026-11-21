import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Label,
  Project,
  Task,
  TaskThread,
} from "../../shared/contract.js";
import {
  experimental_matchesShortcutKey as matchesShortcutKey,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { observeSharedResize } from "@/lib/shared-resize-observer";
import { cn } from "@/lib/utils";
import type { TaskRowMeta } from "./data.js";
import {
  mergePendingThreads,
  useTaskPendingThreads,
  type PendingThread,
} from "./data.js";
import {
  activeWorkLabel,
  formatDueDate,
  formatElapsed,
  partitionLabels,
} from "./lib.js";
import type { EditFn } from "./property-menus.js";
import {
  isBareKey,
  PriorityEditor,
  StatusEditor,
  TaskContextMenu,
} from "./property-menus.js";

const RAIL_CHIP_CLASS =
  "flex items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs text-muted-foreground";

function ActiveChip({
  threads,
  start,
}: {
  threads: readonly TaskThread[];
  start?: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (start === undefined) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [start]);
  if (threads.length === 0 && start === undefined) return null;
  return (
    <span
      title={threads.length > 0 ? activeWorkLabel(threads) : undefined}
      className={RAIL_CHIP_CLASS}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
      />
      Active
      {start !== undefined ? (
        <span className="tabular-nums text-success">
          {formatElapsed(Math.max(0, Math.floor((now - start) / 1000)))}
        </span>
      ) : null}
    </span>
  );
}

function LabelChip({ label }: { label: Label }) {
  return (
    <span className={`${RAIL_CHIP_CLASS} max-w-32`}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function LabelChipRow({
  labels,
  maxVisible,
}: {
  labels: readonly Label[];
  maxVisible: number;
}) {
  const { visible, hidden, hiddenTitle } = partitionLabels(labels, maxVisible);
  return (
    <>
      {visible.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {hidden.length > 0 ? (
        <span title={hiddenTitle} className={`${RAIL_CHIP_CLASS} tabular-nums`}>
          +{hidden.length}
        </span>
      ) : null}
    </>
  );
}

function LabelChips({
  task,
  labelsById,
}: {
  task: Task;
  labelsById: Map<string, Label>;
}) {
  const labels = task.labelIds.flatMap((id) => labelsById.get(id) ?? []);
  if (labels.length === 0) return null;
  return (
    <>
      <span className="hidden items-center gap-1.5 @xl:flex">
        <LabelChipRow labels={labels} maxVisible={2} />
      </span>
      <span className="flex items-center gap-1.5 @xl:hidden">
        <LabelChipRow labels={labels} maxVisible={1} />
      </span>
    </>
  );
}

interface TaskRowProps {
  task: Task;
  timing?: { start: number; working: boolean };
  child?: boolean;
  subTasks?: {
    done: number;
    total: number;
    open: boolean;
    disabled: boolean;
    toggle: () => void;
  };
  meta: TaskRowMeta | undefined;
  project: Project | undefined;
  showProject: boolean;
  labelsById: Map<string, Label>;
  projectLabels: readonly Label[];
  projects: readonly Project[];
  onEdit: EditFn;
  onMoveToProject: (task: Task, projectId: string) => void;
  onOpen: (taskKey: string) => void;
  pending: boolean;
  muted?: boolean;
  pendingThreadById: ReadonlyMap<string, number>;
  rolledUpPendingThreads: readonly PendingThread[] | undefined;
  onPendingThreads: (
    taskId: string,
    pending: readonly PendingThread[] | undefined,
  ) => void;
}

const KEY_TYPOGRAPHY = "text-xs tabular-nums";

export function KeyColumnScope({
  keys,
  className,
  children,
}: {
  keys: readonly string[];
  className: string;
  children: ReactNode;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scope = scopeRef.current;
    const sizer = sizerRef.current;
    if (scope === null || sizer === null) return;
    const measure = () => Math.ceil(sizer.getBoundingClientRect().width);
    const apply = (width: number) => {
      scope.style.setProperty("--task-key-width", `${width}px`);
    };
    apply(measure());
    return observeSharedResize(sizer, { read: measure, write: apply });
  }, []);
  return (
    <div ref={scopeRef} className={cn("relative", className)}>
      <div
        ref={sizerRef}
        aria-hidden
        className={cn(
          "pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max flex-col overflow-hidden",
          KEY_TYPOGRAPHY,
        )}
      >
        {keys.map((key) => (
          <span
            key={key}
            data-key-sizer={key}
            className="before:content-[attr(data-key-sizer)]"
          />
        ))}
      </div>
      {children}
    </div>
  );
}

export function SubTaskRow({
  open,
  ...rowProps
}: Omit<TaskRowProps, "child"> & { open: boolean }) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <TaskRow {...rowProps} child />
      </div>
    </div>
  );
}

export const TaskRow = memo(function TaskRow({
  task,
  timing,
  child = false,
  subTasks,
  meta,
  project,
  showProject,
  labelsById,
  projectLabels,
  projects,
  onEdit,
  onMoveToProject,
  onOpen,
  pending,
  muted = false,
  pendingThreadById,
  rolledUpPendingThreads,
  onPendingThreads,
}: TaskRowProps) {
  const [openMenu, setOpenMenu] = useState<"status" | "priority" | null>(null);
  const navigate = useBbNavigate();
  const pendingThreads = useTaskPendingThreads(task.id, pendingThreadById);
  useEffect(() => {
    onPendingThreads(task.id, pendingThreads);
  }, [onPendingThreads, task.id, pendingThreads]);
  const needsYou = mergePendingThreads(pendingThreads, rolledUpPendingThreads);

  return (
    <TaskContextMenu
      task={task}
      onEdit={onEdit}
      projectLabels={projectLabels}
      projects={projects}
      onMoveToProject={onMoveToProject}
    >
      <div
        data-task-key={task.key}
        aria-busy={pending || undefined}
        className={cn(
          "relative grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-border-hairline px-3.5 py-1.5 text-left transition-opacity hover:bg-state-hover",
          "@md:flex @md:h-[34px] @md:py-0",
          child && "pl-9",
          pending && "opacity-70",
          muted && "opacity-50",
        )}
      >
        <button
          type="button"
          aria-label={`Open ${task.key}: ${task.title}`}
          onClick={() => onOpen(task.key)}
          onKeyDown={(event) => {
            if (!isBareKey(event)) return;
            if (matchesShortcutKey(event, "s")) {
              event.preventDefault();
              setOpenMenu("status");
            } else if (matchesShortcutKey(event, "p")) {
              event.preventDefault();
              setOpenMenu("priority");
            }
          }}
          className="absolute inset-0 rounded-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        />
        <PriorityEditor
          task={task}
          onEdit={onEdit}
          open={openMenu === "priority"}
          onOpenChange={(next) => setOpenMenu(next ? "priority" : null)}
          className="col-start-1 row-start-2"
        />
        <span
          title={task.key}
          className={cn(
            "col-start-2 row-start-2 min-w-0 truncate text-subtle-foreground @max-md:max-w-32 @md:w-[var(--task-key-width,3.5rem)] @md:shrink-0",
            KEY_TYPOGRAPHY,
          )}
        >
          {task.key}
        </span>
        <StatusEditor
          task={task}
          onEdit={onEdit}
          open={openMenu === "status"}
          onOpenChange={(next) => setOpenMenu(next ? "status" : null)}
          className="col-start-1 row-start-1"
        />
        <span className="col-start-2 col-span-2 row-start-1 min-w-0 truncate text-sm @md:flex-1">
          {task.title}
        </span>
        <span className="col-start-3 row-start-2 flex min-w-0 items-center gap-1.5 justify-self-end text-xs text-subtle-foreground @max-md:overflow-hidden @md:shrink-0">
          <ActiveChip
            threads={meta?.activeThreads ?? []}
            start={
              timing?.working && !needsYou?.length ? timing.start : undefined
            }
          />
          {needsYou !== undefined && needsYou.length > 0 ? (
            <button
              type="button"
              aria-label={`Open the thread waiting on you for ${task.key}`}
              title="An attached thread is blocked on your answer"
              className="relative text-xs font-medium text-attention underline-offset-2 hover:underline"
              onClick={() => navigate.toThread(needsYou[0]!.id)}
            >
              Needs you
            </button>
          ) : null}
          {subTasks && subTasks.total > 0 ? (
            <button
              type="button"
              aria-expanded={subTasks.open}
              aria-label={`${subTasks.open ? "Collapse" : "Expand"} sub-tasks of ${task.key}`}
              disabled={subTasks.disabled}
              onClick={subTasks.toggle}
              className={cn(RAIL_CHIP_CLASS, "relative disabled:opacity-70")}
            >
              <Icon
                name={subTasks.open ? "ChevronDown" : "ChevronRight"}
                className="size-3"
              />
              {subTasks.done}/{subTasks.total}
            </button>
          ) : null}
          <LabelChips task={task} labelsById={labelsById} />
          {task.dueDate !== null ? (
            <span className={`${RAIL_CHIP_CLASS} shrink-0 tabular-nums`}>
              <Icon name="Clock" className="size-3 shrink-0" />
              {formatDueDate(task.dueDate)}
            </span>
          ) : null}
          {showProject && project !== undefined ? (
            <span
              aria-hidden
              title={project.name}
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: project.color }}
            />
          ) : null}
        </span>
      </div>
    </TaskContextMenu>
  );
});
