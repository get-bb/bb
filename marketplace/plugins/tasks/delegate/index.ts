import type { BbPluginApi, PluginRpcHandlers } from "@bb/plugin-sdk";
import { z } from "zod";
import type {
  Attachment,
  Comment,
  Preset,
  Project,
  Task,
  TasksStore,
  TaskThreadLiveStatus,
} from "../db";
import type { TasksApiStore } from "../api";
import type {
  CommentsChangedEvent,
  TasksChangedEvent,
  ThreadsChangedEvent,
} from "../shared/contract";
import { delegationRpcContract } from "./contract";

const MAX_DELEGATED_THREAD_TITLE_LENGTH = 120;
const SYSTEM_AUTHOR_NAME = "Tasks";
const MANUAL_PRESET_NAME = "Attached";

const presetExecutionSchema = z
  .object({
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    reasoningLevel: z.enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
      "ultra",
    ]),
    permissionMode: z.enum(["readonly", "workspace-write", "full"]),
  })
  .strict();

export const BUILTIN_PRESETS = [
  {
    name: "Sonnet · high",
    providerId: "claude-code",
    modelId: "claude-sonnet-5",
    reasoningLevel: "high",
    permissionMode: "full",
    instructions: "",
  },
  {
    name: "Fable · medium",
    providerId: "claude-code",
    modelId: "claude-fable-5",
    reasoningLevel: "medium",
    permissionMode: "full",
    instructions: "",
  },
  {
    name: "GPT-5.6 · high",
    providerId: "codex",
    modelId: "gpt-5.6-sol",
    reasoningLevel: "high",
    permissionMode: "full",
    instructions: "",
  },
] as const;

export type DelegationErrorCode = "project_not_linked";

export class DelegationError extends Error {
  constructor(
    readonly code: DelegationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DelegationError";
  }
}

export interface SeedPromptInput {
  task: Task;
  project: Project;
  subtasks: readonly Task[];
  attachments: readonly Pick<Attachment, "id" | "fileName">[];
  recentComments: readonly Comment[];
  presetInstructions: string;
  extraInstructions?: string;
}

function markdownSection(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

function formatSubtasks(subtasks: readonly Task[]): string {
  if (subtasks.length === 0) return "None.";
  return subtasks
    .map((subtask) => `- ${subtask.key} · ${subtask.title} (${subtask.status})`)
    .join("\n");
}

function formatAttachments(
  attachments: readonly Pick<Attachment, "id" | "fileName">[],
): string {
  if (attachments.length === 0) return "None.";
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.fileName} · ${attachment.id}\n` +
        `  Fetch with: bb tasks attachment get ${attachment.id} --out <path>`,
    )
    .join("\n");
}

function formatComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "None.";
  return comments
    .map(
      (comment) =>
        `### ${comment.authorName} · ${comment.kind} · ${comment.createdAt}\n\n${comment.body}`,
    )
    .join("\n\n");
}

export function buildSeedPrompt(input: SeedPromptInput): string {
  const sections = [
    `# ${input.task.key} · ${input.task.title}`,
    markdownSection(
      "Description",
      input.task.description.trim() || "No description provided.",
    ),
    markdownSection(
      "Project context",
      `- Name: ${input.project.name}\n- Linked bb project: ${input.project.linkedBbProjectId ?? "Not linked"}`,
    ),
    markdownSection("Sub-tasks", formatSubtasks(input.subtasks)),
    markdownSection("Attachments", formatAttachments(input.attachments)),
    markdownSection("Recent comments", formatComments(input.recentComments)),
    markdownSection(
      "Report-back contract",
      `You are working on task ${input.task.key}. Use the bb tasks CLI: comment substantive updates (bb tasks comment ${input.task.key} --body ...), attach result artifacts, set status when done (bb tasks update ${input.task.key} --status in_review) or explain blockage in a comment. Your thread is already attached to the task.`,
    ),
  ];

  if (input.presetInstructions.trim()) {
    sections.push(
      markdownSection("Preset instructions", input.presetInstructions.trim()),
    );
  }
  if (input.extraInstructions?.trim()) {
    sections.push(
      markdownSection(
        "Additional instructions",
        input.extraInstructions.trim(),
      ),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

export function seedBuiltinPresets(store: TasksStore): void {
  if (store.listPresets().length > 0) return;
  for (const preset of BUILTIN_PRESETS) {
    store.createPreset({ ...preset, builtin: true });
  }
}

function delegatedThreadTitle(task: Task): string {
  return `${task.key} · ${task.title}`.slice(
    0,
    MAX_DELEGATED_THREAD_TITLE_LENGTH,
  );
}

function requireTask(store: TasksStore, taskId: string): Task {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function requireProject(store: TasksStore, projectId: string): Project {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function requirePreset(store: TasksStore, presetId: string): Preset {
  const preset = store.getPreset(presetId);
  if (!preset) throw new Error(`Preset not found: ${presetId}`);
  return preset;
}

function requireLinkedBbProject(project: Project): string {
  if (project.linkedBbProjectId) return project.linkedBbProjectId;
  throw new DelegationError(
    "project_not_linked",
    `Task project "${project.name}" is not linked to a bb project`,
  );
}

function collectAttachments(
  store: TasksStore,
  taskId: string,
  comments: readonly Comment[],
): Attachment[] {
  const attachments = new Map<string, Attachment>();
  for (const attachment of store.listAttachmentsForTask(taskId)) {
    attachments.set(attachment.id, attachment);
  }
  for (const comment of comments) {
    for (const attachment of store.listAttachmentsForComment(comment.id)) {
      attachments.set(attachment.id, attachment);
    }
  }
  return [...attachments.values()];
}

export function createSystemComment(
  store: TasksStore,
  input: {
    taskId: string;
    presetName: string;
    threadId: string;
    body: string;
  },
): void {
  store.createComment({
    taskId: input.taskId,
    kind: "system",
    authorName: SYSTEM_AUTHOR_NAME,
    presetName: input.presetName,
    threadId: input.threadId,
    body: input.body,
    notifiedCount: 0,
  });
}

export function publishThreadsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: ThreadsChangedEvent = { taskId };
  bb.realtime.publish("threads:changed", payload);
}

function publishTasksChanged(
  bb: BbPluginApi,
  taskId: string,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId, projectId };
  bb.realtime.publish("tasks:changed", payload);
}

export function publishCommentsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: CommentsChangedEvent = { taskId };
  bb.realtime.publish("comments:changed", payload);
}

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function taskThreadLiveStatus(
  status: SdkThread["status"],
): TaskThreadLiveStatus {
  switch (status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
    case "error":
      return "failed";
  }
}

export function handlers(
  bb: BbPluginApi,
  store: TasksApiStore,
): PluginRpcHandlers<typeof delegationRpcContract> {
  return {
    async delegate(input) {
      const task = requireTask(store.tasks, input.taskId);
      const project = requireProject(store.tasks, task.projectId);
      const linkedBbProjectId = requireLinkedBbProject(project);
      const preset = requirePreset(store.tasks, input.presetId);
      const comments = store.tasks.listComments(task.id);
      const recentComments = comments.slice(-5);
      const title = delegatedThreadTitle(task);
      const execution = presetExecutionSchema.parse({
        providerId: preset.providerId,
        model: preset.modelId,
        reasoningLevel: preset.reasoningLevel,
        permissionMode: preset.permissionMode,
      });
      const prompt = buildSeedPrompt({
        task,
        project,
        subtasks: store.tasks.listSubtasks(task.id),
        attachments: collectAttachments(store.tasks, task.id, comments),
        recentComments,
        presetInstructions: preset.instructions,
        extraInstructions: input.extraInstructions,
      });

      const thread = await bb.sdk.threads.spawn({
        projectId: linkedBbProjectId,
        environment: { type: "project-default" },
        providerId: execution.providerId,
        model: execution.model,
        reasoningLevel: execution.reasoningLevel,
        permissionMode: execution.permissionMode,
        title,
        prompt,
      });

      store.transaction(() => {
        store.tasks.upsertTaskThread({
          taskId: task.id,
          threadId: thread.id,
          presetName: preset.name,
          title,
          liveStatus: "starting",
        });

        if (task.status === "backlog" || task.status === "todo") {
          store.tasks.updateTask(task.id, { status: "in_progress" });
          createSystemComment(store.tasks, {
            taskId: task.id,
            presetName: preset.name,
            threadId: thread.id,
            body: `Status changed to In Progress · delegated to ${preset.name}`,
          });
        }

        createSystemComment(store.tasks, {
          taskId: task.id,
          presetName: preset.name,
          threadId: thread.id,
          body: `Thread "${title}" attached · preset ${preset.name}`,
        });
      });

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      publishCommentsChanged(bb, task.id);
      return { threadId: thread.id };
    },

    async taskThreadsAttach(input) {
      const task = requireTask(store.tasks, input.taskId);
      const thread = await bb.sdk.threads.get({ threadId: input.threadId });
      const title = (
        thread.title ??
        thread.titleFallback ??
        delegatedThreadTitle(task)
      ).slice(0, MAX_DELEGATED_THREAD_TITLE_LENGTH);

      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: thread.id,
        presetName: MANUAL_PRESET_NAME,
        title,
        liveStatus: taskThreadLiveStatus(thread.status),
      });

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      return { threadId: thread.id };
    },
  };
}

export function registerDelegation(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  seedBuiltinPresets(store.tasks);
  bb.rpc.register(delegationRpcContract, handlers(bb, store));
}
