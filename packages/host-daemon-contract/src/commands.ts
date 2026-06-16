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

export const HOST_DAEMON_PROTOCOL_VERSION = 36 as const;

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
});

const fileMetadataResultSchema = z.object({
  path: z.string(),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
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
  "provider.list_models": defineHostDaemonCommandDescriptor({
    type: "provider.list_models",
    schema: providerListModelsCommandSchema,
    resultSchema: providerListModelsResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "environment.cleanup_preflight": defineHostDaemonCommandDescriptor({
    type: "environment.cleanup_preflight",
    schema: environmentCleanupPreflightCommandSchema,
    resultSchema: environmentCleanupPreflightResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: "read",
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
