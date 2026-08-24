import { useState } from "react";
import type {
  Label,
  Project,
  Task,
  TaskThread,
} from "../../shared/contract.js";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { TaskRowMeta } from "./data.js";
import { activeWorkLabel, formatDueDate, partitionLabels } from "./lib.js";
import type { EditFn } from "./property-menus.js";
import {
  isBareKey,
  PriorityEditor,
  StatusEditor,
  TaskContextMenu,
} from "./property-menus.js";

/**
 * Every trailing-rail element shares this pill treatment (Linear-style), so
 * the rail reads as one aligned system rather than mixed chips and bare text.
 */
const RAIL_CHIP_CLASS =
  "flex items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs text-muted-foreground";

/**
 * Live-activity chip: a green dot plus an "Active" pill, styled like the label
 * chips so the rail stays uniform. Renders only while an agent is actively
 * starting/working; historical attachments show nothing. The pill text stays
 * constant; the tooltip carries the specific state (starting vs working, agent
 * count).
 */
function ActiveChip({ threads }: { threads: readonly TaskThread[] }) {
  if (threads.length === 0) return null;
  return (
    <span title={activeWorkLabel(threads)} className={RAIL_CHIP_CLASS}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
      />
      Active
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
  const { visible, hidden } = partitionLabels(labels, maxVisible);
  return (
    <>
      {visible.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((label) => label.name).join(", ")}
          className={`${RAIL_CHIP_CLASS} tabular-nums`}
        >
          +{hidden.length}
        </span>
      ) : null}
    </>
  );
}

/**
 * Row label chips, capped so rows keep a bounded metadata width: two chips in
 * regular containers, one in narrow ones (both variants render; container
 * queries on the list body pick which is displayed). Overflow collapses into a
 * "+N" chip whose tooltip lists the hidden names.
 */
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
  /** Task with any pending optimistic edit already applied. */
  task: Task;
  meta: TaskRowMeta | undefined;
  project: Project | undefined;
  showProject: boolean;
  labelsById: Map<string, Label>;
  /** Labels belonging to this task's project, for the context menu. */
  projectLabels: readonly Label[];
  onEdit: EditFn;
  onOpen: () => void;
  /** A mutation for this row is in flight. */
  pending: boolean;
}

/**
 * One task-list row. Primary navigation is a stretched overlay button so the
 * whole row opens the task, while the inline status/priority pickers sit above
 * it (z-10) and stay independently clickable — so editing never triggers an
 * accidental open. A focused row also opens the pickers with `S`/`P`, and
 * right-click (or the context-menu key / touch long-press) opens the property
 * menu.
 */
export function TaskRow({
  task,
  meta,
  project,
  showProject,
  labelsById,
  projectLabels,
  onEdit,
  onOpen,
  pending,
}: TaskRowProps) {
  const [openMenu, setOpenMenu] = useState<"status" | "priority" | null>(null);

  return (
    <TaskContextMenu task={task} onEdit={onEdit} projectLabels={projectLabels}>
      <div
        data-task-key={task.key}
        aria-busy={pending || undefined}
        className={cn(
          // Narrow containers get a two-line hierarchy: status + full-width
          // title on top, then priority, key, and the metadata rail below.
          // From @md up the same children lay out as the classic single flex
          // row (the grid placement classes are inert in flex), so desktop
          // keeps its exact 34px rows.
          "relative grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-border-hairline px-3.5 py-1.5 text-left transition-opacity hover:bg-state-hover",
          "@md:flex @md:h-[34px] @md:py-0",
          pending && "opacity-70",
        )}
      >
        <button
          type="button"
          aria-label={`Open ${task.key}: ${task.title}`}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (!isBareKey(event)) return;
            const key = event.key.toLowerCase();
            if (key === "s") {
              event.preventDefault();
              setOpenMenu("status");
            } else if (key === "p") {
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
        <span className="col-start-2 row-start-2 min-w-0 truncate text-xs tabular-nums text-subtle-foreground @max-md:max-w-32 @md:w-14 @md:shrink-0">
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
          {meta ? <ActiveChip threads={meta.activeThreads} /> : null}
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
}
