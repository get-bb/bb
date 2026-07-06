import {
  availableModelSchema,
  discoveredWorkspacePropertiesSchema,
  dynamicToolSchema,
  instructionModeSchema,
  pendingInteractionResolutionSchema,
  promptInputSchema,
  projectSourceCheckoutSchema,
  threadGitDiffResponseSchema,
  workspaceProvisionTypeSchema,
  runtimeThreadExecutionOptionsSchema,
  provisioningTranscriptEntrySchema,
  rawDiffFileStatSchema,
  workspaceDiffTargetSchema,
  workspaceStatusSchema,
  gitHostPullRequestSchema,
  clientTurnRequestIdSchema,
  gitBranchNameSchema,
  jsonObjectSchema,
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
import { z } from "zod";
import {
  pathsExistRequestSchema,
  pathsExistResponseSchema,
  pickFolderResponseSchema,
  providerCliInstallEventSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema,
} from "./local.js";

export const HOST_DAEMON_PROTOCOL_VERSION = 45 as const;

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
const INJECTED_SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export const workspaceContextSchema = z.object({
  workspacePath: z.string().min(1),
  workspaceProvisionType: workspaceProvisionTypeSchema,
});
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

export const workspaceResolutionFailureCodeSchema = z.enum([
  "path_not_found",
  "not_git_repo",
  "not_worktree",
  "workspace_type_mismatch",
  "permission_denied",
  "unknown_environment",
  "unknown",
]);
export const workspaceResolutionFailureSchema = z
  .object({
    code: workspaceResolutionFailureCodeSchema,
    workspacePath: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type WorkspaceResolutionFailureCode = z.infer<
  typeof workspaceResolutionFailureCodeSchema
>;
export type WorkspaceResolutionFailure = z.infer<
  typeof workspaceResolutionFailureSchema
>;

const hostDaemonThreadTargetSchema = z
  .object({
    environmentId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();

const hostDaemonInjectedSkillSourceBaseSchema = z
  .object({
    name: z.string().max(64).regex(INJECTED_SKILL_NAME_PATTERN),
    description: z.string().min(1).max(1024),
    sourceRootPath: z.string().min(1),
    skillFilePath: z.string().min(1),
  })
  .strict();

export const hostDaemonInjectedSkillSourceSchema = z.discriminatedUnion(
  "sourceType",
  [
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        sourceType: z.literal("builtin"),
      })
      .strict(),
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        sourceType: z.literal("data-dir"),
      })
      .strict(),
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        sourceType: z.literal("project"),
      })
      .strict(),
  ],
);
export type HostDaemonInjectedSkillSource = z.infer<
  typeof hostDaemonInjectedSkillSourceSchema
>;

export const hostDaemonAcpLaunchSpecSchema = z
  .object({
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string().min(1), z.string()),
    cwd: z.string().min(1).optional(),
    modelCli: z
      .object({
        listArgs: z.array(z.string()),
        selectFlag: z.string().min(1).optional(),
        primaryModels: z.array(z.string()),
      })
      .strict()
      .transform((modelCli) =>
        modelCli.listArgs.length > 0 ? modelCli : undefined,
      )
      .optional(),
  })
  .strict();
export type HostDaemonAcpLaunchSpec = z.infer<
  typeof hostDaemonAcpLaunchSpecSchema
>;

const hostDaemonThreadRuntimeContextSchema = z
  .object({
    workspaceContext: workspaceContextSchema,
    projectId: z.string().min(1),
    providerId: z.string().min(1),
    acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
    options: runtimeThreadExecutionOptionsSchema,
    instructions: z.string().min(1),
    dynamicTools: z.array(dynamicToolSchema),
    injectedSkillSources: z.array(hostDaemonInjectedSkillSourceSchema),
    disallowedTools: z.array(z.string()).optional(),
    instructionMode: instructionModeSchema,
  })
  .strict();

const hostDaemonExistingThreadRuntimeContextSchema =
  hostDaemonThreadRuntimeContextSchema.extend({
    providerThreadId: z.string().min(1),
  });

const turnResumeContextSchema =
  hostDaemonExistingThreadRuntimeContextSchema.omit({
    options: true,
  });

const hostDaemonEnvironmentTargetSchema = z
  .object({
    environmentId: z.string().min(1),
  })
  .strict();

const hostDaemonWorkspaceTargetSchema =
  hostDaemonEnvironmentTargetSchema.extend({
    workspaceContext: workspaceContextSchema,
  });

const hostDaemonThreadWorkspaceTargetSchema =
  hostDaemonThreadTargetSchema.extend({
    workspaceContext: workspaceContextSchema,
  });

type HostDaemonPromptInput = z.infer<typeof promptInputSchema>;

interface GroupedPromptInputCommand {
  input: HostDaemonPromptInput[];
  inputGroups?: HostDaemonPromptInput[][];
}

function flattenPromptInputGroups(
  inputGroups: readonly HostDaemonPromptInput[][],
): HostDaemonPromptInput[] {
  return inputGroups.flatMap((inputGroup, index) =>
    index === 0
      ? inputGroup
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...inputGroup],
  );
}

function refineGroupedInputMatchesFlatInput(
  value: GroupedPromptInputCommand,
  ctx: z.RefinementCtx,
): void {
  if (value.inputGroups === undefined) return;
  if (
    JSON.stringify(value.input) ===
    JSON.stringify(flattenPromptInputGroups(value.inputGroups))
  ) {
    return;
  }

  ctx.addIssue({
    code: "custom",
    message: "input must match the flattened inputGroups",
    path: ["inputGroups"],
  });
}

export const threadStartCommandSchema = hostDaemonThreadTargetSchema
  .merge(hostDaemonThreadRuntimeContextSchema)
  .extend({
    type: z.literal("thread.start"),
    requestId: clientTurnRequestIdSchema,
    // A fork start establishes the cloned provider session with an empty
    // timeline (the runtime's no-input-no-turn guard leaves it idle), so it
    // carries no input. A non-fork start always runs a first turn and requires
    // at least one input, enforced by the refinement below.
    input: z.array(promptInputSchema),
    inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1).optional(),
    threadStoragePath: z.string().min(1).optional(),
    /** Present means fork the new thread from this source provider session
     *  instead of starting fresh; absent means a normal start. */
    fork: z.object({ sourceProviderThreadId: z.string().min(1) }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fork === undefined && value.input.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "input must contain at least one entry",
        path: ["input"],
      });
    }
    refineGroupedInputMatchesFlatInput(value, ctx);
  });

export const turnSubmitTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("start"),
  }),
  z.object({
    mode: z.literal("auto"),
    expectedTurnId: z.string().min(1).nullable(),
  }),
  z.object({
    mode: z.literal("steer"),
    expectedTurnId: z.string().min(1).nullable(),
  }),
]);
export type TurnSubmitTarget = z.infer<typeof turnSubmitTargetSchema>;

/**
 * Submit input for an existing provider thread. The daemon chooses whether
 * auto-targeted input steers the expected active turn or starts a new turn.
 */
const turnSubmitCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("turn.submit"),
    requestId: clientTurnRequestIdSchema,
    input: z.array(promptInputSchema).min(1),
    inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1).optional(),
    options: runtimeThreadExecutionOptionsSchema,
    acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
    resumeContext: turnResumeContextSchema,
    target: turnSubmitTargetSchema,
  })
  .strict()
  .superRefine(refineGroupedInputMatchesFlatInput);

export const threadStopCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.stop"),
  })
  .strict();

const threadRenameCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.rename"),
    title: z.string().min(1),
  })
  .strict();

const threadArchiveCommandSchema = hostDaemonThreadWorkspaceTargetSchema
  .extend({
    type: z.literal("thread.archive"),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
  })
  .strict();

// Carries environmentId (not just threadId) so the host daemon can serialize
// it in the same per-environment write lane as thread.archive; otherwise a
// slower archive can land after a later unarchive and leave the provider
// session archived against the user's intent.
const threadUnarchiveCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.unarchive"),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
  })
  .strict();

const interactiveResolveCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("interactive.resolve"),
    interactionId: z.string().min(1),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
    providerRequestId: z.string().min(1),
    resolution: pendingInteractionResolutionSchema,
  })
  .strict();

const codexInferenceCompleteCommandSchema = z
  .object({
    type: z.literal("codex.inference.complete"),
    model: z.string().min(1),
    prompt: z.string().min(1),
    outputSchema: jsonObjectSchema,
    timeoutMs: z.number().int().positive(),
  })
  .strict();

const codexVoiceTranscribeCommandSchema = z
  .object({
    type: z.literal("codex.voice.transcribe"),
    model: z.string().min(1),
    audioBase64: z.string().min(1),
    mimeType: z.string().min(1),
    filename: z.string().min(1),
    prompt: z.string().nullable(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();

/**
 * Read a file from an absolute host path. When `rootPath` is provided, the
 * daemon enforces that the resolved file stays under that declared absolute
 * root. When `rootPath` is omitted, the daemon reads the explicit absolute
 * disk path without containment-root checks.
 *
 * When `ref` is set, the file is read from git history at that ref instead of
 * from disk. `rootPath` is then interpreted as the repo root, the path becomes
 * a `<repo>/<rel>` join, and the daemon shells `git -C <rootPath> cat-file`.
 * Same caps, same encoding detection, same `file_too_large` behavior — the
 * only difference is the source of bytes. A missing object at `ref` (e.g.
 * the file did not exist at that ref) returns empty content, not an error.
 */
const hostReadFileCommandSchema = z
  .object({
    type: z.literal("host.read_file"),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
  })
  .superRefine((command, context) => {
    if (command.ref !== undefined && command.rootPath === undefined) {
      context.addIssue({
        code: "custom",
        path: ["rootPath"],
        message: "rootPath is required when ref is set",
      });
    }
  });

export const hostReadFileRelativeDotfilePolicySchema = z.enum([
  "allow",
  "deny",
]);
export type HostReadFileRelativeDotfilePolicy = z.infer<
  typeof hostReadFileRelativeDotfilePolicySchema
>;

/**
 * Read a file beneath an absolute root by POSIX-style relative path. The daemon
 * resolves the root and target with realpath, rejects symlink escapes, and can
 * make dot-prefixed path segments indistinguishable from missing files.
 */
const hostReadFileRelativeCommandSchema = z
  .object({
    type: z.literal("host.read_file_relative"),
    rootPath: z.string().min(1),
    path: z.string().min(1),
    dotfiles: hostReadFileRelativeDotfilePolicySchema,
  })
  .strict();

const hostFileMetadataCommandSchema = z
  .object({
    type: z.literal("host.file_metadata"),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
  })
  .strict();

/**
 * Write a file at an absolute host path. Mirrors `host.read_file`'s
 * containment contract: when `rootPath` is provided, the daemon enforces that
 * the resolved target stays under that declared absolute root (following
 * symlinks on the nearest existing ancestor).
 *
 * `expectedSha256` is the optimistic-concurrency guard for read-modify-write
 * callers (editors saving over files agents may also touch):
 * - omitted → unconditional write
 * - a hash  → write only when the current content hashes to it
 * - null    → write only when the file does not exist yet (create)
 * A failed guard is the `conflict` result, not an error, so the caller gets
 * the current hash to re-read against.
 */
const hostWriteFileCommandSchema = z
  .object({
    type: z.literal("host.write_file"),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    content: z.string(),
    contentEncoding: z.enum(["utf8", "base64"]),
    createParents: z.boolean(),
    expectedSha256: z.string().nullable().optional(),
  })
  .strict();

const hostListFilesCommandSchema = z.object({
  type: z.literal("host.list_files"),
  path: z.string().min(1),
  query: z.string().max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX),
});

export const hostPathEntryKindSchema = z.enum(["file", "directory"]);
export type HostPathEntryKind = z.infer<typeof hostPathEntryKindSchema>;

export const hostPathEntrySchema = z.object({
  kind: hostPathEntryKindSchema,
  path: z.string(),
  name: z.string(),
  score: z.number(),
  positions: z.array(z.number().int().nonnegative()),
});
export type HostPathEntry = z.infer<typeof hostPathEntrySchema>;

const hostListPathsCommandSchema = z
  .object({
    type: z.literal("host.list_paths"),
    path: z.string().min(1),
    query: z.string().max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
    limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX),
    includeFiles: z.boolean(),
    includeDirectories: z.boolean(),
  })
  .refine((command) => command.includeFiles || command.includeDirectories, {
    message: "At least one path kind must be included",
  });

// Single-level directory listing for the interactive path browser. Unlike
// `host.list_paths` (a recursive fuzzy-search walk over relative paths), this
// reads exactly one directory and returns absolute child paths so the UI can
// navigate step by step.
const hostBrowseDirectoryCommandSchema = z.object({
  type: z.literal("host.browse_directory"),
  // Absolute directory to list. Omitted means the host's home directory, which
  // the daemon resolves — a remote caller has no way to know the host's home.
  path: z.string().min(1).optional(),
});

const hostPathsExistCommandSchema = pathsExistRequestSchema
  .extend({
    type: z.literal("host.paths_exist"),
  })
  .strict();

const hostPickFolderCommandSchema = z
  .object({
    type: z.literal("host.pick_folder"),
  })
  .strict();

export const directoryEntrySchema = z.object({
  kind: hostPathEntryKindSchema,
  name: z.string(),
  path: z.string(),
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const directoryListingSchema = z.object({
  // Resolved absolute directory that was listed (symlinks already followed).
  directory: z.string(),
  // Absolute parent directory, or null at the filesystem root.
  parent: z.string().nullable(),
  entries: z.array(directoryEntrySchema),
});
export type DirectoryListing = z.infer<typeof directoryListingSchema>;

export const hostCommandSourceSchema = z.enum(["skill", "command"]);
export type HostCommandSource = z.infer<typeof hostCommandSourceSchema>;

export const hostCommandOriginSchema = z.enum(["project", "user"]);
export type HostCommandOrigin = z.infer<typeof hostCommandOriginSchema>;

/**
 * A discovered provider skill or legacy slash command. The daemon returns the
 * raw parsed records; server policy (filter/de-dup/sort/limit) is applied on
 * top. Mirrors `@bb/server-contract`'s `ProviderCommand` shape (the contract
 * packages intentionally define matching record shapes independently, like
 * `hostPathEntrySchema` / `workspacePathEntrySchema`).
 */
export const hostProviderCommandSchema = z.object({
  name: z.string(),
  source: hostCommandSourceSchema,
  origin: hostCommandOriginSchema,
  description: z.string().nullable(),
  argumentHint: z.string().nullable(),
});
export type HostProviderCommand = z.infer<typeof hostProviderCommandSchema>;

/**
 * List the provider's discoverable skills / legacy slash commands. The daemon
 * resolves the user-home roots itself and scans the project roots under `cwd`
 * when provided; `cwd: null` (unprovisioned thread) skips the project roots and
 * returns only user-origin entries. Returns the full raw set — the server owns
 * de-dup/sort/limit, so there is no `truncated` field here.
 */
const hostListCommandsCommandSchema = z.object({
  type: z.literal("host.list_commands"),
  providerId: z.string().min(1),
  cwd: z.string().min(1).nullable(),
  builtinSkillsRootPath: z.string().min(1),
  additionalSkillsRootPaths: z.array(z.string().min(1)).optional(),
});

/**
 * List a bounded page of git branches at an absolute host path. Path-only
 * sibling of `host.list_files`. Does not require an environment row, does not
 * provision anything, and does not create daemon-side workspace state.
 */
const hostListBranchesCommandSchema = z.object({
  type: z.literal("host.list_branches"),
  path: z.string().min(1),
  query: z.string().max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
  selectedBranch: gitBranchNameSchema.optional(),
  limit: z.number().int().positive().max(BRANCH_LIST_LIMIT_MAX),
});

const providerListModelsCommandSchema = z.object({
  type: z.literal("provider.list_models"),
  providerId: z.string().min(1),
  acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
});

const knownAcpAgentExecutableQuerySchema = z
  .object({
    id: z.string().min(1),
    executableName: z.string().min(1),
  })
  .strict();

const knownAcpAgentsStatusCommandSchema = z
  .object({
    type: z.literal("known_acp_agents.status"),
    agents: z.array(knownAcpAgentExecutableQuerySchema),
  })
  .strict();

const provisionInitiatorSchema = z
  .object({
    /** Thread that initiated provisioning. Used to stream progress events. */
    threadId: z.string().min(1),
    /** Stable provisioning lifecycle rendered by streamed progress events. */
    provisioningId: z.string().min(1),
  })
  .strict();

const environmentProvisionCommandBaseSchema =
  hostDaemonEnvironmentTargetSchema.extend({
    type: z.literal("environment.provision"),
    /** Initiating thread for live progress streaming. Null when no thread is associated (e.g., project source provisioning). */
    initiator: provisionInitiatorSchema.nullable(),
  });

/**
 * Pre-provision checkout for unmanaged workspaces. The server resolves the
 * branch name (including server-minted names for the `new` case) and base
 * branch before sending — daemon just runs the corresponding git checkout.
 */
const unmanagedCheckoutSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      name: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("new"),
      name: gitBranchNameSchema,
      baseBranch: gitBranchNameSchema,
    })
    .strict(),
]);

const unmanagedEnvironmentProvisionCommandSchema =
  environmentProvisionCommandBaseSchema
    .extend({
      workspaceProvisionType: z.literal("unmanaged"),
      /** Path to validate */
      path: z.string().min(1),
      /** When set, the daemon checks out this branch before opening the workspace. */
      checkout: unmanagedCheckoutSchema.optional(),
    })
    .strict();

const managedEnvironmentProvisionFieldsSchema = z.object({
  /** Source repo path */
  sourcePath: z.string().min(1),
  /** Target path for worktree/clone creation */
  targetPath: z.string().min(1),
  /** Name of the new branch the daemon should create for this environment. */
  branchName: gitBranchNameSchema,
  /**
   * Branch on the source repo that the new branch should be based on. Pass
   * `null` to use the source's default branch (resolved by the daemon).
   */
  baseBranch: gitBranchNameSchema.nullable(),
  /** Maximum time in ms to wait for the setup script */
  setupTimeoutMs: z.number().int().positive(),
});

const managedWorktreeEnvironmentProvisionCommandSchema =
  environmentProvisionCommandBaseSchema
    .merge(managedEnvironmentProvisionFieldsSchema)
    .extend({ workspaceProvisionType: z.literal("managed-worktree") })
    .strict();

const personalEnvironmentProvisionCommandSchema =
  environmentProvisionCommandBaseSchema
    .extend({
      workspaceProvisionType: z.literal("personal"),
      /** Target directory under the host data dir for the personal workspace. */
      targetPath: z.string().min(1),
    })
    .strict();

/**
 * Provision a workspace for an environment.
 *
 * Discriminated by `workspaceProvisionType`:
 * - `unmanaged`: validates `path`, discovers git properties (isGitRepo,
 *   isWorktree, branchName). Does NOT create anything.
 * - `managed-worktree`: creates a git worktree at `targetPath` from
 *   `sourcePath`, runs setup script if present.
 * - `personal`: creates or opens a scratch directory at `targetPath`.
 *
 * Idempotent — if path already exists and is valid, reports success.
 * Rolls back partial state on failure.
 *
 * Result: `{ path, isGitRepo, isWorktree, branchName, transcript }`.
 *
 * Lane-serialized per environmentId. Git worktree metadata mutations are
 * protected by the workspace implementation.
 */
export const environmentProvisionCommandSchema = z.discriminatedUnion(
  "workspaceProvisionType",
  [
    unmanagedEnvironmentProvisionCommandSchema,
    managedWorktreeEnvironmentProvisionCommandSchema,
    personalEnvironmentProvisionCommandSchema,
  ],
);
export type EnvironmentProvisionCommand = z.infer<
  typeof environmentProvisionCommandSchema
>;

export const environmentProvisionCancelCommandSchema =
  hostDaemonEnvironmentTargetSchema
    .extend({
      type: z.literal("environment.provision.cancel"),
    })
    .strict();
export type EnvironmentProvisionCancelCommand = z.infer<
  typeof environmentProvisionCancelCommandSchema
>;

const environmentDestroyCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("environment.destroy"),
  })
  .strict();

const workspaceStatusCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.status"),
  mergeBaseBranch: gitBranchNameSchema.optional(),
});

const workspaceDiffCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diff"),
  target: workspaceDiffTargetSchema,
  maxDiffBytes: z.number().int().positive(),
  maxFileListBytes: z.number().int().positive(),
});

const workspaceDiffFilesCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diffFiles"),
  target: workspaceDiffTargetSchema,
});

const workspaceDiffPatchCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diffPatch"),
  target: workspaceDiffTargetSchema,
  paths: z.array(z.string()),
  maxBytesPerFile: z.number().int().positive(),
});

// The daemon derives the branch from the workspace HEAD, so the command needs
// no fields beyond the workspace target.
const workspacePullRequestCommandSchema =
  hostDaemonWorkspaceTargetSchema.extend({
    type: z.literal("workspace.pull_request"),
  });

const pullRequestMergeMethodSchema = z.enum(["merge", "squash", "rebase"]);

const workspacePullRequestReadyCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("workspace.pull_request_action"),
    operation: z.literal("ready"),
  })
  .strict();

const workspacePullRequestDraftCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("workspace.pull_request_action"),
    operation: z.literal("draft"),
  })
  .strict();

const workspacePullRequestMergeCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("workspace.pull_request_action"),
    operation: z.literal("merge"),
    method: pullRequestMergeMethodSchema,
  })
  .strict();

const workspacePullRequestActionCommandSchema = z.discriminatedUnion(
  "operation",
  [
    workspacePullRequestReadyCommandSchema,
    workspacePullRequestDraftCommandSchema,
    workspacePullRequestMergeCommandSchema,
  ],
);

const workspaceCommitCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("workspace.commit"),
    message: z.string().min(1),
  })
  .strict();

const workspaceSquashMergeCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("workspace.squash_merge"),
    targetBranch: gitBranchNameSchema,
    commitMessage: z.string().min(1),
  })
  .strict();

const fileReadResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative().optional(),
  // Hash of the returned bytes, so editors can do compare-and-swap saves via
  // `host.write_file`'s `expectedSha256`.
  sha256: z.string(),
});

const fileWriteResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("written"),
      sha256: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("conflict"),
      // Hash of the content currently on disk; null when the file does not
      // exist (the caller expected it to).
      currentSha256: z.string().nullable(),
    })
    .strict(),
]);

const fileMetadataResultSchema = z.object({
  path: z.string(),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

const workspaceStatusResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      workspaceStatus: workspaceStatusSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

const workspaceDiffResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      diff: threadGitDiffResponseSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

const workspaceDiffFilesResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      files: z.array(rawDiffFileStatSchema),
      shortstat: z.string(),
      mergeBaseRef: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

const workspaceDiffPatchResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      patches: z.array(
        z
          .object({
            path: z.string(),
            patch: z.string(),
            truncated: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

// Every failure mode (gh missing / not authed / no remote / no PR / malformed
// output / unresolvable workspace) collapses to `pullRequest: null`, so there
// is no available/unavailable discrimination here.
const workspacePullRequestResultSchema = z
  .object({
    pullRequest: gitHostPullRequestSchema.nullable(),
  })
  .strict();

const fileListResultSchema = z.object({
  files: z.array(z.object({ path: z.string(), name: z.string() })),
  truncated: z.boolean(),
});

const pathListResultSchema = z.object({
  paths: z.array(hostPathEntrySchema),
  truncated: z.boolean(),
});

// No `truncated` here, unlike `pathListResultSchema`: the daemon returns the
// full raw set across all roots and the server owns de-dup/sort/limit.
const commandListResultSchema = z.object({
  commands: z.array(hostProviderCommandSchema),
});

const providerListModelsResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
});

const knownAcpAgentExecutableStatusSchema = z
  .object({
    id: z.string().min(1),
    executableName: z.string().min(1),
    installed: z.boolean(),
    executablePath: z.string().min(1).nullable(),
  })
  .strict();

const knownAcpAgentsStatusResultSchema = z
  .object({
    agents: z.array(knownAcpAgentExecutableStatusSchema),
  })
  .strict();

const threadStartResultSchema = z.object({
  providerThreadId: z.string().min(1),
});
const turnSubmitResultSchema = z.object({
  appliedAs: z.enum(["new-turn", "steer"]),
});
const emptyCommandResultSchema = z.object({});
const codexInferenceCompleteResultSchema = z.object({
  model: z.string().min(1),
  value: jsonObjectSchema,
});
const codexVoiceTranscribeResultSchema = z.object({
  model: z.string().min(1),
  text: z.string(),
});
const environmentProvisionResultSchema =
  discoveredWorkspacePropertiesSchema.extend({
    transcript: z.array(provisioningTranscriptEntrySchema),
  });
const environmentProvisionCancelResultSchema = z.object({
  aborted: z.boolean(),
});
const workspaceCommitResultSchema = z.object({
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
const workspaceSquashMergeResultSchema = workspaceCommitResultSchema.extend({
  merged: z.boolean(),
});
const workspacePullRequestActionResultSchema = z.object({}).strict();
// ---------------------------------------------------------------------------
// Provider usage limits (live read from the host's provider credentials)
// ---------------------------------------------------------------------------

/**
 * One usage window for a provider subscription, e.g. the rolling 5h session
 * limit or the weekly limit. `usedPercent` is normalized to 0-100 and
 * `resetsAt` is an ISO-8601 timestamp (or null when the provider omits it).
 */
export const providerUsageWindowSchema = z.object({
  label: z.string().min(1),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().min(1).nullable(),
});
export type ProviderUsageWindow = z.infer<typeof providerUsageWindowSchema>;

/**
 * Live usage snapshot for a single provider. Discriminated on `status` so the
 * UI can render the windows, prompt the user to sign in, or surface an error
 * without inventing placeholder numbers.
 *
 * - `ok` — usage was read; `windows` may be empty if the plan exposes none.
 * - `unauthenticated` — no local credentials (the CLI is not logged in).
 * - `expired` — credentials exist but the token expired; the CLI must refresh
 *   it (we never refresh another tool's tokens here).
 * - `error` — network/HTTP/parse failure; `message` is user-facing.
 */
export const providerUsageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    planLabel: z.string().min(1).nullable(),
    windows: z.array(providerUsageWindowSchema),
  }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);
export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const providerUsageResponseSchema = z.object({
  codex: providerUsageSchema,
  claudeCode: providerUsageSchema,
});
export type ProviderUsageResponse = z.infer<typeof providerUsageResponseSchema>;

const providerUsageCommandSchema = z
  .object({ type: z.literal("provider.usage") })
  .strict();

const providerCliStatusCommandSchema = z
  .object({ type: z.literal("provider_cli.status") })
  .strict();

const providerCliInstallCommandSchema = providerCliInstallRequestSchema
  .extend({
    type: z.literal("provider_cli.install"),
  })
  .strict();

const providerCliInstallResultSchema = z
  .object({
    events: z.array(providerCliInstallEventSchema),
  })
  .strict();

type HostDaemonCommandTransport = "settled" | "onlineRpc";
export type HostDaemonCommandEnvironmentLane = "read" | "write";
type HostDaemonFlushEventsBeforeResult = boolean | "when-initiated";

interface HostDaemonCommandDescriptor<
  Type extends string,
  Schema extends z.ZodTypeAny,
  ResultSchema extends z.ZodTypeAny,
  Transport extends HostDaemonCommandTransport,
  Retryable extends boolean,
> {
  type: Type;
  schema: Schema;
  resultSchema: ResultSchema;
  transport: Transport;
  retryable: Retryable;
  flushEventsBeforeResult: HostDaemonFlushEventsBeforeResult;
  envLane: HostDaemonCommandEnvironmentLane | null;
}

function defineHostDaemonCommandDescriptor<
  const Type extends string,
  Schema extends z.ZodTypeAny,
  ResultSchema extends z.ZodTypeAny,
  const Transport extends HostDaemonCommandTransport,
  const Retryable extends boolean,
>(
  descriptor: HostDaemonCommandDescriptor<
    Type,
    Schema,
    ResultSchema,
    Transport,
    Retryable
  >,
): HostDaemonCommandDescriptor<
  Type,
  Schema,
  ResultSchema,
  Transport,
  Retryable
> {
  return descriptor;
}

export const hostDaemonCommandRegistry = {
  "thread.start": defineHostDaemonCommandDescriptor({
    type: "thread.start",
    schema: threadStartCommandSchema,
    resultSchema: threadStartResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: "read",
  }),
  "turn.submit": defineHostDaemonCommandDescriptor({
    type: "turn.submit",
    schema: turnSubmitCommandSchema,
    resultSchema: turnSubmitResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: "read",
  }),
  "thread.stop": defineHostDaemonCommandDescriptor({
    type: "thread.stop",
    schema: threadStopCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: null,
  }),
  "thread.rename": defineHostDaemonCommandDescriptor({
    type: "thread.rename",
    schema: threadRenameCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "thread.archive": defineHostDaemonCommandDescriptor({
    type: "thread.archive",
    schema: threadArchiveCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "thread.unarchive": defineHostDaemonCommandDescriptor({
    type: "thread.unarchive",
    schema: threadUnarchiveCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "interactive.resolve": defineHostDaemonCommandDescriptor({
    type: "interactive.resolve",
    schema: interactiveResolveCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: null,
  }),
  "codex.inference.complete": defineHostDaemonCommandDescriptor({
    type: "codex.inference.complete",
    schema: codexInferenceCompleteCommandSchema,
    resultSchema: codexInferenceCompleteResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "codex.voice.transcribe": defineHostDaemonCommandDescriptor({
    type: "codex.voice.transcribe",
    schema: codexVoiceTranscribeCommandSchema,
    resultSchema: codexVoiceTranscribeResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "environment.provision": defineHostDaemonCommandDescriptor({
    type: "environment.provision",
    schema: environmentProvisionCommandSchema,
    resultSchema: environmentProvisionResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: "when-initiated",
    envLane: "write",
  }),
  "environment.provision.cancel": defineHostDaemonCommandDescriptor({
    type: "environment.provision.cancel",
    schema: environmentProvisionCancelCommandSchema,
    resultSchema: environmentProvisionCancelResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: null,
  }),
  "environment.destroy": defineHostDaemonCommandDescriptor({
    type: "environment.destroy",
    schema: environmentDestroyCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "workspace.commit": defineHostDaemonCommandDescriptor({
    type: "workspace.commit",
    schema: workspaceCommitCommandSchema,
    resultSchema: workspaceCommitResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "workspace.squash_merge": defineHostDaemonCommandDescriptor({
    type: "workspace.squash_merge",
    schema: workspaceSquashMergeCommandSchema,
    resultSchema: workspaceSquashMergeResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "workspace.pull_request_action": defineHostDaemonCommandDescriptor({
    type: "workspace.pull_request_action",
    schema: workspacePullRequestActionCommandSchema,
    resultSchema: workspacePullRequestActionResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: "write",
  }),
  "host.list_files": defineHostDaemonCommandDescriptor({
    type: "host.list_files",
    schema: hostListFilesCommandSchema,
    resultSchema: fileListResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.list_paths": defineHostDaemonCommandDescriptor({
    type: "host.list_paths",
    schema: hostListPathsCommandSchema,
    resultSchema: pathListResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.browse_directory": defineHostDaemonCommandDescriptor({
    type: "host.browse_directory",
    schema: hostBrowseDirectoryCommandSchema,
    resultSchema: directoryListingSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.paths_exist": defineHostDaemonCommandDescriptor({
    type: "host.paths_exist",
    schema: hostPathsExistCommandSchema,
    resultSchema: pathsExistResponseSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.pick_folder": defineHostDaemonCommandDescriptor({
    type: "host.pick_folder",
    schema: hostPickFolderCommandSchema,
    resultSchema: pickFolderResponseSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.list_commands": defineHostDaemonCommandDescriptor({
    type: "host.list_commands",
    schema: hostListCommandsCommandSchema,
    resultSchema: commandListResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.list_branches": defineHostDaemonCommandDescriptor({
    type: "host.list_branches",
    schema: hostListBranchesCommandSchema,
    resultSchema: projectSourceCheckoutSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.file_metadata": defineHostDaemonCommandDescriptor({
    type: "host.file_metadata",
    schema: hostFileMetadataCommandSchema,
    resultSchema: fileMetadataResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.read_file": defineHostDaemonCommandDescriptor({
    type: "host.read_file",
    schema: hostReadFileCommandSchema,
    resultSchema: fileReadResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.read_file_relative": defineHostDaemonCommandDescriptor({
    type: "host.read_file_relative",
    schema: hostReadFileRelativeCommandSchema,
    resultSchema: fileReadResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.write_file": defineHostDaemonCommandDescriptor({
    type: "host.write_file",
    schema: hostWriteFileCommandSchema,
    resultSchema: fileWriteResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "provider.list_models": defineHostDaemonCommandDescriptor({
    type: "provider.list_models",
    schema: providerListModelsCommandSchema,
    resultSchema: providerListModelsResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "known_acp_agents.status": defineHostDaemonCommandDescriptor({
    type: "known_acp_agents.status",
    schema: knownAcpAgentsStatusCommandSchema,
    resultSchema: knownAcpAgentsStatusResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "provider.usage": defineHostDaemonCommandDescriptor({
    type: "provider.usage",
    schema: providerUsageCommandSchema,
    resultSchema: providerUsageResponseSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "provider_cli.status": defineHostDaemonCommandDescriptor({
    type: "provider_cli.status",
    schema: providerCliStatusCommandSchema,
    resultSchema: providerCliStatusResponseSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "provider_cli.install": defineHostDaemonCommandDescriptor({
    type: "provider_cli.install",
    schema: providerCliInstallCommandSchema,
    resultSchema: providerCliInstallResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "workspace.status": defineHostDaemonCommandDescriptor({
    type: "workspace.status",
    schema: workspaceStatusCommandSchema,
    resultSchema: workspaceStatusResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: "read",
  }),
  "workspace.diff": defineHostDaemonCommandDescriptor({
    type: "workspace.diff",
    schema: workspaceDiffCommandSchema,
    resultSchema: workspaceDiffResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: "read",
  }),
  "workspace.diffFiles": defineHostDaemonCommandDescriptor({
    type: "workspace.diffFiles",
    schema: workspaceDiffFilesCommandSchema,
    resultSchema: workspaceDiffFilesResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: "read",
  }),
  "workspace.diffPatch": defineHostDaemonCommandDescriptor({
    type: "workspace.diffPatch",
    schema: workspaceDiffPatchCommandSchema,
    resultSchema: workspaceDiffPatchResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: "read",
  }),
  "workspace.pull_request": defineHostDaemonCommandDescriptor({
    type: "workspace.pull_request",
    schema: workspacePullRequestCommandSchema,
    resultSchema: workspacePullRequestResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
};

type HostDaemonCommandRegistry = typeof hostDaemonCommandRegistry;
type AnyHostDaemonCommandDescriptor =
  HostDaemonCommandRegistry[keyof HostDaemonCommandRegistry];
type HostDaemonCommandDescriptorForTransport<
  Transport extends HostDaemonCommandTransport,
> = Extract<AnyHostDaemonCommandDescriptor, { transport: Transport }>;
type HostDaemonRetryableOnlineRpcCommandDescriptor = Extract<
  HostDaemonCommandDescriptorForTransport<"onlineRpc">,
  { retryable: true }
>;
type HostDaemonCommandTypeForTransport<
  Transport extends HostDaemonCommandTransport,
> = HostDaemonCommandDescriptorForTransport<Transport>["type"];
type HostDaemonSchemaForTransport<
  Transport extends HostDaemonCommandTransport,
> = HostDaemonCommandDescriptorForTransport<Transport>["schema"];
type HostDaemonRetryableOnlineRpcCommandSchema =
  HostDaemonRetryableOnlineRpcCommandDescriptor["schema"];

type HostDaemonResultSchemaMapForTransport<
  Transport extends HostDaemonCommandTransport,
> = {
  [Descriptor in HostDaemonCommandDescriptorForTransport<Transport> as Descriptor["type"]]: Descriptor["resultSchema"];
};

type HostDaemonCommandResultSchemaMap =
  HostDaemonResultSchemaMapForTransport<"settled">;
type HostDaemonOnlineRpcResultSchemaMap =
  HostDaemonResultSchemaMapForTransport<"onlineRpc">;

export type HostDaemonSettledCommandType =
  HostDaemonCommandTypeForTransport<"settled">;
export type HostDaemonOnlineRpcCommandType =
  HostDaemonCommandTypeForTransport<"onlineRpc">;
export type HostDaemonRpcCommandType =
  | HostDaemonSettledCommandType
  | HostDaemonOnlineRpcCommandType;

export type HostDaemonCommand = z.infer<
  HostDaemonSchemaForTransport<"settled">
>;
export type HostDaemonOnlineRpcCommand = z.infer<
  HostDaemonSchemaForTransport<"onlineRpc">
>;
export type HostDaemonRetryableOnlineRpcCommand =
  z.infer<HostDaemonRetryableOnlineRpcCommandSchema>;
export type HostDaemonRpcCommand =
  | HostDaemonCommand
  | HostDaemonOnlineRpcCommand;

function hostDaemonCommandDescriptorsForTransport<
  const Transport extends HostDaemonCommandTransport,
>(transport: Transport): HostDaemonCommandDescriptorForTransport<Transport>[] {
  return Object.values(hostDaemonCommandRegistry).filter(
    (
      descriptor,
    ): descriptor is HostDaemonCommandDescriptorForTransport<Transport> =>
      descriptor.transport === transport,
  );
}

function hostDaemonCommandDescriptorsForRetryableOnlineRpc(): HostDaemonRetryableOnlineRpcCommandDescriptor[] {
  return hostDaemonCommandDescriptorsForTransport("onlineRpc").filter(
    (descriptor): descriptor is HostDaemonRetryableOnlineRpcCommandDescriptor =>
      descriptor.retryable,
  );
}

function hostDaemonCommandTypesForTransport<
  const Transport extends HostDaemonCommandTransport,
>(transport: Transport): HostDaemonCommandTypeForTransport<Transport>[] {
  return hostDaemonCommandDescriptorsForTransport(transport).map(
    (descriptor) => descriptor.type,
  ) as HostDaemonCommandTypeForTransport<Transport>[];
}

function hostDaemonCommandSchemaForTransport<
  const Transport extends HostDaemonCommandTransport,
>(
  transport: Transport,
): z.ZodType<z.infer<HostDaemonSchemaForTransport<Transport>>> {
  const schemas = hostDaemonCommandDescriptorsForTransport(transport).map(
    (descriptor) => descriptor.schema,
  );
  return z.union(
    schemas as [
      HostDaemonSchemaForTransport<Transport>,
      HostDaemonSchemaForTransport<Transport>,
      ...HostDaemonSchemaForTransport<Transport>[],
    ],
  );
}

function hostDaemonRetryableOnlineRpcCommandUnionSchema(): z.ZodType<HostDaemonRetryableOnlineRpcCommand> {
  const schemas = hostDaemonCommandDescriptorsForRetryableOnlineRpc().map(
    (descriptor) => descriptor.schema,
  );
  return z.union(
    schemas as [
      HostDaemonRetryableOnlineRpcCommandSchema,
      HostDaemonRetryableOnlineRpcCommandSchema,
      ...HostDaemonRetryableOnlineRpcCommandSchema[],
    ],
  );
}

function hostDaemonResultSchemaByTypeForTransport<
  const Transport extends HostDaemonCommandTransport,
>(transport: Transport): HostDaemonResultSchemaMapForTransport<Transport> {
  return Object.fromEntries(
    hostDaemonCommandDescriptorsForTransport(transport).map((descriptor) => [
      descriptor.type,
      descriptor.resultSchema,
    ]),
  ) as HostDaemonResultSchemaMapForTransport<Transport>;
}

export const HOST_DAEMON_SETTLED_COMMAND_TYPES =
  hostDaemonCommandTypesForTransport("settled");
export const HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES =
  hostDaemonCommandTypesForTransport("onlineRpc");

const hostDaemonSettledCommandTypes = new Set<string>(
  HOST_DAEMON_SETTLED_COMMAND_TYPES,
);
const hostDaemonOnlineRpcCommandTypes = new Set<string>(
  HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES,
);

export function isHostDaemonSettledCommandType(
  type: string,
): type is HostDaemonSettledCommandType {
  return hostDaemonSettledCommandTypes.has(type);
}

export function isHostDaemonOnlineRpcCommandType(
  type: string,
): type is HostDaemonOnlineRpcCommandType {
  return hostDaemonOnlineRpcCommandTypes.has(type);
}

function isHostDaemonSettledCommandTypeValue(
  value: unknown,
): value is HostDaemonSettledCommandType {
  return typeof value === "string" && isHostDaemonSettledCommandType(value);
}

function isHostDaemonOnlineRpcCommandTypeValue(
  value: unknown,
): value is HostDaemonOnlineRpcCommandType {
  return typeof value === "string" && isHostDaemonOnlineRpcCommandType(value);
}

export const hostDaemonSettledCommandTypeSchema =
  z.custom<HostDaemonSettledCommandType>(isHostDaemonSettledCommandTypeValue);
export const hostDaemonOnlineRpcCommandTypeSchema =
  z.custom<HostDaemonOnlineRpcCommandType>(
    isHostDaemonOnlineRpcCommandTypeValue,
  );

export const hostDaemonCommandSchema =
  hostDaemonCommandSchemaForTransport("settled");
export const hostDaemonOnlineRpcCommandSchema =
  hostDaemonCommandSchemaForTransport("onlineRpc");
export const hostDaemonRetryableOnlineRpcCommandSchema =
  hostDaemonRetryableOnlineRpcCommandUnionSchema();
export const hostDaemonRpcCommandSchema = z.union([
  hostDaemonOnlineRpcCommandSchema,
  hostDaemonCommandSchema,
]);
export const hostDaemonRpcCommandTypeSchema = z.union([
  hostDaemonOnlineRpcCommandTypeSchema,
  hostDaemonSettledCommandTypeSchema,
]);

export function isHostDaemonCommand(
  command: HostDaemonRpcCommand,
): command is HostDaemonCommand {
  return isHostDaemonSettledCommandType(command.type);
}

export const hostDaemonCommandResultSchemaByType =
  hostDaemonResultSchemaByTypeForTransport("settled");
export const hostDaemonOnlineRpcResultSchemaByType =
  hostDaemonResultSchemaByTypeForTransport("onlineRpc");

export type HostDaemonCommandResultByType = {
  [K in keyof HostDaemonCommandResultSchemaMap]: z.infer<
    HostDaemonCommandResultSchemaMap[K]
  >;
};

export type HostDaemonCommandResult<
  TType extends HostDaemonSettledCommandType = HostDaemonSettledCommandType,
> = HostDaemonCommandResultByType[TType];

export type HostDaemonOnlineRpcResultByType = {
  [K in keyof HostDaemonOnlineRpcResultSchemaMap]: z.infer<
    HostDaemonOnlineRpcResultSchemaMap[K]
  >;
};

export type HostDaemonOnlineRpcResult<
  TType extends HostDaemonOnlineRpcCommandType = HostDaemonOnlineRpcCommandType,
> = HostDaemonOnlineRpcResultByType[TType];

export function hostDaemonEnvironmentLaneForCommand(
  command: HostDaemonRpcCommand,
): HostDaemonCommandEnvironmentLane | null {
  return hostDaemonCommandRegistry[command.type].envLane;
}

export function shouldFlushEventsBeforeReportingCommandResult(
  command: HostDaemonCommand,
): boolean {
  const policy =
    hostDaemonCommandRegistry[command.type].flushEventsBeforeResult;
  if (policy === "when-initiated") {
    return "initiator" in command && command.initiator !== null;
  }
  return policy;
}

export type HostDaemonOnlineRpcResultForCommand<
  TCommand extends HostDaemonOnlineRpcCommand = HostDaemonOnlineRpcCommand,
> = TCommand extends { type: infer TType }
  ? TType extends keyof HostDaemonOnlineRpcResultByType
    ? HostDaemonOnlineRpcResultByType[TType]
    : never
  : never;

export type HostDaemonCommandResultForCommand<
  TCommand extends HostDaemonCommand = HostDaemonCommand,
> = TCommand extends { type: infer TType }
  ? TType extends keyof HostDaemonCommandResultByType
    ? HostDaemonCommandResultByType[TType]
    : never
  : never;

export type HostDaemonRpcResultForCommand<
  TCommand extends HostDaemonRpcCommand = HostDaemonRpcCommand,
> = TCommand extends HostDaemonOnlineRpcCommand
  ? HostDaemonOnlineRpcResultForCommand<TCommand>
  : TCommand extends HostDaemonCommand
    ? HostDaemonCommandResultForCommand<TCommand>
    : never;

export function parseHostDaemonCommandResultForCommand<
  TCommand extends HostDaemonCommand,
>(
  command: TCommand,
  value: unknown,
): HostDaemonCommandResultForCommand<TCommand>;
export function parseHostDaemonCommandResultForCommand(
  command: HostDaemonCommand,
  value: unknown,
): HostDaemonCommandResultForCommand {
  return hostDaemonCommandResultSchemaByType[command.type].parse(value);
}

export function parseHostDaemonOnlineRpcResultForCommand<
  TCommand extends HostDaemonOnlineRpcCommand,
>(
  command: TCommand,
  value: unknown,
): HostDaemonOnlineRpcResultForCommand<TCommand>;
export function parseHostDaemonOnlineRpcResultForCommand(
  command: HostDaemonOnlineRpcCommand,
  value: unknown,
): HostDaemonOnlineRpcResultForCommand {
  return hostDaemonOnlineRpcResultSchemaByType[command.type].parse(value);
}

export function parseHostDaemonRpcResultForCommand<
  TCommand extends HostDaemonRpcCommand,
>(command: TCommand, value: unknown): HostDaemonRpcResultForCommand<TCommand>;
export function parseHostDaemonRpcResultForCommand(
  command: HostDaemonRpcCommand,
  value: unknown,
): HostDaemonRpcResultForCommand {
  if (isHostDaemonCommand(command)) {
    return parseHostDaemonCommandResultForCommand(command, value);
  }
  return parseHostDaemonOnlineRpcResultForCommand(command, value);
}
