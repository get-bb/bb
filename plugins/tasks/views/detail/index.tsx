import { RefreshError } from "../../components/refresh-error.js";
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import SmilePlusIcon from "@hugeicons/core-free-icons/SmilePlusIcon";
import type { Task } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import {
  useBbNavigate,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import {
  useMentionItems,
  useTaskRead,
  useTaskRows,
  useTaskMutation,
  useTaskUpdateMutation,
} from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { TaskActivity } from "../activity/task-activity.js";
import { AttachmentsGrid, uploadAttachment } from "./attachments.js";
import {
  createDescriptionSaver,
  saveDescriptionMutation,
  type DescriptionSaver,
} from "./description-save.js";
import { StatusIcon } from "./meta.js";
import { STATUS_LABELS } from "../list/lib.js";
import {
  InlineProperties,
  PropertiesRail,
  type TaskPropertyUpdate,
} from "./rail.js";
import { ThreadsSection } from "./threads.js";
import { DetailToasts, useDetailToasts } from "./toast.js";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

interface DetailViewProps {
  taskKey: string;
  onCanonicalKey?: (taskKey: string) => void;
}

const DESCRIPTION_SAVE_DELAY_MS = 800;

function SubTaskDonut({
  subtasks,
  onClick,
}: {
  subtasks: import("../../shared/contract.js").TaskSummary[];
  onClick: () => void;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((subtask) => subtask.status === "done").length;
  const degrees = (done / subtasks.length) * 360;
  return (
    <button
      type="button"
      title="Sub-tasks completed"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground shadow-2xs hover:border-input hover:text-foreground"
    >
      <span
        aria-hidden
        className="inline-block size-3 rounded-full"
        style={{
          background: `conic-gradient(var(--primary) ${degrees}deg, var(--muted) 0)`,
        }}
      />
      {done}/{subtasks.length} sub-tasks
    </button>
  );
}

function EditableTitle({
  task,
  onSave,
}: {
  task: Task;
  onSave: (title: string) => void;
}) {
  return (
    <h1
      key={`${task.id}:${task.title}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Task title"
      className="mb-2.5 mt-1 text-2xl font-semibold leading-tight outline-none"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.textContent?.trim() ?? "";
        if (!next) {
          event.currentTarget.textContent = task.title;
          return;
        }
        if (next !== task.title) onSave(next);
      }}
    >
      {task.title}
    </h1>
  );
}

function SubTasksSection({
  ref,
  task,
  subtasks,
  onCreate,
}: {
  ref: React.Ref<HTMLElement>;
  task: Task;
  subtasks: import("../../shared/contract.js").TaskSummary[];
  onCreate: (title: string) => Promise<boolean>;
}) {
  const navigation = useTasksNavigation();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const created = await onCreate(trimmed);
    setBusy(false);
    if (created) setTitle("");
  };

  return (
    <section ref={ref} className="mt-5">
      {subtasks.map((subtask) => (
        <button
          key={subtask.id}
          type="button"
          className="flex h-8 w-full items-center gap-2 border-b border-border-hairline px-0.5 text-left text-sm hover:bg-state-hover"
          title={STATUS_LABELS[subtask.status]}
          onClick={() => navigation.go({ kind: "task", taskKey: subtask.key })}
        >
          <StatusIcon status={subtask.status} />
          <span className="shrink-0 text-xs text-muted-foreground">
            {subtask.key}
          </span>
          <span className="min-w-0 truncate">{subtask.title}</span>
        </button>
      ))}
      {adding ? (
        <div className="flex h-8 items-center gap-2 border-b border-border-hairline px-0.5">
          <StatusIcon status="todo" className="opacity-60" />
          <input
            autoFocus
            value={title}
            placeholder={`Sub-task of ${task.key}…`}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
              if (event.key === "Escape") {
                setAdding(false);
                setTitle("");
              }
            }}
            onBlur={() => {
              if (!title.trim()) setAdding(false);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="flex items-center gap-1.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setAdding(true)}
      >
        <Icon name="Plus" className="size-3" />
        Add sub-task
      </button>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <DelayedLoading>
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </DelayedLoading>
  );
}

function TaskDetail({
  task,
  readTaskKey,
}: {
  task: Task;
  readTaskKey: string;
}) {
  const updateTaskMutation = useTaskUpdateMutation(() => readTaskKey).mutate;
  const moveTaskToProjectMutation = useTaskMutation("moveTaskToProject");
  const createTaskMutation = useTaskMutation("createTask");
  const deleteAttachmentMutation = useTaskMutation("deleteAttachment");
  const detach = experimental_useRpcMutation<
    DelegationRpcContract,
    "taskThreadsDetach"
  >({ method: "taskThreadsDetach" }).mutate;
  const navigation = useTasksNavigation();
  const { toasts, push, dismiss } = useDetailToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subtasksRef = useRef<HTMLElement>(null);

  const [draft, setDraft] = useState<{ taskId: string; markdown: string }>();
  const rpcRef = useRef(updateTaskMutation);
  rpcRef.current = updateTaskMutation;
  const pushRef = useRef(push);
  pushRef.current = push;
  const saverRef = useRef<DescriptionSaver | null>(null);
  saverRef.current ??= createDescriptionSaver({
    save: (taskId, markdown) =>
      saveDescriptionMutation(async () => {
        await rpcRef.current({ taskId, description: markdown });
      }),
    onError: (message) => pushRef.current(message),
    delayMs: DESCRIPTION_SAVE_DELAY_MS,
  });

  const projects = useTaskRead("listProjects", {}, (value) => value.projects);
  const project = projects.data?.find((entry) => entry.id === task.projectId);
  const parent = useTaskRead(
    "getTask",
    { taskId: task.parentTaskId ?? "" },
    (value) => value.task,
    task.parentTaskId !== null,
  );
  const subtasks = useTaskRows({ parentTaskId: task.id });
  const labels = useTaskRead(
    "listLabels",
    { projectId: task.projectId },
    (value) => value.labels,
  );
  const attachments = useTaskRead(
    "listAttachments",
    { taskId: task.id },
    (value) => value.attachments,
  );
  const threads = useTaskRead(
    "listTaskThreads",
    { taskId: task.id },
    (value) => value.taskThreads,
  );
  const presets = useTaskRead("listPresets", null, (value) => value.presets);
  const pullRequests = useTaskRead(
    "listTaskPullRequests",
    { taskId: task.id },
    (value) => value,
  );
  const refreshPullRequests = pullRequests.refresh;
  useEffect(() => {
    window.addEventListener("focus", refreshPullRequests);
    return () => window.removeEventListener("focus", refreshPullRequests);
  }, [refreshPullRequests]);

  const updateTask = async (
    input: TaskPropertyUpdate & { title?: string; description?: string },
  ) => {
    try {
      await updateTaskMutation({
        taskId: task.id,
        ...input,
      });
    } catch (error) {
      push(errorMessage(error));
    }
  };

  const moveToProject = async (projectId: string) => {
    saverRef.current?.flush(task.id);
    try {
      const result = await moveTaskToProjectMutation({
        taskId: task.id,
        projectId,
      });
      navigation.go(
        { kind: "task", taskKey: result.task.key },
        { replace: true },
      );
    } catch (error) {
      push(errorMessage(error));
    }
  };

  const onDescriptionChange = (markdown: string) => {
    setDraft({ taskId: task.id, markdown });
    saverRef.current?.onChange(task.id, markdown);
  };

  useEffect(() => {
    return () => saverRef.current?.flush(task.id);
  }, [task.id]);

  const uploadForTask = async (file: File) => {
    const result = await uploadAttachment(file, { taskId: task.id });
    attachments.refresh();
    return result;
  };

  const onPickFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      try {
        await uploadAttachment(file, { taskId: task.id });
      } catch (error) {
        push(errorMessage(error));
      }
    }
    attachments.refresh();
  };

  const createSubtask = async (title: string): Promise<boolean> => {
    try {
      const result = await createTaskMutation({
        projectId: task.projectId,
        title,
        parentTaskId: task.id,
        status: "todo",
      });
      subtasks.refresh();
      return true;
    } catch (error) {
      push(errorMessage(error));
      return false;
    }
  };

  const mentionItems = useMentionItems();
  const navigate = useBbNavigate();

  const descriptionValue =
    draft && draft.taskId === task.id ? draft.markdown : task.description;
  const parentTask = parent.data ?? null;

  return (
    <div className="@container flex min-h-full flex-col bg-surface-recessed-solid p-3">
      <div className="flex flex-1 items-stretch rounded-lg border border-border bg-card shadow-2xs">
        <div className="mx-auto w-full min-w-0 max-w-[55rem] flex-1 px-7 pb-16 pt-8 @3xl:px-13 @3xl:pt-11">
          {parentTask || subtasks.data?.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {parentTask ? (
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground shadow-2xs hover:border-input"
                  onClick={() =>
                    navigation.go({ kind: "task", taskKey: parentTask.key })
                  }
                >
                  Sub-task of
                  <StatusIcon status={parentTask.status} className="size-3" />
                  <span className="font-medium text-foreground">
                    {parentTask.key}
                  </span>
                  <span className="min-w-0 truncate">{parentTask.title}</span>
                </button>
              ) : null}
              <SubTaskDonut
                subtasks={subtasks.data ?? []}
                onClick={() =>
                  subtasksRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                }
              />
            </div>
          ) : null}

          <EditableTitle
            task={task}
            onSave={(title) => void updateTask({ title })}
          />

          <InlineProperties
            task={task}
            project={project}
            projects={projects.data}
            labels={labels.data}
            presets={presets.data}
            onUpdate={(update) => void updateTask(update)}
            onMoveToProject={(projectId) => void moveToProject(projectId)}
            onError={(message) => push(message)}
            className="mb-4 @[45rem]:hidden"
          />

          <TasksEditor
            value={descriptionValue}
            onChange={onDescriptionChange}
            variant="doc"
            className="min-h-24"
            placeholder="Add a description… rich text: headings, lists, code, checkboxes, @mentions"
            onUploadImage={uploadForTask}
            mentionItems={mentionItems}
            onOpenThread={(threadId) => navigate.toThread(threadId)}
          />

          <div className="mb-1 mt-3 flex items-center gap-1">
            <button
              type="button"
              title="Reactions coming soon"
              aria-label="Add reaction"
              disabled
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground opacity-50"
            >
              <HugeiconsIcon icon={SmilePlusIcon} className="size-4" />
            </button>
            <button
              type="button"
              title="Attach file"
              aria-label="Attach file"
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="Paperclip" className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <AttachmentsGrid
            attachments={attachments.data ?? []}
            onRemove={async (attachment) => {
              const result = await deleteAttachmentMutation({
                attachmentId: attachment.id,
                removeDescriptionReferences: true,
              });
              attachments.refresh();
            }}
            onError={(message) => push(message)}
          />

          <SubTasksSection
            ref={subtasksRef}
            task={task}
            subtasks={subtasks.data ?? []}
            onCreate={createSubtask}
          />

          {(threads.data ?? []).length > 0 ? (
            <div className="mt-6">
              <ThreadsSection
                threads={threads.data ?? []}
                pullRequests={pullRequests.data?.pullRequests}
                unavailableThreadIds={
                  pullRequests.data?.unavailableThreadIds ?? []
                }
                onDetach={async (thread) => {
                  await detach({
                    taskId: task.id,
                    threadId: thread.threadId,
                  });
                  threads.refresh();
                  pullRequests.refresh();
                }}
                onError={(message) => push(message)}
              />
            </div>
          ) : null}

          <div className="mt-1">
            <TaskActivity taskId={task.id} />
          </div>
        </div>

        <PropertiesRail
          task={task}
          project={project}
          projects={projects.data}
          labels={labels.data}
          threads={threads.data ?? []}
          presets={presets.data}
          onUpdate={(update) => void updateTask(update)}
          onMoveToProject={(projectId) => void moveToProject(projectId)}
          onError={(message) => push(message)}
          className="hidden @[45rem]:block"
        />
      </div>
      {[
        projects,
        parent,
        subtasks,
        labels,
        attachments,
        threads,
        presets,
        pullRequests,
      ]
        .filter((query) => query.error)
        .map((query, index) => (
          <RefreshError
            key={index}
            message={query.error!}
            onRetry={query.refresh}
          />
        ))}
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export function DetailView({ taskKey, onCanonicalKey }: DetailViewProps) {
  const lookup = useTaskRead(
    "getTaskByKey",
    { taskKey },
    (value) => value.task,
  );
  const [resolved, setResolved] = useState<{ key: string; task: Task }>();
  if (
    lookup.data &&
    (resolved?.key !== taskKey || resolved.task !== lookup.data)
  )
    setResolved({ key: taskKey, task: lookup.data });
  const kept = resolved?.key === taskKey ? resolved.task : undefined;
  const followed = useTaskRead(
    "getTask",
    { taskId: kept?.id ?? "" },
    (value) => value.task,
    lookup.data === null && kept !== undefined,
  );
  const query =
    lookup.data === null && kept
      ? {
          ...followed,
          data: followed.data === undefined ? kept : followed.data,
        }
      : lookup;
  const canonicalKey = lookup.data?.key;
  useEffect(() => {
    if (canonicalKey) onCanonicalKey?.(canonicalKey);
  }, [canonicalKey, onCanonicalKey]);

  if (query.data === undefined) {
    return query.error ? (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        <RefreshError message={query.error} onRetry={query.refresh} />
      </div>
    ) : (
      <DetailSkeleton />
    );
  }
  if (query.data === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Icon name="FileQuestion" className="size-5" />
        Task {taskKey} was not found.
        {query.error ? (
          <RefreshError message={query.error} onRetry={query.refresh} />
        ) : null}
      </div>
    );
  }
  return (
    <>
      {query.error ? (
        <RefreshError message={query.error} onRetry={query.refresh} />
      ) : null}
      <TaskDetail task={query.data} readTaskKey={taskKey} />
    </>
  );
}
