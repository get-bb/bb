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
  clientTurnRequestIdSchema,
  gitBranchNameSchema,
  jsonObjectSchema,
  applicationIdSchema,
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
import {
  replayCaptureDaemonListResponseSchema,
  replayCaptureManifestSchema,
} from "@bb/replay-capture/schema";
import { z } from "zod";

export const HOST_DAEMON_PROTOCOL_VERSION = 30 as const;

export {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  FILE_LIST_LIMIT_MAX,
  FILE_LIST_QUERY_MAX_LENGTH,
} from "@bb/domain";
const INJECTED_SKILL_NAME_PATTERN =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export const HOST_DAEMON_DURABLE_COMMAND_TYPES = [
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
  "environment.cleanup_preflight",
  "environment.destroy",
  "workspace.commit",
  "workspace.squash_merge",
] as const;
export const hostDaemonDurableCommandTypeSchema = z.enum(
  HOST_DAEMON_DURABLE_COMMAND_TYPES,
);
export type HostDaemonDurableCommandType = z.infer<
  typeof hostDaemonDurableCommandTypeSchema
>;

const hostDaemonCommandTypes = new Set<string>(
  HOST_DAEMON_DURABLE_COMMAND_TYPES,
);

export function isHostDaemonDurableCommandType(
  type: string,
): type is HostDaemonDurableCommandType {
  return hostDaemonCommandTypes.has(type);
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

const hostDaemonThreadTargetSchema = z.object({
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
});

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
        sourceType: z.literal("data-dir"),
        applicationId: z.null(),
      })
      .strict(),
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        sourceType: z.literal("global-app"),
        applicationId: applicationIdSchema,
      })
      .strict(),
  ],
);
export type HostDaemonInjectedSkillSource = z.infer<
  typeof hostDaemonInjectedSkillSourceSchema
>;

const hostDaemonThreadRuntimeContextSchema = z.object({
  workspaceContext: workspaceContextSchema,
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  options: runtimeThreadExecutionOptionsSchema,
  instructions: z.string().min(1),
  dynamicTools: z.array(dynamicToolSchema),
  injectedSkillSources: z.array(hostDaemonInjectedSkillSourceSchema),
  disallowedTools: z.array(z.string()).optional(),
  instructionMode: instructionModeSchema,
});

const hostDaemonExistingThreadRuntimeContextSchema =
  hostDaemonThreadRuntimeContextSchema.extend({
    providerThreadId: z.string().min(1),
  });

const turnResumeContextSchema =
  hostDaemonExistingThreadRuntimeContextSchema.omit({
    options: true,
  });

const hostDaemonEnvironmentTargetSchema = z.object({
  environmentId: z.string().min(1),
});

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

export const threadStopCommandSchema = hostDaemonThreadTargetSchema.extend({
  type: z.literal("thread.stop"),
});

const threadRenameCommandSchema = hostDaemonThreadTargetSchema.extend({
  type: z.literal("thread.rename"),
  title: z.string().min(1),
});

const threadArchiveCommandSchema =
  hostDaemonThreadWorkspaceTargetSchema.extend({
    type: z.literal("thread.archive"),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
  });

// Carries environmentId (not just threadId) so the host daemon can serialize
// it in the same per-environment write lane as thread.archive; otherwise a
// slower archive can land after a later unarchive and leave the provider
// session archived against the user's intent.
const threadUnarchiveCommandSchema = hostDaemonThreadTargetSchema.extend({
  type: z.literal("thread.unarchive"),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
});

const threadDeletedCommandSchema = hostDaemonThreadTargetSchema.extend({
  type: z.literal("thread.deleted"),
});

const interactiveResolveCommandSchema = hostDaemonThreadTargetSchema.extend({
  type: z.literal("interactive.resolve"),
  interactionId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  resolution: pendingInteractionResolutionSchema,
});

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
  environmentProvisionCommandBaseSchema.extend({
    workspaceProvisionType: z.literal("unmanaged"),
    /** Path to validate */
    path: z.string().min(1),
    /** When set, the daemon checks out this branch before opening the workspace. */
    checkout: unmanagedCheckoutSchema.optional(),
  });

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
    .extend({ workspaceProvisionType: z.literal("managed-worktree") });

const personalEnvironmentProvisionCommandSchema =
  environmentProvisionCommandBaseSchema.extend({
    workspaceProvisionType: z.literal("personal"),
    /** Target directory under the host data dir for the personal workspace. */
    targetPath: z.string().min(1),
  });

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

const environmentDestroyCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("environment.destroy"),
});

const environmentCleanupPreflightCommandSchema =
  hostDaemonWorkspaceTargetSchema.extend({
    type: z.literal("environment.cleanup_preflight"),
    mergeBaseBranch: gitBranchNameSchema,
  });

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

export const HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES = [
  "development.replay",
  "host.list_files",
  "host.list_paths",
  "host.list_branches",
  "host.file_metadata",
  "host.read_file",
  "host.read_file_relative",
  "provider.list",
  "provider.list_models",
  "workspace.status",
  "workspace.diff",
] as const;
export const hostDaemonOnlineRpcCommandTypeSchema = z.enum(
  HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES,
);

const developmentReplaySpeedSchema = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
  z.literal(5),
  z.literal(10),
]);
const developmentReplayCommandSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        type: z.literal("development.replay"),
        operation: z.literal("capture-list"),
      })
      .strict(),
    z
      .object({
        type: z.literal("development.replay"),
        operation: z.literal("capture-get"),
        captureId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("development.replay"),
        operation: z.literal("capture-delete"),
        captureId: z.string().min(1),
      })
      .strict(),
    hostDaemonThreadTargetSchema
      .extend({
        type: z.literal("development.replay"),
        operation: z.literal("run"),
        captureId: z.string().min(1),
        requestId: clientTurnRequestIdSchema,
        speed: developmentReplaySpeedSchema,
      })
      .strict(),
  ],
);
type DevelopmentReplayCommand = z.infer<typeof developmentReplayCommandSchema>;
export const hostDaemonOnlineRpcCommandSchema = z.union([
  developmentReplayCommandSchema,
  hostListFilesCommandSchema,
  hostListPathsCommandSchema,
  hostListBranchesCommandSchema,
  hostFileMetadataCommandSchema,
  hostReadFileCommandSchema,
  hostReadFileRelativeCommandSchema,
  providerListCommandSchema,
  providerListModelsCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
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
  hostListBranchesCommandSchema,
  hostFileMetadataCommandSchema,
  hostReadFileCommandSchema,
  hostReadFileRelativeCommandSchema,
  providerListCommandSchema,
  providerListModelsCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
]);
export type HostDaemonRetryableOnlineRpcCommand = z.infer<
  typeof hostDaemonRetryableOnlineRpcCommandSchema
>;

const workspaceCommitCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.commit"),
  message: z.string().min(1),
});

const workspaceSquashMergeCommandSchema = hostDaemonWorkspaceTargetSchema.extend(
  {
    type: z.literal("workspace.squash_merge"),
    targetBranch: gitBranchNameSchema,
    commitMessage: z.string().min(1),
  });

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
  environmentCleanupPreflightCommandSchema,
  environmentDestroyCommandSchema,
  workspaceCommitCommandSchema,
  workspaceSquashMergeCommandSchema,
]);
export const hostDaemonCommandSchema = z.union([
  hostDaemonNonProvisionCommandSchema,
  environmentProvisionCommandSchema,
]);
export type HostDaemonCommand = z.infer<typeof hostDaemonCommandSchema>;

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
    case "environment.cleanup_preflight":
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

const fileListResultSchema = z.object({
  files: z.array(z.object({ path: z.string(), name: z.string() })),
  truncated: z.boolean(),
});

const pathListResultSchema = z.object({
  paths: z.array(hostPathEntrySchema),
  truncated: z.boolean(),
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
  "environment.cleanup_preflight": environmentCleanupPreflightResultSchema,
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
} as const satisfies Record<HostDaemonDurableCommandType, z.ZodTypeAny>;

export type HostDaemonCommandResultByType = {
  [K in keyof typeof hostDaemonCommandResultSchemaByType]: z.infer<
    (typeof hostDaemonCommandResultSchemaByType)[K]
  >;
};

export type HostDaemonCommandResult<
  TType extends HostDaemonDurableCommandType = HostDaemonDurableCommandType,
> = HostDaemonCommandResultByType[TType];

const emptyReplayResultSchema = z.object({}).strict();

const developmentReplayResultSchemaByOperation = {
  "capture-list": replayCaptureDaemonListResponseSchema,
  "capture-get": replayCaptureManifestSchema,
  "capture-delete": emptyReplayResultSchema,
  run: emptyReplayResultSchema,
} as const satisfies Record<
  DevelopmentReplayCommand["operation"],
  z.ZodTypeAny
>;

type DevelopmentReplayResultByOperation = {
  [K in keyof typeof developmentReplayResultSchemaByOperation]: z.infer<
    (typeof developmentReplayResultSchemaByOperation)[K]
  >;
};

type DevelopmentReplayResult<
  TCommand extends DevelopmentReplayCommand = DevelopmentReplayCommand,
> = TCommand extends { operation: infer TOperation }
  ? TOperation extends keyof DevelopmentReplayResultByOperation
    ? DevelopmentReplayResultByOperation[TOperation]
    : never
  : never;

const developmentReplayResultSchema = z.union([
  developmentReplayResultSchemaByOperation["capture-list"],
  developmentReplayResultSchemaByOperation["capture-get"],
  developmentReplayResultSchemaByOperation["capture-delete"],
]);

export const hostDaemonOnlineRpcResultSchemaByType = {
  "development.replay": developmentReplayResultSchema,
  "host.list_files": fileListResultSchema,
  "host.list_paths": pathListResultSchema,
  "host.file_metadata": fileMetadataResultSchema,
  "host.list_branches": projectSourceCheckoutSchema,
  "host.read_file": fileReadResultSchema,
  "host.read_file_relative": fileReadResultSchema,
  "provider.list": providerListResultSchema,
  "provider.list_models": providerListModelsResultSchema,
  "workspace.status": workspaceStatusResultSchema,
  "workspace.diff": workspaceDiffResultSchema,
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
> = TCommand extends DevelopmentReplayCommand
  ? DevelopmentReplayResult<TCommand>
  : TCommand extends { type: infer TType }
    ? TType extends keyof HostDaemonOnlineRpcResultByType
      ? HostDaemonOnlineRpcResultByType[TType]
      : never
    : never;

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
  if (command.type === "development.replay") {
    return developmentReplayResultSchemaByOperation[command.operation].parse(
      value,
    );
  }
  return hostDaemonOnlineRpcResultSchemaByType[command.type].parse(value);
}

/**
 * Wire format for a command sent from the server to the daemon.
 *
 * Each command is self-describing — `command` contains the discriminated
 * `type` field plus its payload. `id` is a unique command identifier used
 * to correlate results. `cursor` is per-host monotonic and preserves
 * deterministic fetch order for a host.
 */
export const hostDaemonCommandEnvelopeSchema = z.object({
  id: z.string().min(1),
  attemptId: z.string().min(1),
  cursor: z.number().int().nonnegative(),
  command: hostDaemonCommandSchema,
});
export type HostDaemonCommandEnvelope = z.infer<
  typeof hostDaemonCommandEnvelopeSchema
>;

const hostDaemonCommandResultReportBaseSchema = z.object({
  sessionId: z.string().min(1),
  commandId: z.string().min(1),
  attemptId: z.string().min(1),
  completedAt: z.number().int().nonnegative(),
});
type HostDaemonCommandResultReportBase = z.infer<
  typeof hostDaemonCommandResultReportBaseSchema
>;
type HostDaemonCommandSuccessResultReportByType = {
  [TType in HostDaemonDurableCommandType]: HostDaemonCommandResultReportBase & {
    type: TType;
    ok: true;
    result: HostDaemonCommandResult<TType>;
  };
};
type HostDaemonCommandSuccessResultReport =
  HostDaemonCommandSuccessResultReportByType[HostDaemonDurableCommandType];
type HostDaemonKnownCommandErrorResultReportByType = {
  [TType in HostDaemonDurableCommandType]: HostDaemonCommandResultReportBase & {
    type: TType;
    ok: false;
    errorCode: string;
    errorMessage: string;
  };
};
type HostDaemonUnknownCommandErrorResultReport =
  HostDaemonCommandResultReportBase & {
    type: string;
    ok: false;
    errorCode: string;
    errorMessage: string;
  };
type HostDaemonCommandErrorResultReport =
  | HostDaemonKnownCommandErrorResultReportByType[HostDaemonDurableCommandType]
  | HostDaemonUnknownCommandErrorResultReport;
type HostDaemonKnownCommandErrorResultReportWithoutSessionByType = {
  [TType in HostDaemonDurableCommandType]: Omit<
    HostDaemonKnownCommandErrorResultReportByType[TType],
    "sessionId"
  >;
};
type HostDaemonUnknownCommandErrorResultReportWithoutSession = Omit<
  HostDaemonUnknownCommandErrorResultReport,
  "sessionId"
>;
type HostDaemonCommandErrorResultReportWithoutSession =
  | HostDaemonKnownCommandErrorResultReportWithoutSessionByType[HostDaemonDurableCommandType]
  | HostDaemonUnknownCommandErrorResultReportWithoutSession;
type HostDaemonCommandSuccessResultReportWithoutSessionByType = {
  [TType in HostDaemonDurableCommandType]: Omit<
    HostDaemonCommandSuccessResultReportByType[TType],
    "sessionId"
  >;
};
type HostDaemonCommandSuccessResultReportWithoutSession =
  HostDaemonCommandSuccessResultReportWithoutSessionByType[HostDaemonDurableCommandType];
export type HostDaemonCommandResultReport =
  | HostDaemonCommandSuccessResultReport
  | HostDaemonCommandErrorResultReport;
export type HostDaemonCommandResultReportWithoutSession =
  | HostDaemonCommandSuccessResultReportWithoutSession
  | HostDaemonCommandErrorResultReportWithoutSession;

function createHostDaemonCommandResultReportSchemasForType<
  TType extends HostDaemonDurableCommandType,
>(
  type: TType,
  resultSchema: (typeof hostDaemonCommandResultSchemaByType)[TType],
) {
  return [
    hostDaemonCommandResultReportBaseSchema.extend({
      type: z.literal(type),
      ok: z.literal(true),
      result: resultSchema,
    }),
    hostDaemonCommandResultReportBaseSchema.extend({
      type: z.literal(type),
      ok: z.literal(false),
      errorCode: z.string().min(1),
      errorMessage: z.string().min(1),
    }),
  ] as const;
}

function createKnownHostDaemonCommandResultReportSchemaForType<
  TType extends HostDaemonDurableCommandType,
>(type: TType) {
  return z.discriminatedUnion(
    "ok",
    createHostDaemonCommandResultReportSchemasForType(
      type,
      hostDaemonCommandResultSchemaByType[type],
    ),
  );
}

/** Catch-all schema for reporting errors on command types the daemon doesn't recognize. */
const unknownCommandErrorSchema =
  hostDaemonCommandResultReportBaseSchema.extend({
    type: z.string().min(1),
    ok: z.literal(false),
    errorCode: z.literal("unknown_command"),
    errorMessage: z.string().min(1),
  });
const hostDaemonCommandResultReportEnvelopeSchema =
  hostDaemonCommandResultReportBaseSchema.extend({
    type: z.string().min(1),
    ok: z.boolean(),
  });
const knownHostDaemonCommandResultReportSchemasByType = new Map(
  HOST_DAEMON_DURABLE_COMMAND_TYPES.map((type) => [
    type,
    createKnownHostDaemonCommandResultReportSchemaForType(type),
  ]),
);

/**
 * Result report union sent from the daemon back to the server.
 *
 * Success reports (`ok: true`) include the typed result for the command type.
 * Error reports (`ok: false`) include `errorCode` and `errorMessage`.
 * Unknown command types use errorCode `"unknown_command"`.
 */
export const hostDaemonCommandResultReportSchema =
  z.custom<HostDaemonCommandResultReport>((value) => {
    const envelope =
      hostDaemonCommandResultReportEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      return false;
    }
    if (!isHostDaemonDurableCommandType(envelope.data.type)) {
      return unknownCommandErrorSchema.safeParse(value).success;
    }
    const schema = knownHostDaemonCommandResultReportSchemasByType.get(
      envelope.data.type,
    );
    if (!schema) {
      return false;
    }
    return schema.safeParse(value).success;
  });
