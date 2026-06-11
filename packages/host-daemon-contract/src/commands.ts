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
  providerInfoSchema,
  runtimeThreadExecutionOptionsSchema,
  provisioningTranscriptEntrySchema,
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

export const HOST_DAEMON_PROTOCOL_VERSION = 35 as const;

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
const INJECTED_SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

// Settled commands run over live host RPC, but their results use command-result
// semantics because server-owned lifecycle/effects may depend on settlement.
// They are not persisted to the legacy host_daemon_commands table.
export const HOST_DAEMON_SETTLED_COMMAND_TYPES = [
  "thread.start",
  "turn.submit",
  "thread.stop",
  "thread.rename",
  "thread.archive",
  "thread.unarchive",
  "thread.deleted",
  "interactive.resolve",
  "codex.inference.complete",
  "codex.voice.transcribe",
  "host.write_file_relative",
  "host.delete_file_relative",
  "host.delete_path_relative",
  "environment.provision",
  "environment.provision.cancel",
  "environment.destroy",
  "workspace.commit",
  "workspace.squash_merge",
] as const;
export const hostDaemonSettledCommandTypeSchema = z.enum(
  HOST_DAEMON_SETTLED_COMMAND_TYPES,
);
export type HostDaemonSettledCommandType = z.infer<
  typeof hostDaemonSettledCommandTypeSchema
>;

const hostDaemonSettledCommandTypes = new Set<string>(
  HOST_DAEMON_SETTLED_COMMAND_TYPES,
);

export function isHostDaemonSettledCommandType(
  type: string,
): type is HostDaemonSettledCommandType {
  return hostDaemonSettledCommandTypes.has(type);
}

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
  ],
);
export type HostDaemonInjectedSkillSource = z.infer<
  typeof hostDaemonInjectedSkillSourceSchema
>;

const hostDaemonThreadRuntimeContextSchema = z
  .object({
    workspaceContext: workspaceContextSchema,
    projectId: z.string().min(1),
    providerId: z.string().min(1),
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

export const threadStartCommandSchema = hostDaemonThreadTargetSchema
  .merge(hostDaemonThreadRuntimeContextSchema)
  .extend({
    type: z.literal("thread.start"),
    requestId: clientTurnRequestIdSchema,
    input: z.array(promptInputSchema).min(1),
    threadStoragePath: z.string().min(1).optional(),
  })
  .strict();

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
    options: runtimeThreadExecutionOptionsSchema,
    resumeContext: turnResumeContextSchema,
    target: turnSubmitTargetSchema,
  })
  .strict();

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

const threadDeletedCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.deleted"),
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

const hostWriteFileRelativeCommandSchema = z
  .object({
    type: z.literal("host.write_file_relative"),
    rootPath: z.string().min(1),
    path: z.string().min(1),
    dotfiles: hostReadFileRelativeDotfilePolicySchema,
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
  })
  .strict();

const hostDeleteFileRelativeCommandSchema = z
  .object({
    type: z.literal("host.delete_file_relative"),
    rootPath: z.string().min(1),
    path: z.string().min(1),
    dotfiles: hostReadFileRelativeDotfilePolicySchema,
  })
  .strict();

const hostDeletePathRelativeCommandSchema = z
  .object({
    type: z.literal("host.delete_path_relative"),
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

const providerListCommandSchema = z.object({
  type: z.literal("provider.list"),
});

const providerListModelsCommandSchema = z.object({
  type: z.literal("provider.list_models"),
  providerId: z.string().min(1),
});

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

const environmentCleanupPreflightCommandSchema = hostDaemonWorkspaceTargetSchema
  .extend({
    type: z.literal("environment.cleanup_preflight"),
    mergeBaseBranch: gitBranchNameSchema,
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

// The daemon derives the branch from the workspace HEAD, so the command needs
// no fields beyond the workspace target.
const workspacePullRequestCommandSchema =
  hostDaemonWorkspaceTargetSchema.extend({
    type: z.literal("workspace.pull_request"),
  });

export const HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES = [
  "host.list_files",
  "host.list_paths",
  "host.list_commands",
  "host.list_branches",
  "host.file_metadata",
  "host.read_file",
  "host.read_file_relative",
  "provider.list",
  "provider.list_models",
  "environment.cleanup_preflight",
  "workspace.status",
  "workspace.diff",
  "workspace.pull_request",
] as const;
export const hostDaemonOnlineRpcCommandTypeSchema = z.enum(
  HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES,
);
const hostDaemonOnlineRpcCommandTypes = new Set<string>(
  HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES,
);

export function isHostDaemonOnlineRpcCommandType(
  type: string,
): type is HostDaemonOnlineRpcCommandType {
  return hostDaemonOnlineRpcCommandTypes.has(type);
}

export const hostDaemonOnlineRpcCommandSchema = z.union([
  hostListFilesCommandSchema,
  hostListPathsCommandSchema,
  hostListCommandsCommandSchema,
  hostListBranchesCommandSchema,
  hostFileMetadataCommandSchema,
  hostReadFileCommandSchema,
  hostReadFileRelativeCommandSchema,
  providerListCommandSchema,
  providerListModelsCommandSchema,
  environmentCleanupPreflightCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
  workspacePullRequestCommandSchema,
]);
export type HostDaemonOnlineRpcCommand = z.infer<
  typeof hostDaemonOnlineRpcCommandSchema
>;
export type HostDaemonOnlineRpcCommandType = z.infer<
  typeof hostDaemonOnlineRpcCommandTypeSchema
>;

// Retry-on-unavailable is limited to idempotent host reads.
export const hostDaemonRetryableOnlineRpcCommandSchema = z.union([
  hostListFilesCommandSchema,
  hostListPathsCommandSchema,
  hostListCommandsCommandSchema,
  hostListBranchesCommandSchema,
  hostFileMetadataCommandSchema,
  hostReadFileCommandSchema,
  hostReadFileRelativeCommandSchema,
  providerListCommandSchema,
  providerListModelsCommandSchema,
  environmentCleanupPreflightCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
  workspacePullRequestCommandSchema,
]);
export type HostDaemonRetryableOnlineRpcCommand = z.infer<
  typeof hostDaemonRetryableOnlineRpcCommandSchema
>;

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

const hostDaemonNonProvisionCommandSchema = z.discriminatedUnion("type", [
  threadStartCommandSchema,
  turnSubmitCommandSchema,
  threadStopCommandSchema,
  threadRenameCommandSchema,
  threadArchiveCommandSchema,
  threadUnarchiveCommandSchema,
  threadDeletedCommandSchema,
  interactiveResolveCommandSchema,
  codexInferenceCompleteCommandSchema,
  codexVoiceTranscribeCommandSchema,
  hostWriteFileRelativeCommandSchema,
  hostDeleteFileRelativeCommandSchema,
  hostDeletePathRelativeCommandSchema,
  environmentProvisionCancelCommandSchema,
  environmentDestroyCommandSchema,
  workspaceCommitCommandSchema,
  workspaceSquashMergeCommandSchema,
]);
export const hostDaemonCommandSchema = z.union([
  hostDaemonNonProvisionCommandSchema,
  environmentProvisionCommandSchema,
]);
export type HostDaemonCommand = z.infer<typeof hostDaemonCommandSchema>;

export const hostDaemonRpcCommandSchema = z.union([
  hostDaemonOnlineRpcCommandSchema,
  hostDaemonCommandSchema,
]);
export type HostDaemonRpcCommand = z.infer<typeof hostDaemonRpcCommandSchema>;
export const hostDaemonRpcCommandTypeSchema = z.union([
  hostDaemonOnlineRpcCommandTypeSchema,
  hostDaemonSettledCommandTypeSchema,
]);
export type HostDaemonRpcCommandType = z.infer<
  typeof hostDaemonRpcCommandTypeSchema
>;

export function isHostDaemonCommand(
  command: HostDaemonRpcCommand,
): command is HostDaemonCommand {
  return isHostDaemonSettledCommandType(command.type);
}

export function shouldFlushEventsBeforeReportingCommandResult(
  command: HostDaemonCommand,
): boolean {
  switch (command.type) {
    case "thread.start":
    case "turn.submit":
    case "thread.stop":
    case "interactive.resolve":
      return true;
    case "environment.provision":
      return command.initiator !== null;
    case "environment.provision.cancel":
      return true;
    case "environment.destroy":
    case "host.write_file_relative":
    case "host.delete_file_relative":
    case "host.delete_path_relative":
    case "codex.inference.complete":
    case "thread.deleted":
    case "thread.archive":
    case "thread.rename":
    case "thread.unarchive":
    case "codex.voice.transcribe":
    case "workspace.commit":
    case "workspace.squash_merge":
      return false;
  }
}

const fileReadResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative().optional(),
});

const fileMetadataResultSchema = z.object({
  path: z.string(),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

const fileWriteResultSchema = z.object({
  path: z.string(),
  hash: z.string().min(1),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

const fileDeleteResultSchema = z.object({
  path: z.string(),
  deleted: z.boolean(),
  previousHash: z.string().nullable(),
});

const pathDeleteResultSchema = z.object({
  path: z.string(),
  deleted: z.boolean(),
});

const environmentCleanupPreflightResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("safe_to_destroy") }).strict(),
    z
      .object({
        outcome: z.literal("blocked_by_changes"),
        message: z.string().min(1),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_missing"),
        failure: workspaceResolutionFailureSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal("not_inspectable"),
        failure: workspaceResolutionFailureSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal("probe_failed"),
        failure: workspaceResolutionFailureSchema,
      })
      .strict(),
  ],
);

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

const providerListResultSchema = z.object({
  providers: z.array(providerInfoSchema),
});

const providerListModelsResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
});

export const hostDaemonCommandResultSchemaByType = {
  "thread.start": z.object({
    providerThreadId: z.string().min(1),
  }),
  "turn.submit": z.object({
    appliedAs: z.enum(["new-turn", "steer"]),
  }),
  "thread.stop": z.object({}),
  "thread.rename": z.object({}),
  "thread.archive": z.object({}),
  "thread.unarchive": z.object({}),
  "thread.deleted": z.object({}),
  "interactive.resolve": z.object({}),
  "codex.inference.complete": z.object({
    model: z.string().min(1),
    value: jsonObjectSchema,
  }),
  "codex.voice.transcribe": z.object({
    model: z.string().min(1),
    text: z.string(),
  }),
  "host.write_file_relative": fileWriteResultSchema,
  "host.delete_file_relative": fileDeleteResultSchema,
  "host.delete_path_relative": pathDeleteResultSchema,
  "environment.provision": discoveredWorkspacePropertiesSchema.extend({
    transcript: z.array(provisioningTranscriptEntrySchema),
  }),
  "environment.provision.cancel": z.object({
    aborted: z.boolean(),
  }),
  "environment.destroy": z.object({}),
  "workspace.commit": z.object({
    commitSha: z.string().min(1),
    commitSubject: z.string().min(1),
  }),
  "workspace.squash_merge": z.object({
    merged: z.boolean(),
    commitSha: z.string().min(1),
    commitSubject: z.string().min(1),
  }),
} as const satisfies Record<HostDaemonSettledCommandType, z.ZodTypeAny>;

export type HostDaemonCommandResultByType = {
  [K in keyof typeof hostDaemonCommandResultSchemaByType]: z.infer<
    (typeof hostDaemonCommandResultSchemaByType)[K]
  >;
};

export type HostDaemonCommandResult<
  TType extends HostDaemonSettledCommandType = HostDaemonSettledCommandType,
> = HostDaemonCommandResultByType[TType];

export const hostDaemonOnlineRpcResultSchemaByType = {
  "host.list_files": fileListResultSchema,
  "host.list_paths": pathListResultSchema,
  "host.list_commands": commandListResultSchema,
  "host.file_metadata": fileMetadataResultSchema,
  "host.list_branches": projectSourceCheckoutSchema,
  "host.read_file": fileReadResultSchema,
  "host.read_file_relative": fileReadResultSchema,
  "provider.list": providerListResultSchema,
  "provider.list_models": providerListModelsResultSchema,
  "environment.cleanup_preflight": environmentCleanupPreflightResultSchema,
  "workspace.status": workspaceStatusResultSchema,
  "workspace.diff": workspaceDiffResultSchema,
  "workspace.pull_request": workspacePullRequestResultSchema,
} as const satisfies Record<HostDaemonOnlineRpcCommandType, z.ZodTypeAny>;

export type HostDaemonOnlineRpcResultByType = {
  [K in keyof typeof hostDaemonOnlineRpcResultSchemaByType]: z.infer<
    (typeof hostDaemonOnlineRpcResultSchemaByType)[K]
  >;
};

export type HostDaemonOnlineRpcResult<
  TType extends HostDaemonOnlineRpcCommandType = HostDaemonOnlineRpcCommandType,
> = HostDaemonOnlineRpcResultByType[TType];

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
