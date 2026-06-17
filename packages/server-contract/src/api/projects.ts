import { z } from "zod";
import {
  FILE_LIST_QUERY_MAX_LENGTH,
  getProjectPathValidationMessage,
  gitBranchNameSchema,
  normalizeProjectPathInput,
  projectExecutionDefaultsSchema,
  projectSchema,
  projectSourceCheckoutSchema,
  projectSourceSchema,
  promptHistoryEntrySchema,
  threadListEntrySchema,
} from "@bb/domain";
import {
  branchListQuerySchema,
  isCommaSeparatedIncludeQueryValue,
  pathListIncludeQueryValueSchema,
} from "./shared.js";

const localProjectPathRequestSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeProjectPathInput)
  .superRefine((path, ctx) => {
    const validationMessage = getProjectPathValidationMessage(path);
    if (!validationMessage) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validationMessage,
    });
  });

const createLocalPathProjectSourceRequestSchema = z
  .object({
    hostId: z.string().min(1),
    type: z.literal("local_path"),
    path: localProjectPathRequestSchema,
  })
  .strict();

export const createProjectSourceRequestSchema =
  createLocalPathProjectSourceRequestSchema;
export type CreateProjectSourceRequest = z.infer<
  typeof createProjectSourceRequestSchema
>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  source: createProjectSourceRequestSchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const reorderProjectRequestSchema = z.object({
  previousProjectId: z.string().min(1).nullable(),
  nextProjectId: z.string().min(1).nullable(),
});
export type ReorderProjectRequest = z.infer<typeof reorderProjectRequestSchema>;

export const projectListIncludeOptionSchema = z.enum(["threads"]);
export type ProjectListIncludeOption = z.infer<
  typeof projectListIncludeOptionSchema
>;

export const projectListQuerySchema = z.object({
  include: z
    .string()
    .min(1)
    .refine(
      (value) =>
        isCommaSeparatedIncludeQueryValue({
          allowedValues: projectListIncludeOptionSchema.options,
          value,
        }),
      { message: "Invalid include" },
    )
    .optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectFilesQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  /**
   * Required + nullable. Pass an environment id to scope the file list to that
   * environment's workspace (e.g. a worktree); pass `null` to use the project's
   * default source. Encoded as the empty string on the wire because URL query
   * params can't represent JSON null directly.
   */
  environmentId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().min(1).nullable(),
  ),
});
export type ProjectFilesQuery = z.infer<typeof projectFilesQuerySchema>;

export const projectPathsQuerySchema = projectFilesQuerySchema.extend({
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type ProjectPathsQuery = z.infer<typeof projectPathsQuerySchema>;

export const projectBranchesQuerySchema = branchListQuerySchema.extend({
  hostId: z.string().min(1),
  selectedBranch: gitBranchNameSchema.optional(),
});
export type ProjectBranchesQuery = z.infer<typeof projectBranchesQuerySchema>;

export const projectBranchesResponseSchema = projectSourceCheckoutSchema.extend(
  {
    defaultWorktreeBaseBranch: z.string().min(1).nullable(),
  },
);
export type ProjectBranchesResponse = z.infer<
  typeof projectBranchesResponseSchema
>;

export const projectAttachmentContentQuerySchema = z.object({
  path: z.string().min(1),
});
export type ProjectAttachmentContentQuery = z.infer<
  typeof projectAttachmentContentQuerySchema
>;

export const projectDefaultExecutionOptionsQuerySchema = z.object({});
export type ProjectDefaultExecutionOptionsQuery = z.infer<
  typeof projectDefaultExecutionOptionsQuerySchema
>;

export const promptHistoryQuerySchema = z
  .object({
    limit: z.string().regex(/^\d+$/),
  })
  .partial();
export type PromptHistoryQuery = z.infer<typeof promptHistoryQuerySchema>;

export const promptHistoryResponseSchema = z.array(promptHistoryEntrySchema);
export type PromptHistoryResponse = z.infer<typeof promptHistoryResponseSchema>;

export interface ProjectAttachmentUploadForm {
  [key: string]: string | Blob;
}

export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1),
  })
  .partial()
  .refine(
    (value) => value.name !== undefined,
    "At least one field must be provided",
  );
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const updateProjectSourceRequestSchema = z
  .object({
    type: z.literal("local_path"),
    path: localProjectPathRequestSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => value.path !== undefined || value.isDefault !== undefined,
    "At least one field besides type must be provided",
  );
export type UpdateProjectSourceRequest = z.infer<
  typeof updateProjectSourceRequestSchema
>;

/** `command` = Claude Code legacy slash command (`.claude/commands/*.md`). */
export const providerCommandSourceSchema = z.enum(["skill", "command"]);
export type ProviderCommandSource = z.infer<typeof providerCommandSourceSchema>;

export const providerCommandOriginSchema = z.enum(["project", "user"]);
export type ProviderCommandOrigin = z.infer<typeof providerCommandOriginSchema>;

export const providerCommandSchema = z.object({
  /** Invocation name, e.g. "review" or "frontend:component". */
  name: z.string(),
  source: providerCommandSourceSchema,
  origin: providerCommandOriginSchema,
  /** `null` = no description (menu falls back to the name). */
  description: z.string().nullable(),
  /** `null` = no argument hint. */
  argumentHint: z.string().nullable(),
});
export type ProviderCommand = z.infer<typeof providerCommandSchema>;

/**
 * The command typeahead menu's visual sections, top-to-bottom: skills first,
 * then Claude Code's legacy project commands, then user commands. This single
 * ordered list is the one source of truth for both the server's flat sort
 * (which buckets the response in this order) and the composer menu's section
 * grouping, so keyboard navigation (which walks the flat order) can never
 * disagree with what the user sees.
 */
export const PROVIDER_COMMAND_SECTIONS = [
  "skill",
  "project-command",
  "user-command",
] as const;
export type ProviderCommandSection = (typeof PROVIDER_COMMAND_SECTIONS)[number];

/**
 * Derive the menu section a command belongs to from its source + origin:
 * `skill` source → the skills section; otherwise the legacy `command` source
 * splits by origin into the project- and user-command sections.
 */
export function providerCommandSection(cmd: {
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
}): ProviderCommandSection {
  if (cmd.source === "skill") {
    return "skill";
  }
  return cmd.origin === "project" ? "project-command" : "user-command";
}

/**
 * Section rank used as the primary sort key for the command-list response, so
 * the flat order is grouped in {@link PROVIDER_COMMAND_SECTIONS} order. Lower
 * ranks sort first.
 */
export function providerCommandSectionRank(cmd: {
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
}): number {
  return PROVIDER_COMMAND_SECTIONS.indexOf(providerCommandSection(cmd));
}

export const commandListResponseSchema = z.object({
  commands: z.array(providerCommandSchema),
  truncated: z.boolean(),
});
export type CommandListResponse = z.infer<typeof commandListResponseSchema>;

/**
 * Command typeahead query. Extends the shared project file-search query
 * (`query`/`limit`/`environmentId`, including the empty-string→null wire
 * convention) with the `provider` whose skill/command surface to discover.
 * `query` here is a case-insensitive substring filter on command name/description.
 * Namespaced skills also match on their local name after `:` (for example,
 * `review` matches `ottonomous:review`).
 */
export const projectCommandsQuerySchema = projectFilesQuerySchema.extend({
  /** Provider whose command/skill surface to discover (e.g. `claude-code`, `codex`). */
  provider: z.string().min(1),
  offset: z.string().regex(/^\d+$/).optional(),
});
export type ProjectCommandsQuery = z.infer<typeof projectCommandsQuerySchema>;

export const projectResponseSchema = projectSchema.extend({
  sources: z.array(projectSourceSchema),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectWithThreadsResponseSchema = projectResponseSchema.extend({
  threads: z.array(threadListEntrySchema),
  /**
   * Resolved provider/model/reasoning/permission/tier defaults for creating a
   * root thread in this project. Inlined so the new-thread composer can render
   * exactly what the server will use without a second round-trip per visit.
   * `null` means the server cannot form concrete defaults for the current
   * policy/provider combination.
   */
  defaultExecutionOptions: projectExecutionDefaultsSchema.nullable(),
});
export type ProjectWithThreadsResponse = z.infer<
  typeof projectWithThreadsResponseSchema
>;

export const sidebarBootstrapResponseSchema = z.object({
  projects: z.array(projectWithThreadsResponseSchema),
  personalProject: projectWithThreadsResponseSchema,
});
export type SidebarBootstrapResponse = z.infer<
  typeof sidebarBootstrapResponseSchema
>;

export const uploadedPromptAttachmentSchema = z.object({
  type: z.enum(["localImage", "localFile"]),
  path: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number(),
});
export type UploadedPromptAttachment = z.infer<
  typeof uploadedPromptAttachmentSchema
>;
