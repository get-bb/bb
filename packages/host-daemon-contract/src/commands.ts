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
  reasoningLevelSchema,
  workflowSandboxSchema,
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

export const HOST_DAEMON_PROTOCOL_VERSION = 34 as const;

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
  "workflow.start",
  "workflow.cancel",
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
        applicationId: z.null(),
      })
      .strict(),
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
}).strict();

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

/**
 * Which kind of session a thread runs as (mirrors agent-runtime's
 * `AgentRuntimeSessionKind`). Interactive bb threads use "thread";
 * "workflowAgent" selects the restricted shell environment (no
 * `BB_SERVER_URL`/`BB_HOST_DAEMON_PORT`/`BB_THREAD_ID`, bb shimmed off PATH)
 * so workflow agents cannot reach the server or spawn nested bb work.
 */
export const agentSessionKindValues = ["thread", "workflowAgent"] as const;
export const agentSessionKindSchema = z.enum(agentSessionKindValues);
export type AgentSessionKind = z.infer<typeof agentSessionKindSchema>;

export const threadStartCommandSchema = hostDaemonThreadTargetSchema
  .merge(hostDaemonThreadRuntimeContextSchema)
  .extend({
    type: z.literal("thread.start"),
    requestId: clientTurnRequestIdSchema,
    input: z.array(promptInputSchema).min(1),
    threadStoragePath: z.string().min(1).optional(),
    /** Explicit per the no-hidden-defaults rule; the server fills "thread"
     *  (workflow agent sessions are started daemon-internally, never via
     *  thread.start). The daemon passes it through to the runtime's shell
     *  environment selection. */
    sessionKind: agentSessionKindSchema,
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

/**
 * Where a workflow definition was found on the host: the project tier
 * (`.bb/workflows`, walking up from `rootPath` to the repo boundary), the user
 * tier (`<dataDir>/workflows`), or the builtins shipped with bb. Shadowing is
 * winners-only: project > user > builtin.
 */
export const workflowRegistryTierValues = [
  "project",
  "user",
  "builtin",
] as const;
export const workflowRegistryTierSchema = z.enum(workflowRegistryTierValues);
export type WorkflowRegistryTier = z.infer<typeof workflowRegistryTierSchema>;

/**
 * List workflow definitions visible from `rootPath` across the registry tiers.
 * `rootPath` is required and server-resolved (the `host.read_file_relative`
 * pattern) — the daemon never decides where to look. Does not require an
 * environment row and does not provision anything.
 */
const workflowListCommandSchema = z
  .object({
    type: z.literal("workflow.list"),
    rootPath: z.string().min(1),
  })
  .strict();

/**
 * Fetch one workflow's raw source by registry name, resolved against
 * `rootPath` with the same tier shadowing as `workflow.list`. Returns raw
 * data only — the server runs the shared meta parser and determinism lint
 * itself (daemon-returns-raw-data rule).
 */
const workflowResolveCommandSchema = z
  .object({
    type: z.literal("workflow.resolve"),
    rootPath: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/**
 * Prune an archived run's run dir (per-agent event logs, worktree checkouts,
 * journal hot cache, pid/heartbeat records). The run manager refuses
 * (`pruned: false`) while the run is demonstrably alive on the host — a live
 * child handle or a fresh heartbeat — and the server's retention sweep
 * retries on a later pass. Idempotent: a missing run dir reports
 * `pruned: true`. Sent only for `retention = "archived"` runs; the durable
 * `workflow_runs.runDirPrunedAt` marker (set on the `pruned: true` ack) is
 * what the sweep converges on, so a lost result or offline host simply
 * re-sends later.
 */
const workflowPruneCommandSchema = z
  .object({
    type: z.literal("workflow.prune"),
    // wfr_-prefix shape validation (matching the server's
    // requirePublicWorkflowRun guard): prune resolves the id into a recursive
    // `rm` under the daemon's workflow-runs root, so a path-traversal id
    // (`..`, separators) must be structurally impossible, not merely unsent.
    runId: z.string().regex(/^wfr_[A-Za-z0-9_-]+$/u),
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

const environmentCleanupPreflightCommandSchema =
  hostDaemonWorkspaceTargetSchema
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

/**
 * Resolved run defaults snapshotted as explicit `workflow_runs` columns —
 * filled once at the server boundary, explicit thereafter. The daemon maps
 * them onto the runner's RunDefaults (renaming `providerId` → `provider` and
 * adding `cwd` = the command's `workspacePath`).
 */
export const workflowRunDefaultsSchema = z
  .object({
    providerId: z.string().min(1),
    /** null = no run-level model override; each provider uses its default model. */
    model: z.string().min(1).nullable(),
    effort: reasoningLevelSchema,
    sandbox: workflowSandboxSchema,
    concurrency: z.number().int().positive(),
    /** Lifetime agent() call cap (runaway-loop backstop). */
    maxAgents: z.number().int().positive(),
    /** Max items per parallel()/pipeline() call. */
    maxFanout: z.number().int().positive(),
    /** Output-token ceiling for the run; null = no ceiling. */
    budgetOutputTokens: z.number().int().positive().nullable(),
  })
  .strict();
export type WorkflowRunDefaults = z.infer<typeof workflowRunDefaultsSchema>;

/** The server-side source snapshot the run executes (workflow_runs.scriptSource/scriptHash). */
const workflowScriptSchema = z
  .object({
    /** Workflow name from the meta literal; the daemon derives the runner's
     *  stack-trace filename as `<name>.workflow.js`. */
    name: z.string().min(1),
    content: z.string().min(1),
    /** sha256 of `content`. */
    hash: z.string().min(1),
  })
  .strict();

/**
 * Typed `workflow.start` failure codes. Settled command results carry typed
 * payloads only on success; failures travel as the generic
 * `{ok: false, errorCode, errorMessage}` report, so these are the errorCode
 * values the daemon handler reports and the server settle function switches
 * on. `journal_fetch_failed` and `resume_preconditions_failed` apply only to
 * `resume: true` starts.
 */
export const workflowStartErrorCodeValues = [
  "script_invalid",
  "journal_fetch_failed",
  "resume_preconditions_failed",
] as const;
export const workflowStartErrorCodeSchema = z.enum(workflowStartErrorCodeValues);
export type WorkflowStartErrorCode = z.infer<typeof workflowStartErrorCodeSchema>;

/**
 * Start (or resume) a workflow run. Acceptance-only ack: success means the
 * runner child spawned and parsed the script — run completion arrives as a
 * terminal run event over the workflow-run event spool, never as a command
 * result, so the command lease never bounds run duration. Idempotent against
 * durable redelivery (an already-active run acks without a second spawn).
 * When `resume` is non-null the daemon rebuilds the runner journal from the
 * server's journal route before spawning. The resume `nonce` is minted once
 * per resume operation: the daemon records it in the run dir when it
 * processes the resume, so a REDELIVERED resume command whose segment
 * already settled (terminal record + matching nonce) acks without
 * re-running, while a fresh resume (new nonce) legitimately clears a stale
 * settle record from a prior segment.
 */
export const workflowStartCommandSchema = z
  .object({
    type: z.literal("workflow.start"),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    script: workflowScriptSchema,
    /** Serialized launch args (workflow_runs.argsJson); null = launched without args. */
    argsJson: z.string().min(1).nullable(),
    seed: z.number().int().nonnegative(),
    /** Resume-key scheme version stamped on the run row; the daemon rejects a
     *  resume under a different scheme with `resume_preconditions_failed`. */
    keyVersion: z.string().min(1),
    /** The run's original creation time — the journal-seeded base for the
     *  workflow's now(); stable across resume. */
    baseTimeMs: z.number().int().nonnegative(),
    defaults: workflowRunDefaultsSchema,
    /** The run's sandbox ceiling: the launch snapshot
     *  (workflow_runs.sandboxCeiling) clamped to the project's current
     *  effective ceiling at command-queue time, so a revoked grant reaches
     *  held starts and resumes. The executor enforces every per-call
     *  `agent({sandbox})` spec against it — server-resolved, never trusted
     *  to the script. Deliberately NOT part of `defaults`, which maps onto
     *  the runner's script-visible RunDefaults. */
    sandboxCeiling: workflowSandboxSchema,
    /** The resolved checkout/cwd for non-worktree agents (workflow_runs.workspacePath). */
    workspacePath: z.string().min(1),
    /** Wall-clock ceiling on the whole run; null = unbounded (server-resolved policy). */
    execTimeoutMs: z.number().int().positive().nullable(),
    /** Null = fresh start. Non-null = resume, carrying the per-operation nonce
     *  that scopes the daemon's settled-segment redelivery check. */
    resume: z
      .object({ nonce: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * Cancel a live workflow run: the daemon aborts the runner's AbortSignal and
 * escalates to SIGTERM/SIGKILL if the child never settles. `accepted: false`
 * means the daemon holds no live run for `runId` (already settled or never
 * started here) — a no-op, safe under redelivery.
 */
export const workflowCancelCommandSchema = z
  .object({
    type: z.literal("workflow.cancel"),
    runId: z.string().min(1),
  })
  .strict();

export const HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES = [
  "development.replay",
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
  "workflow.list",
  "workflow.prune",
  "workflow.resolve",
  "workspace.status",
  "workspace.diff",
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

const developmentReplaySpeedSchema = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
  z.literal(5),
  z.literal(10),
]);
const developmentReplayCommandSchema = z.discriminatedUnion("operation", [
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
]);
type DevelopmentReplayCommand = z.infer<typeof developmentReplayCommandSchema>;
export const hostDaemonOnlineRpcCommandSchema = z.union([
  developmentReplayCommandSchema,
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
  workflowListCommandSchema,
  workflowPruneCommandSchema,
  workflowResolveCommandSchema,
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
  hostListCommandsCommandSchema,
  hostListBranchesCommandSchema,
  hostFileMetadataCommandSchema,
  hostReadFileCommandSchema,
  hostReadFileRelativeCommandSchema,
  providerListCommandSchema,
  providerListModelsCommandSchema,
  environmentCleanupPreflightCommandSchema,
  workflowListCommandSchema,
  workflowResolveCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
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

const workspaceSquashMergeCommandSchema =
  hostDaemonWorkspaceTargetSchema
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
  workflowStartCommandSchema,
  workflowCancelCommandSchema,
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
    // Workflow run events ride their own durable spool, not the thread event
    // buffer — there is nothing to flush before reporting.
    case "workflow.start":
    case "workflow.cancel":
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

/**
 * One listed workflow definition: the winners-only registry view plus the
 * lightweight meta summary the daemon already parses during the scan. Full
 * meta resolution happens server-side from `workflow.resolve` source.
 */
export const hostDaemonWorkflowListingSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    /** Absent = the author declared no selection hint. */
    whenToUse: z.string().min(1).optional(),
    /**
     * Meta-declared run defaults, passed through from the scan so launch
     * surfaces (the Run dialog's override controls) can seed what the author
     * declared. Absent = the meta declares no default and resolution falls
     * through to server policy at launch.
     */
    defaultProvider: z.string().min(1).optional(),
    defaultModel: z.string().min(1).optional(),
    defaultSandbox: workflowSandboxSchema.optional(),
    tier: workflowRegistryTierSchema,
  })
  .strict();
export type HostDaemonWorkflowListing = z.infer<
  typeof hostDaemonWorkflowListingSchema
>;

const workflowListResultSchema = z.object({
  workflows: z.array(hostDaemonWorkflowListingSchema),
});

/** Raw source only — the server validates (meta parse + lint) itself. */
const workflowResolveResultSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  sha256: z.string().min(1),
});

/** `pruned: false` = run still live on the host; the sweep retries later. */
const workflowPruneResultSchema = z
  .object({
    pruned: z.boolean(),
  })
  .strict();

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
  // Acceptance-only ack — the terminal run event, not a command result,
  // settles the run. Typed failures travel as the generic error report with
  // a `workflowStartErrorCodeValues` errorCode.
  "workflow.start": z.object({
    accepted: z.literal(true),
  }),
  "workflow.cancel": z.object({
    accepted: z.boolean(),
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
  "host.list_commands": commandListResultSchema,
  "host.file_metadata": fileMetadataResultSchema,
  "host.list_branches": projectSourceCheckoutSchema,
  "host.read_file": fileReadResultSchema,
  "host.read_file_relative": fileReadResultSchema,
  "provider.list": providerListResultSchema,
  "provider.list_models": providerListModelsResultSchema,
  "environment.cleanup_preflight": environmentCleanupPreflightResultSchema,
  "workflow.list": workflowListResultSchema,
  "workflow.prune": workflowPruneResultSchema,
  "workflow.resolve": workflowResolveResultSchema,
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
  if (command.type === "development.replay") {
    return developmentReplayResultSchemaByOperation[command.operation].parse(
      value,
    );
  }
  return hostDaemonOnlineRpcResultSchemaByType[command.type].parse(value);
}

export function parseHostDaemonRpcResultForCommand<
  TCommand extends HostDaemonRpcCommand,
>(
  command: TCommand,
  value: unknown,
): HostDaemonRpcResultForCommand<TCommand>;
export function parseHostDaemonRpcResultForCommand(
  command: HostDaemonRpcCommand,
  value: unknown,
): HostDaemonRpcResultForCommand {
  if (isHostDaemonCommand(command)) {
    return parseHostDaemonCommandResultForCommand(command, value);
  }
  return parseHostDaemonOnlineRpcResultForCommand(command, value);
}
