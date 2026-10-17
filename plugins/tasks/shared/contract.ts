import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  TASK_SORTS,
  TASKS_PAGE_DEFAULT_LIMIT,
  TASKS_PAGE_MAX_LIMIT,
} from "./pagination.js";

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export const TASK_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

export const TASK_THREAD_LIVE_STATUSES = [
  "starting",
  "working",
  "idle",
  "completed",
  "failed",
] as const;

export const PRESET_ENVIRONMENT_KINDS = [
  "project-default",
  "new-worktree",
] as const;

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const PROJECT_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
const nonBlankStringSchema = z.string().trim().min(1, "must not be blank");
export const presetReasoningLevelSchema = nonBlankStringSchema;
export type PresetReasoningLevel = z.infer<typeof presetReasoningLevelSchema>;
export const presetServiceTierSchema = nonBlankStringSchema;
export type PresetServiceTier = z.infer<typeof presetServiceTierSchema>;
export const PRESET_PERMISSION_MODES = [
  "accept-edits",
  "auto",
  "full",
] as const;
export const presetPermissionModeSchema = z.enum(PRESET_PERMISSION_MODES);
export type PresetPermissionMode = z.infer<typeof presetPermissionModeSchema>;
const presetEnvironmentKindSchema = z.enum(PRESET_ENVIRONMENT_KINDS);
const nullablePresetTargetSchema = nonBlankStringSchema.nullable();
const projectPrefixSchema = z
  .string()
  .regex(
    PROJECT_PREFIX_PATTERN,
    "must be uppercase alphanumeric, start with a letter, and contain at most 10 characters",
  );
const dueDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "must be a valid calendar date in YYYY-MM-DD format");
const taskStatusSchema = z.enum(TASK_STATUSES);
const taskPrioritySchema = z.enum(TASK_PRIORITIES);
const taskSortSchema = z.enum(TASK_SORTS);
const threadSearchStatusSchema = z.enum([
  "pending",
  "idle",
  "starting",
  "active",
  "stopping",
  "error",
]);

const folderSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    parentFolderId: idSchema.nullable(),
    createdAt: z.string(),
  })
  .strict();

const projectSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    prefix: projectPrefixSchema,
    nextTaskNumber: z.number().int().positive(),
    color: z.string(),
    folderId: idSchema.nullable(),
    linkedBbProjectId: z.string().startsWith("proj_").nullable(),
    createdAt: z.string(),
  })
  .strict();

const taskSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    number: z.number().int().positive(),
    key: z.string(),
    title: z.string(),
    description: z.string(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueDate: dueDateSchema.nullable(),
    parentTaskId: idSchema.nullable(),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    labelIds: z.array(idSchema),
  })
  .strict();

const labelSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    name: z.string(),
    color: z.string(),
  })
  .strict();

const commentSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    kind: z.enum(["user", "agent", "system"]),
    authorName: z.string(),
    presetName: z.string().nullable(),
    threadId: z.string().startsWith("thr_").nullable(),
    body: z.string(),
    notifiedCount: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();

const commentProviderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    icon: z.object({ glyph: z.string() }).strict().nullable(),
    strings: z
      .object({
        iconTint: z
          .object({ light: z.string(), dark: z.string() })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict();

const displayCommentSchema = commentSchema
  .extend({
    threadTitle: z.string().nullable(),
    provider: commentProviderSchema.nullable(),
  })
  .strict();

const attachmentSchema = z
  .object({
    id: idSchema,
    taskId: idSchema.nullable(),
    commentId: idSchema.nullable(),
    fileName: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    isImage: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

const taskThreadSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    threadId: z.string().startsWith("thr_"),
    presetName: z.string(),
    title: z.string(),
    liveStatus: z.enum(TASK_THREAD_LIVE_STATUSES),
    attachedAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const taskPullRequestSchema = z
  .object({
    url: z.string().url(),
    number: z.number().int().positive(),
    title: z.string(),
    state: z.enum(["open", "draft", "merged", "closed"]),
    updatedAt: z.string(),
    threadIds: z.array(z.string().startsWith("thr_")).min(1),
  })
  .strict();

const presetSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    reasoningLevel: presetReasoningLevelSchema,
    serviceTier: presetServiceTierSchema.nullable(),
    permissionMode: presetPermissionModeSchema,
    environmentKind: presetEnvironmentKindSchema,
    baseBranch: nullablePresetTargetSchema,
    machineId: nullablePresetTargetSchema,
    instructions: z.string(),
    builtin: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

const taskMutationResultSchema = z
  .object({ ok: z.literal(true), task: taskSchema })
  .strict();

const projectMutationResultSchema = z
  .object({ ok: z.literal(true), project: projectSchema })
  .strict();

const projectDeleteResultSchema = z
  .object({ ok: z.literal(true), deleted: z.boolean() })
  .strict();

const attachmentDeleteResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      deleted: z.literal(true),
      attachment: attachmentSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      deleted: z.literal(false),
      attachment: z.null(),
    })
    .strict(),
]);

const taskLabelsSchema = z
  .array(idSchema)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "must not contain duplicates",
  );

const updateTaskInputSchema = z
  .object({
    taskId: idSchema,
    title: nonBlankStringSchema.optional(),
    description: z.string().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dueDateSchema.nullable().optional(),
    parentTaskId: idSchema.nullable().optional(),
    labelIds: taskLabelsSchema.optional(),
    authorName: nonBlankStringSchema.default("You"),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.priority !== undefined ||
      input.dueDate !== undefined ||
      input.parentTaskId !== undefined ||
      input.labelIds !== undefined,
    { message: "at least one task field must be updated" },
  );

const updateProjectInputSchema = z
  .object({
    projectId: idSchema,
    name: nonBlankStringSchema.optional(),
    color: nonBlankStringSchema.optional(),
    folderId: idSchema.nullable().optional(),
    linkedBbProjectId: z.string().startsWith("proj_").nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.color !== undefined ||
      input.folderId !== undefined ||
      input.linkedBbProjectId !== undefined,
    { message: "at least one project field must be updated" },
  );

const updateLabelInputSchema = z
  .object({
    labelId: idSchema,
    name: nonBlankStringSchema.optional(),
    color: nonBlankStringSchema.optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.color !== undefined, {
    message: "at least one label field must be updated",
  });

const updatePresetInputSchema = z
  .object({
    presetId: idSchema,
    name: nonBlankStringSchema.optional(),
    providerId: nonBlankStringSchema.optional(),
    modelId: nonBlankStringSchema.optional(),
    reasoningLevel: presetReasoningLevelSchema.optional(),
    serviceTier: presetServiceTierSchema.nullable().optional(),
    permissionMode: presetPermissionModeSchema.optional(),
    environmentKind: presetEnvironmentKindSchema.optional(),
    baseBranch: nullablePresetTargetSchema.optional(),
    machineId: nullablePresetTargetSchema.optional(),
    instructions: z.string().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.providerId !== undefined ||
      input.modelId !== undefined ||
      input.reasoningLevel !== undefined ||
      input.serviceTier !== undefined ||
      input.permissionMode !== undefined ||
      input.environmentKind !== undefined ||
      input.baseBranch !== undefined ||
      input.machineId !== undefined ||
      input.instructions !== undefined,
    { message: "at least one preset field must be updated" },
  )
  .superRefine((input, ctx) => {
    if (
      input.environmentKind === "project-default" &&
      input.baseBranch !== undefined &&
      input.baseBranch !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseBranch"],
        message: "requires environmentKind new-worktree",
      });
    }
    if (
      input.environmentKind === "project-default" &&
      input.machineId !== undefined &&
      input.machineId !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["machineId"],
        message: "requires environmentKind new-worktree",
      });
    }
  });

const taskListInputSchema = z
  .object({
    projectId: idSchema.optional(),
    statuses: z.array(taskStatusSchema).optional(),
    priorities: z.array(taskPrioritySchema).optional(),
    labelIds: z.array(idSchema).optional(),
    activeOnly: z.boolean().default(false),
    parentTaskId: idSchema.nullable().optional(),
    search: z.string().optional(),
    sort: taskSortSchema.default("manual"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(TASKS_PAGE_MAX_LIMIT)
      .default(TASKS_PAGE_DEFAULT_LIMIT),
    cursor: nonBlankStringSchema.optional(),
  })
  .strict();

export function canonicalTaskKey(key: string): string {
  const match = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(key.trim());
  return match
    ? `${match[1]!.toUpperCase()}-${Number(match[2])}`
    : key.trim().toUpperCase();
}

export const tasksRpcContract = defineRpcContract({
  createFolder: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({
        name: nonBlankStringSchema,
        parentFolderId: idSchema.nullable().default(null),
      })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  renameFolder: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({ folderId: idSchema, name: nonBlankStringSchema })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  moveFolder: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({ folderId: idSchema, parentFolderId: idSchema.nullable() })
      .strict(),
    output: z.object({ folder: folderSchema }).strict(),
  },
  deleteFolder: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z.object({ folderId: idSchema }).strict(),
    output: z
      .object({
        deleted: z.boolean(),
        movedProjectIds: z.array(idSchema),
        movedFolderIds: z.array(idSchema),
      })
      .strict(),
  },
  listFolders: {
    tags: () => ["folders"],
    input: z.null(),
    output: z.object({ folders: z.array(folderSchema) }).strict(),
  },
  createProject: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({
        name: nonBlankStringSchema,
        prefix: projectPrefixSchema,
        color: nonBlankStringSchema,
        folderId: idSchema.nullable().default(null),
        linkedBbProjectId: z
          .string()
          .startsWith("proj_")
          .nullable()
          .default(null),
      })
      .strict(),
    output: z.object({ project: projectSchema }).strict(),
  },
  updateProject: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: updateProjectInputSchema,
    output: z.object({ project: projectSchema }).strict(),
  },
  renameProjectPrefix: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({ projectId: idSchema, prefix: projectPrefixSchema })
      .strict(),
    output: projectMutationResultSchema,
  },
  deleteProject: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({ projectId: idSchema, force: z.boolean().default(false) })
      .strict(),
    output: projectDeleteResultSchema,
  },
  listProjects: {
    tags: () => ["projects"],
    input: z.object({ folderId: idSchema.nullable().optional() }).strict(),
    output: z.object({ projects: z.array(projectSchema) }).strict(),
  },
  createTask: {
    invalidates: (_input, output) => [
      ...taskRowTags(output.task),
      ...taskMembershipTags(output.task),
    ],
    input: z
      .object({
        projectId: idSchema,
        title: nonBlankStringSchema,
        description: z.string().default(""),
        status: taskStatusSchema.default("backlog"),
        priority: taskPrioritySchema.default("none"),
        dueDate: dueDateSchema.nullable().default(null),
        parentTaskId: idSchema.nullable().default(null),
        labelIds: taskLabelsSchema.default([]),
      })
      .strict(),
    output: taskMutationResultSchema,
  },
  taskMembership: {
    input: taskListInputSchema.omit({ limit: true, cursor: true, sort: true }),
    output: z.object({
      keys: z.array(idSchema),
      openCount: z.number().int().nonnegative(),
    }),
    tags: (input) => {
      const scope = input.parentTaskId
        ? `subtasks:${input.parentTaskId}`
        : `membership:${input.projectId ?? "all"}`;
      return [
        scope,
        ...(input.activeOnly ? ["active-membership"] : []),
        ...(input.search?.trim() ? [`${scope}:search`, "task-keys"] : []),
        ...(input.statuses ? [`${scope}:status`] : []),
        ...(input.priorities ? [`${scope}:priority`] : []),
        ...(input.labelIds ? [`${scope}:labels`] : []),
      ];
    },
  },
  getTasksKeyed: {
    input: z.object({ keys: z.array(idSchema).max(1000) }),
    output: z.record(
      z.string(),
      taskSchema.omit({ description: true }).nullable(),
    ),
    keyTags: (key, task) => [
      `task:${key}`,
      ...(task ? [`task-project:${task.projectId}`] : []),
    ],
  },
  getLabelsKeyed: {
    input: z.object({ keys: z.array(idSchema).max(1000) }),
    output: z.record(z.string(), z.array(labelSchema)),
    keyTags: (key) => [`project:${key}`, "labels"],
  },
  getTaskThreadsKeyed: {
    input: z.object({ keys: z.array(idSchema).max(1000) }),
    output: z.record(z.string(), z.array(taskThreadSchema)),
    keyTags: (key) => [`threads:${key}`],
  },
  getTaskAttachmentsKeyed: {
    input: z.object({ keys: z.array(idSchema).max(1000) }),
    output: z.record(z.string(), z.array(attachmentSchema)),
    keyTags: (key) => [`attachments:${key}`],
  },
  getTask: {
    tags: (input, output) => [
      `task:${input.taskId}`,
      ...(output.task ? [`task-project:${output.task.projectId}`] : []),
    ],
    input: z.object({ taskId: idSchema }).strict(),
    output: z.object({ task: taskSchema.nullable() }).strict(),
  },
  getTaskByKey: {
    tags: (input, output) => [
      `task-key:${canonicalTaskKey(input.taskKey)}`,
      "task-keys",
      ...(output.task
        ? [`task:${output.task.id}`, `task-project:${output.task.projectId}`]
        : []),
    ],
    input: z.object({ taskKey: nonBlankStringSchema }).strict(),
    output: z.object({ task: taskSchema.nullable() }).strict(),
  },
  updateTask: {
    invalidates: (input, output) => [
      ...taskRowTags(output.task),
      `comments:${input.taskId}`,
      ...(input.parentTaskId !== undefined
        ? taskMembershipTags(output.task)
        : []),
      ...membershipEditTags(output.task, input),
    ],
    input: updateTaskInputSchema,
    output: taskMutationResultSchema,
  },
  deleteTask: {
    invalidates: (input) => [
      `task:${input.taskId}`,
      "sidebar",
      "membership:all",
    ],
    input: z.object({ taskId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listTasks: {
    tags: (input) => [`task-list:${input.projectId ?? "all"}`],
    input: taskListInputSchema,
    output: z
      .object({
        tasks: z.array(taskSchema),
        nextCursor: z.string().nullable(),
      })
      .strict(),
  },
  boardMove: {
    invalidates: (input, output) => [
      ...taskRowTags(output.task),
      `comments:${input.taskId}`,
      ...membershipEditTags(output.task, { status: input.status }),
    ],
    input: z
      .object({
        taskId: idSchema,
        status: taskStatusSchema,
        beforeTaskId: idSchema.nullable().optional(),
        afterTaskId: idSchema.nullable().optional(),
        authorName: nonBlankStringSchema.default("You"),
      })
      .strict(),
    output: taskMutationResultSchema,
  },
  moveTaskToProject: {
    invalidates: (_input, output) => [
      ...taskRowTags(output.task),
      ...taskMembershipTags(output.task),
      "projects",
    ],
    input: z
      .object({
        taskId: idSchema,
        projectId: idSchema,
        authorName: nonBlankStringSchema.default("You"),
      })
      .strict(),
    output: taskMutationResultSchema,
  },
  createLabel: {
    invalidates: (_input, output) => [
      `project:${output.label.projectId}`,
      "projects",
    ],
    input: z
      .object({
        projectId: idSchema,
        name: nonBlankStringSchema,
        color: nonBlankStringSchema,
      })
      .strict(),
    output: z.object({ label: labelSchema }).strict(),
  },
  updateLabel: {
    invalidates: (_input, output) => [
      `project:${output.label.projectId}`,
      "projects",
    ],
    input: updateLabelInputSchema,
    output: z.object({ label: labelSchema }).strict(),
  },
  deleteLabel: {
    invalidates: () => ["labels", "projects"],
    input: z.object({ labelId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listLabels: {
    tags: (input) => [`project:${input.projectId}`, "labels"],
    input: z.object({ projectId: idSchema }).strict(),
    output: z.object({ labels: z.array(labelSchema) }).strict(),
  },
  createComment: {
    invalidates: (input) => [
      `comments:${input.taskId}`,
      `attachments:${input.taskId}`,
    ],
    input: z
      .object({
        taskId: idSchema,
        body: z.string(),
        notify: z.boolean(),
        allowEmptyBody: z.boolean().default(false),
      })
      .strict()
      .refine((input) => input.allowEmptyBody || input.body.trim().length > 0, {
        path: ["body"],
        message: "Comment body cannot be empty",
      }),
    output: z.object({ comment: commentSchema }).strict(),
  },
  listComments: {
    tags: (input) => [
      `comments:${input.taskId}`,
      `attachments:${input.taskId}`,
    ],
    input: z.object({ taskId: idSchema }).strict(),
    output: z
      .object({
        comments: z.array(displayCommentSchema),
        attachments: z.array(attachmentSchema),
      })
      .strict(),
  },
  listAttachments: {
    tags: (input) => [
      "taskId" in input
        ? `attachments:${input.taskId}`
        : "commentsOfTaskId" in input
          ? `attachments:${input.commentsOfTaskId}`
          : `comment-attachments:${input.commentId}`,
    ],
    input: z.union([
      z.object({ taskId: idSchema }).strict(),
      z.object({ commentId: idSchema }).strict(),
      z.object({ commentsOfTaskId: idSchema }).strict(),
    ]),
    output: z.object({ attachments: z.array(attachmentSchema) }).strict(),
  },
  deleteAttachment: {
    invalidates: (_input, output) =>
      output.attachment
        ? [
            output.attachment.taskId
              ? `attachments:${output.attachment.taskId}`
              : `comment-attachments:${output.attachment.commentId}`,
          ]
        : [],
    input: z
      .object({
        attachmentId: idSchema,
        removeDescriptionReferences: z.boolean().default(false),
      })
      .strict(),
    output: attachmentDeleteResultSchema,
  },
  listTaskThreads: {
    tags: (input) => [`threads:${input.taskId}`],
    input: z.object({ taskId: idSchema }).strict(),
    output: z.object({ taskThreads: z.array(taskThreadSchema) }).strict(),
  },
  listTaskPullRequests: {
    tags: (input) => [`prs:${input.taskId}`],
    input: z.object({ taskId: idSchema }).strict(),
    output: z
      .object({
        pullRequests: z.array(taskPullRequestSchema),
        unavailableThreadIds: z.array(z.string().startsWith("thr_")),
      })
      .strict(),
  },
  createPreset: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z
      .object({
        name: nonBlankStringSchema,
        providerId: nonBlankStringSchema,
        modelId: nonBlankStringSchema,
        reasoningLevel: presetReasoningLevelSchema,
        serviceTier: presetServiceTierSchema.nullable().default(null),
        permissionMode: presetPermissionModeSchema,
        environmentKind: presetEnvironmentKindSchema.default("project-default"),
        baseBranch: nullablePresetTargetSchema.default(null),
        machineId: nullablePresetTargetSchema.default(null),
        instructions: z.string().default(""),
      })
      .strict()
      .superRefine((input, ctx) => {
        if (
          input.environmentKind === "project-default" &&
          input.baseBranch !== null
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["baseBranch"],
            message: "requires environmentKind new-worktree",
          });
        }
        if (
          input.environmentKind === "project-default" &&
          input.machineId !== null
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["machineId"],
            message: "requires environmentKind new-worktree",
          });
        }
      }),
    output: z.object({ preset: presetSchema }).strict(),
  },
  updatePreset: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: updatePresetInputSchema,
    output: z.object({ preset: presetSchema }).strict(),
  },
  deletePreset: {
    invalidates: () => [
      "projects",
      "folders",
      "presets",
      "sidebar",
      "task-keys",
    ],
    input: z.object({ presetId: idSchema }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  listPresets: {
    tags: () => ["presets"],
    input: z.null(),
    output: z.object({ presets: z.array(presetSchema) }).strict(),
  },
  listMachines: {
    tags: () => ["machines"],
    input: z.object({}).strict(),
    output: z
      .object({
        machines: z.array(
          z.object({ id: z.string(), name: z.string() }).strict(),
        ),
      })
      .strict(),
  },
  searchThreads: {
    input: z
      .object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
      })
      .strict(),
    output: z
      .object({
        threads: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              status: threadSearchStatusSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  },
  listBbProjects: {
    tags: () => ["projects"],
    input: z.null(),
    output: z
      .object({
        bbProjects: z.array(
          z
            .object({ id: z.string().startsWith("proj_"), name: z.string() })
            .strict(),
        ),
      })
      .strict(),
  },
  sidebarOpenTaskCount: {
    tags: () => ["sidebar"],
    input: z.null(),
    output: z
      .object({ openTaskCount: z.number().int().nonnegative() })
      .strict(),
  },
  sidebarSummary: {
    tags: () => ["sidebar"],
    input: z.null(),
    output: z
      .object({
        projects: z.array(
          z
            .object({
              projectId: idSchema,
              taskCount: z.number().int().nonnegative(),
              activeAgentCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
});

export type TasksRpcContract = typeof tasksRpcContract;
export type Folder = z.infer<typeof folderSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskSummary = Omit<Task, "description">;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type Label = z.infer<typeof labelSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type CommentProvider = z.infer<typeof commentProviderSchema>;
export type DisplayComment = z.infer<typeof displayCommentSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type TaskThread = z.infer<typeof taskThreadSchema>;
export type TaskPullRequest = z.infer<typeof taskPullRequestSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type TaskMutationResult = z.infer<typeof taskMutationResultSchema>;
export type BbProjectOption = z.infer<
  (typeof tasksRpcContract)["listBbProjects"]["output"]
>["bbProjects"][number];
export type SidebarProjectSummary = z.infer<
  (typeof tasksRpcContract)["sidebarSummary"]["output"]
>["projects"][number];

export function taskRowTags(
  task: Pick<Task, "id" | "projectId" | "key">,
): [string, ...string[]] {
  return [
    `task:${task.id}`,
    `task-key:${canonicalTaskKey(task.key)}`,
    `task-list:${task.projectId}`,
    "task-list:all",
    "sidebar",
  ];
}
export function taskMembershipTags(
  task: Pick<Task, "projectId" | "parentTaskId">,
): string[] {
  return [
    `membership:${task.projectId}`,
    "membership:all",
    ...(task.parentTaskId ? [`subtasks:${task.parentTaskId}`] : []),
  ];
}
function membershipEditTags(
  task: Task,
  input: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    labelIds?: string[];
  },
): string[] {
  const fields = [
    input.title !== undefined || input.description !== undefined
      ? "search"
      : null,
    input.status !== undefined ? "status" : null,
    input.priority !== undefined ? "priority" : null,
    input.labelIds !== undefined ? "labels" : null,
  ].filter((field) => field !== null);
  return taskMembershipTags(task).flatMap((scope) =>
    fields.map((field) => `${scope}:${field}`),
  );
}
