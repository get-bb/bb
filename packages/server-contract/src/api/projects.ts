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

const cloneProjectSourceRequestSchema = z
  .object({
    hostId: z.string().min(1),
    type: z.literal("clone"),
    targetPath: localProjectPathRequestSchema.optional(),
    remoteUrl: z.string().trim().min(1).optional(),
  })
  .strict();

export const createProjectSourceRequestSchema = z.discriminatedUnion("type", [
  createLocalPathProjectSourceRequestSchema,
  cloneProjectSourceRequestSchema,
]);
export type CreateProjectSourceRequest = z.infer<
  typeof createProjectSourceRequestSchema
>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  source: createLocalPathProjectSourceRequestSchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const threadSectionSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type ThreadSectionResponse = z.infer<typeof threadSectionSchema>;

export const createThreadSectionRequestSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();
export type CreateThreadSectionRequest = z.infer<
  typeof createThreadSectionRequestSchema
>;

export const updateThreadSectionRequestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type UpdateThreadSectionRequest = z.infer<
  typeof updateThreadSectionRequestSchema
>;

export const deleteThreadSectionRequestSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type DeleteThreadSectionRequest = z.infer<
  typeof deleteThreadSectionRequestSchema
>;

export const threadSectionMutationResponseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    updatedThreadCount: z.number().int().nonnegative(),
  })
  .strict();
export type ThreadSectionMutationResponse = z.infer<
  typeof threadSectionMutationResponseSchema
>;

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
  /** Include the singleton personal project; omitted preserves ordinary-only listing. */
  includePersonal: z.enum(["true", "false"]).optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

const projectWorkspaceRoutingFields = {
  hostId: z.string().min(1),
  environmentId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
} as const;

function rejectMultipleProjectWorkspaceSelectors(
  query: { environmentId?: string; hostId?: string },
  context: z.RefinementCtx,
): void {
  if (query.environmentId !== undefined && query.hostId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "hostId and environmentId are mutually exclusive",
    });
  }
}

/**
 * Route project workspace discovery through an environment's workspace or an
 * explicit project source host. Omitting both intentionally falls back to the
 * primary host's project source.
 */
export const projectWorkspaceRoutingQuerySchema = z
  .object(projectWorkspaceRoutingFields)
  .partial()
  .superRefine(rejectMultipleProjectWorkspaceSelectors);
export type ProjectWorkspaceRoutingQuery = z.infer<
  typeof projectWorkspaceRoutingQuerySchema
>;

export const projectFilesQuerySchema = z
  .object({
    ...projectWorkspaceRoutingFields,
    query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  })
  .partial()
  .superRefine(rejectMultipleProjectWorkspaceSelectors);
export type ProjectFilesQuery = z.infer<typeof projectFilesQuerySchema>;

export const projectPathsQuerySchema = z
  .object({
    ...projectWorkspaceRoutingFields,
    query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    includeFiles: pathListIncludeQueryValueSchema,
    includeDirectories: pathListIncludeQueryValueSchema,
  })
  .partial({
    hostId: true,
    environmentId: true,
    query: true,
    limit: true,
  })
  .superRefine(rejectMultipleProjectWorkspaceSelectors);
export type ProjectPathsQuery = z.infer<typeof projectPathsQuerySchema>;

export const projectFileContentQuerySchema = z
  .object({
    ...projectWorkspaceRoutingFields,
    path: z.string().min(1),
  })
  .partial({ hostId: true, environmentId: true })
  .superRefine(rejectMultipleProjectWorkspaceSelectors);
export type ProjectFileContentQuery = z.infer<
  typeof projectFileContentQuerySchema
>;

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

export type ProjectAttachmentUploadForm = Record<"file", Blob>;

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

export const providerCommandOriginSchema = z.enum([
  "builtin",
  "project",
  "user",
]);
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
  /** Present when this skill is contributed by a running bb plugin. */
  pluginId: z.string().min(1).optional(),
});
export type ProviderCommand = z.infer<typeof providerCommandSchema>;

/**
 * The command typeahead menu's visual sections, top-to-bottom: built-in agent
 * commands, skills, Claude Code's legacy project commands, then user commands.
 * This single ordered list is the one source of truth for both the server's
 * flat sort (which buckets the response in this order) and the composer menu's
 * section grouping, so keyboard navigation (which walks the flat order) can
 * never disagree with what the user sees.
 */
export const PROVIDER_COMMAND_SECTIONS = [
  "agent-command",
  "skill",
  "project-command",
  "user-command",
] as const;
export type ProviderCommandSection = (typeof PROVIDER_COMMAND_SECTIONS)[number];

/**
 * Derive the menu section a command belongs to from its source + origin.
 */
export function providerCommandSection(cmd: {
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
}): ProviderCommandSection {
  if (cmd.origin === "builtin") {
    return "agent-command";
  }
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
});
export type CommandListResponse = z.infer<typeof commandListResponseSchema>;

/** Query for the complete command catalog available to a project and provider. */
export const projectCommandsQuerySchema = z
  .object({
    ...projectWorkspaceRoutingFields,
    /** Provider whose command/skill surface to discover (e.g. `claude-code`, `codex`). */
    provider: z.string().min(1),
  })
  .partial({ hostId: true, environmentId: true })
  .strict()
  .superRefine(rejectMultipleProjectWorkspaceSelectors);
export type ProjectCommandsQuery = z.infer<typeof projectCommandsQuerySchema>;

/**
 * Product scope of a discovered skill, derived server-side from the daemon's raw
 * `(provider, rootKind)`. bb scopes are provider-agnostic; provider-owned
 * skills retain project/user scope as presentation metadata; `plugin` covers
 * skills bundled by either a bb plugin or a provider plugin. The opaque
 * `SkillSummary.id` is the only
 * server-resolvable identity.
 */
export const skillScopeSchema = z.enum([
  "bb-builtin",
  "bb-user",
  "bb-project",
  /**
   * A provider-owned root. Which provider is the sibling `provider` field —
   * these used to be six per-provider members (`claude-user`, `codex-project`,
   * …), which made the scope a closed vocabulary that no plugin provider could
   * ever join even though the daemon only ever distinguished user vs project.
   */
  "provider-user",
  "provider-project",
  "shared-user",
  "shared-project",
  "plugin",
]);
export type SkillScope = z.infer<typeof skillScopeSchema>;

/**
 * Command-surface provider a skill is discovered under: any provider id, so a
 * plugin provider's skill surface is expressible.
 */
export const skillProviderSchema = z.string().min(1);
export type SkillProvider = z.infer<typeof skillProviderSchema>;

/** Opaque, deterministic identity issued by authoritative host discovery. */
export const installedSkillIdSchema = z.string().regex(/^skill_[a-f0-9]{64}$/u);
export type InstalledSkillId = z.infer<typeof installedSkillIdSchema>;

/** SHA-256 of the exact bytes read from SKILL.md. */
export const skillRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export type SkillRevision = z.infer<typeof skillRevisionSchema>;

export const skillSummarySchema = z.object({
  id: installedSkillIdSchema,
  /** Invocation name (parent dir / frontmatter `name`). */
  name: z.string(),
  description: z.string().nullable(),
  /**
   * `null` for provider-agnostic bb scopes — a bb skill is discovered under both
   * providers, so it is listed once with `provider: null` (de-duped on path).
   */
  provider: skillProviderSchema.nullable(),
  scope: skillScopeSchema,
  /** Owning plugin id for bundled skills; `null` for every other scope. */
  pluginId: z.string().min(1).nullable(),
  /** Absolute path to the SKILL.md. */
  filePath: z.string(),
  /** `true` when the skill is user-owned and its full lifecycle is manageable. */
  manageable: z.boolean(),
  /** Exact registry entry that installed this skill; `null` for every other source. */
  registrySkillId: z.string().min(1).nullable(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const skillListResponseSchema = z.object({
  skills: z.array(skillSummarySchema),
});
export type SkillListResponse = z.infer<typeof skillListResponseSchema>;

/** Skills listing is project-level; only the workspace needs scoping. */
export const projectSkillsQuerySchema = z.object({
  /**
   * Required + nullable, mirroring {@link projectFilesQuerySchema}: an
   * environment id scopes discovery to that workspace; `null` (empty string on
   * the wire) uses the project's default source.
   */
  environmentId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().min(1).nullable(),
  ),
});
export type ProjectSkillsQuery = z.infer<typeof projectSkillsQuerySchema>;

/** Local skill scopes whose SKILL.md can be edited safely in bb. */
export const editableSkillScopeSchema = z.enum([
  "bb-user",
  "bb-project",
  "provider-user",
  "provider-project",
]);
export type EditableSkillScope = z.infer<typeof editableSkillScopeSchema>;

/** User-owned local scopes that can be deleted after server-side resolution. */
export const deletableSkillScopeSchema = editableSkillScopeSchema;
export type DeletableSkillScope = z.infer<typeof deletableSkillScopeSchema>;

export const deleteSkillRequestSchema = z
  .object({
    skillId: installedSkillIdSchema,
    /**
     * Workspace used to discover project-local skills; `null` uses the
     * project's default source. The server resolves the authoritative skill
     * path — a client `filePath` is never accepted.
     */
    environmentId: z.string().min(1).nullable(),
  })
  .strict();
export type DeleteSkillRequest = z.infer<typeof deleteSkillRequestSchema>;

/** Resolve a skill identity server-side before listing or reading its files. */
export const projectSkillFilesQuerySchema = z.object({
  skillId: installedSkillIdSchema,
  environmentId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().min(1).nullable(),
  ),
});
export type ProjectSkillFilesQuery = z.infer<
  typeof projectSkillFilesQuerySchema
>;

export const projectSkillContentQuerySchema =
  projectSkillFilesQuerySchema.extend({
    path: z.string().min(1).max(4_096),
  });
export type ProjectSkillContentQuery = z.infer<
  typeof projectSkillContentQuerySchema
>;

export const skillContentResponseSchema = z.object({
  content: z.string(),
  revision: skillRevisionSchema,
});
export type SkillContentResponse = z.infer<typeof skillContentResponseSchema>;

export const skillFilesResponseSchema = z.object({
  files: z.array(z.string().min(1)),
  truncated: z.boolean(),
});
export type SkillFilesResponse = z.infer<typeof skillFilesResponseSchema>;

/** Edit a writable local skill's SKILL.md. */
export const updateSkillRequestSchema = z
  .object({
    skillId: installedSkillIdSchema,
    environmentId: z.string().min(1).nullable(),
    content: z.string().min(1).max(1_000_000),
    revision: skillRevisionSchema,
  })
  .strict();
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

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
  sections: z.array(threadSectionSchema),
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

export const copyProjectAttachmentsRequestSchema = z
  .object({
    sourceProjectId: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();
export type CopyProjectAttachmentsRequest = z.infer<
  typeof copyProjectAttachmentsRequestSchema
>;
