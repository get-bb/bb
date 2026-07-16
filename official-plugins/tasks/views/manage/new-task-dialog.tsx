import { useEffect, useMemo, useRef, useState } from "react";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";
import { useProjects, useTasksQuery, useTasksRpc } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { TasksEditor } from "../../editor/tasks-editor.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CheckboxField, DEFAULT_COLOR } from "./shared.js";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

const CHIP_TRIGGER =
  "h-7 w-auto gap-1.5 rounded-md px-2 text-xs text-muted-foreground";

export interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected project, or null when opened from All tasks / Active. */
  projectId: string | null;
  /** Status the new task starts in, e.g. the board column that opened the dialog. */
  defaultStatus?: TaskStatus;
  /**
   * When set the dialog opens as "Add sub-task" with this parent pre-selected
   * and the project locked to the parent's (sub-tasks must share it).
   */
  defaultParentTaskId?: string;
}

export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  defaultStatus,
  defaultParentTaskId,
}: NewTaskDialogProps) {
  const rpc = useTasksRpc();
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const subtaskMode = defaultParentTaskId !== undefined;

  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [parentTaskId, setParentTaskId] = useState<string | null>(
    defaultParentTaskId ?? null,
  );
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelQuery, setLabelQuery] = useState("");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Each open starts a fresh draft seeded from the invoking context.
  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(projectId);
    setTitle("");
    setDescription("");
    setStatus(defaultStatus ?? "todo");
    setPriority("none");
    setLabelIds([]);
    setDueDate("");
    setParentTaskId(defaultParentTaskId ?? null);
    setLabelQuery("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const projectList = projects.data ?? [];
  const effectiveProjectId =
    selectedProjectId ?? projectId ?? projectList[0]?.id ?? null;
  const project =
    projectList.find((entry) => entry.id === effectiveProjectId) ?? null;

  const labels = useTasksQuery(
    async (rpc) =>
      effectiveProjectId
        ? (await rpc.call("listLabels", { projectId: effectiveProjectId }))
            .labels
        : [],
    ["projects:changed"],
    [effectiveProjectId],
  );
  const parentCandidates = useTasksQuery(
    async (rpc) =>
      effectiveProjectId && subtaskMode
        ? (
            await rpc.call("listTasks", {
              projectId: effectiveProjectId,
              parentTaskId: null,
            })
          ).tasks
        : [],
    ["tasks:changed"],
    [effectiveProjectId, subtaskMode],
  );
  const parentTask =
    (parentCandidates.data ?? []).find((task) => task.id === parentTaskId) ??
    null;

  const changeProject = (id: string) => {
    setSelectedProjectId(id);
    // Labels and parents are project-scoped; keeping them would trip the
    // server's project-mismatch checks.
    setLabelIds([]);
    if (!subtaskMode) setParentTaskId(null);
  };

  const toggleLabel = (labelId: string) =>
    setLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );

  // Inline label creation from the picker when the query matches nothing.
  const createLabelFromQuery = async () => {
    const name = labelQuery.trim();
    if (!name || effectiveProjectId === null || creatingLabel) return;
    setCreatingLabel(true);
    try {
      const { label } = await rpc.call("createLabel", {
        projectId: effectiveProjectId,
        name,
        color: DEFAULT_COLOR,
      });
      labels.refresh();
      setLabelIds((current) => [...current, label.id]);
      setLabelQuery("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    } finally {
      setCreatingLabel(false);
    }
  };

  const canSubmit =
    effectiveProjectId !== null && title.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit || effectiveProjectId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await rpc.call("createTask", {
        projectId: effectiveProjectId,
        title: title.trim(),
        description,
        status,
        priority,
        dueDate: dueDate === "" ? null : dueDate,
        parentTaskId,
        labelIds,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (createMore) {
        setTitle("");
        setDescription("");
        setLabelIds([]);
        setDueDate("");
        titleRef.current?.focus();
      } else {
        onOpenChange(false);
        navigation.go({ kind: "task", taskKey: result.task.key });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLabels = useMemo(
    () => (labels.data ?? []).filter((label) => labelIds.includes(label.id)),
    [labels.data, labelIds],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-0 p-0"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogTitle className="flex items-center gap-2 px-4 pt-4 text-xs font-normal text-muted-foreground">
          {project ? (
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: project.color }}
            />
          ) : null}
          {subtaskMode ? "New sub-task" : "New task"}
          {project ? ` · ${project.name}` : ""}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Create a task with a title, description, and attributes.
        </DialogDescription>
        <div className="px-4 pt-2">
          <input
            ref={titleRef}
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // Plain Enter submits from the title (Cmd/Ctrl+Enter works
              // anywhere in the dialog via the DialogContent handler).
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Task title"
            aria-label="Task title"
            className="w-full bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground"
          />
          <TasksEditor
            variant="comment"
            value={description}
            onChange={setDescription}
            placeholder="Description — rich text, round-trips as markdown for agents"
            className="mt-2 min-h-16"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
          {!subtaskMode ? (
            <Select
              value={effectiveProjectId ?? undefined}
              onValueChange={changeProject}
            >
              <SelectTrigger
                aria-label="Project"
                className={cn(CHIP_TRIGGER, "max-w-44")}
              >
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projectList.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-sm"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as TaskStatus)}
          >
            <SelectTrigger aria-label="Status" className={CHIP_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority}
            onValueChange={(value) => setPriority(value as TaskPriority)}
          >
            <SelectTrigger aria-label="Priority" className={CHIP_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(CHIP_TRIGGER, "border-input font-normal")}
              >
                {selectedLabels.length === 0 ? (
                  <>
                    <Icon name="Plus" className="size-3" />
                    Labels
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-0.5">
                      {selectedLabels.slice(0, 3).map((label) => (
                        <span
                          key={label.id}
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                      ))}
                    </span>
                    {selectedLabels.length === 1
                      ? selectedLabels[0]!.name
                      : `${selectedLabels.length} labels`}
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Add labels…"
                  value={labelQuery}
                  onValueChange={setLabelQuery}
                />
                <CommandList>
                  <CommandEmpty
                    className={
                      labelQuery.trim() !== "" ? "p-1 text-left" : undefined
                    }
                  >
                    {labelQuery.trim() !== "" ? (
                      <button
                        type="button"
                        disabled={creatingLabel}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onClick={() => void createLabelFromQuery()}
                      >
                        <Icon name="Plus" className="size-3.5" />
                        Create “{labelQuery.trim()}”
                      </button>
                    ) : (
                      "No labels in this project."
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {(labels.data ?? []).map((label) => (
                      <CommandItem
                        key={label.id}
                        value={label.name}
                        onSelect={() => toggleLabel(label.id)}
                      >
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="flex-1">{label.name}</span>
                        {labelIds.includes(label.id) ? (
                          <Icon name="Check" className="size-3.5" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            aria-label="Due date"
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {subtaskMode ? (
            <Popover open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(CHIP_TRIGGER, "border-input font-normal")}
                >
                  <Icon name="CornerDownRight" className="size-3" />
                  {parentTask
                    ? `Sub-task of ${parentTask.key}`
                    : "Parent task"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Choose parent task…" />
                  <CommandList>
                    <CommandEmpty>No tasks in this project.</CommandEmpty>
                    <CommandGroup>
                      {(parentCandidates.data ?? []).map((task) => (
                        <CommandItem
                          key={task.id}
                          value={`${task.key} ${task.title}`}
                          onSelect={() => {
                            setParentTaskId(task.id);
                            setParentPickerOpen(false);
                          }}
                        >
                          <span className="shrink-0 font-medium text-muted-foreground">
                            {task.key}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {task.title}
                          </span>
                          {task.id === parentTaskId ? (
                            <Icon name="Check" className="size-3.5" />
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="px-4 pt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mt-4 flex-row items-center border-t border-border-hairline px-4 py-3 sm:justify-between">
          <CheckboxField
            checked={createMore}
            onCheckedChange={setCreateMore}
            label="Create more"
          />
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {subtaskMode ? "Create sub-task" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
