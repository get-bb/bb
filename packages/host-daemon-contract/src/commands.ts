import {
  acpPermissionCliSchema,
  acpNativeReasoningSchema,
  acpReasoningCliSchema,
  availableModelSchema,
  discoveredWorkspacePropertiesSchema,
  dynamicToolSchema,
  instructionModeSchema,
  pendingInteractionResolutionSchema,
  permissionModeSchema,
  promptInputSchema,
  projectSourceCheckoutSchema,
  providerForkSchema,
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
  jsonValueSchema,
  providerNativeSkillRootsSchema,
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
import { workspaceResolutionFailureSchema } from "./workspace.js";
import { HOST_ARTIFACT_MAX_BYTES } from "./protocol.js";

export {
  DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS,
  HOST_ARTIFACT_MAX_BYTES,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "./protocol.js";
export {
  workspaceResolutionFailureCodeSchema,
  workspaceResolutionFailureSchema,
  type WorkspaceResolutionFailure,
  type WorkspaceResolutionFailureCode,
} from "./workspace.js";

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

function isConnectBaseDomain(value: string): boolean {
  try {
    const parsed = new URL(`https://${value}`);
    return (
      parsed.host === value &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

/** Gate identity derived and assigned by the enrolled host daemon. */
export const hostDaemonConnectTunnelIdentitySchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
      .refine((label) => !label.includes("--")),
    baseDomain: z.string().min(1).refine(isConnectBaseDomain),
  })
  .strict();
export type HostDaemonConnectTunnelIdentity = z.infer<
  typeof hostDaemonConnectTunnelIdentitySchema
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
  })
  .strict();

export const hostDaemonInjectedSkillSourceSchema = z.discriminatedUnion(
  "kind",
  [
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        kind: z.literal("tree"),
        treeHash: z.string().regex(/^[a-f0-9]{64}$/u),
        entryPath: z.string().min(1),
        sourceType: z.enum(["builtin", "data-dir"]),
      })
      .strict(),
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        kind: z.literal("workspace-path"),
        sourceType: z.literal("project"),
        sourceRootPath: z.string().min(1),
        skillFilePath: z.string().min(1),
      })
      .strict(),
    hostDaemonInjectedSkillSourceBaseSchema
      .extend({
        kind: z.literal("host-path"),
        sourceType: z.enum(["shared-user", "shared-project"]),
        sourceRootPath: z.string().min(1),
        skillFilePath: z.string().min(1),
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
    reasoningCli: acpReasoningCliSchema.optional(),
    nativeReasoning: acpNativeReasoningSchema.optional(),
    nativeSkillRoots: providerNativeSkillRootsSchema.optional(),
    permissionCli: acpPermissionCliSchema.optional(),
  })
  .strict();
export type HostDaemonAcpLaunchSpec = z.infer<
  typeof hostDaemonAcpLaunchSpecSchema
>;

export function normalizeHostDaemonAcpLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
): HostDaemonAcpLaunchSpec {
  const {
    displayName,
    command,
    args,
    env,
    cwd,
    modelCli,
    reasoningCli,
    nativeReasoning,
    nativeSkillRoots,
    permissionCli,
  } = spec;
  const permissionCliHasMode =
    permissionCli?.full !== undefined ||
    permissionCli?.workspaceWrite !== undefined ||
    permissionCli?.readonly !== undefined;
  return {
    displayName,
    command,
    args,
    env,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(modelCli !== undefined && modelCli.listArgs.length > 0
      ? { modelCli }
      : {}),
    ...(reasoningCli !== undefined ? { reasoningCli } : {}),
    ...(nativeReasoning !== undefined ? { nativeReasoning } : {}),
    ...(nativeSkillRoots !== undefined ? { nativeSkillRoots } : {}),
    ...(permissionCli !== undefined && permissionCliHasMode
      ? { permissionCli }
      : {}),
  };
}

/**
 * How the daemon obtains the provider bridge for a provider. Every provider is
 * plugin-declared, so every command that reaches a bridge carries one of these
 * — the source says which of the two delivery paths to take rather than
 * leaving the daemon to infer it from an absent field:
 *
 * - `"artifact"`: download the plugin's content-addressed host artifact from
 *   the server by digest, verify the bytes, cache it under the daemon data dir,
 *   and run it with the daemon's node through the bridge bootstrap.
 * - `"daemon-bundled"`: run the named bridge from the daemon's own bundle. Pi
 *   is the only one, because its agent tree cannot be inlined into a
 *   relocatable artifact ({@link DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS}).
 */
export const hostDaemonBridgeLaunchSchema = z
  .object({
    // The plugin that ships this bridge. It names the artifact to fetch, and
    // it scopes the bridge process's own directories on the host — a bridge is
    // a `bb.host` artifact like any other, so it gets the same plugin-scoped
    // data directory a host worker does.
    pluginId: z.string().min(1),
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("artifact"),
          digest: z.string().regex(/^[a-f0-9]{64}$/u),
          byteLength: z
            .number()
            .int()
            .positive()
            .max(HOST_ARTIFACT_MAX_BYTES),
        })
        .strict(),
      z
        .object({
          kind: z.literal("daemon-bundled"),
          id: z.string().min(1),
        })
        .strict(),
    ]),
    // The provider's server-validated capabilities, exactly the facts the
    // runtime enforces before a command reaches the bridge: which execution
    // options it accepts (permission modes, service tier) and which thread
    // operations it offers (archive, rename, fork). The daemon has no
    // registry, so without these it would have to guess a baseline and reject
    // work the server already accepted.
    capabilities: z
      .object({
        supportsServiceTier: z.boolean(),
        permissionModes: z.array(permissionModeSchema).min(1),
        supportsThreadArchive: z.boolean(),
        supportsThreadRename: z.boolean(),
        fork: providerForkSchema,
      })
      .strict(),
  })
  .strict();
export type HostDaemonBridgeLaunch = z.infer<
  typeof hostDaemonBridgeLaunchSchema
>;

const hostDaemonThreadRuntimeContextSchema = z
  .object({
    workspaceContext: workspaceContextSchema,
    projectId: z.string().min(1),
    providerId: z.string().min(1),
    acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
    bridgeLaunch: hostDaemonBridgeLaunchSchema,
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

export const threadRewindPrepareCommandSchema = hostDaemonThreadTargetSchema
  .merge(hostDaemonThreadRuntimeContextSchema)
  .extend({
    type: z.literal("thread.rewind.prepare"),
    /** Server-minted per-attempt staging id; each lease owns one staged fork. */
    leaseId: z.string().min(1),
    sourceProviderThreadId: z.string().min(1),
    retainThroughProviderCheckpoint: z.string().min(1),
  })
  .strict();

export const threadRewindDiscardCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.rewind.discard"),
    leaseId: z.string().min(1),
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
    inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1).optional(),
    options: runtimeThreadExecutionOptionsSchema,
    acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
    bridgeLaunch: hostDaemonBridgeLaunchSchema,
    resumeContext: turnResumeContextSchema,
    target: turnSubmitTargetSchema,
  })
  .strict()
  .superRefine(refineGroupedInputMatchesFlatInput);

/**
 * `interrupt` stops a live turn: the daemon waits for the runtime to learn the
 * active turn so the provider stop carries the right turn id. `release` only
 * unloads a runtime the server already knows is idle, so the daemon skips that
 * wait and the server leaves thread lifecycle state alone.
 */
export const threadStopIntentSchema = z.enum(["interrupt", "release"]);

export type ThreadStopIntent = z.infer<typeof threadStopIntentSchema>;

export const threadStopCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.stop"),
    intent: threadStopIntentSchema,
  })
  .strict();

const threadGoalClearCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.goal.clear"),
    options: runtimeThreadExecutionOptionsSchema,
    acpLaunchSpec: hostDaemonAcpLaunchSpecSchema.optional(),
    bridgeLaunch: hostDaemonBridgeLaunchSchema,
    resumeContext: turnResumeContextSchema,
  })
  .strict();

const threadPlanCancelCommandSchema = hostDaemonThreadTargetSchema
  .extend({
    type: z.literal("thread.plan.cancel"),
    expectedTurnId: z.string().min(1),
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
    bridgeLaunch: hostDaemonBridgeLaunchSchema,
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
    bridgeLaunch: hostDaemonBridgeLaunchSchema,
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
    reasoningEffort: z.literal("none"),
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
    mode: z.number().int().min(0).max(0o777).optional(),
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

const hostMkdirCommandSchema = z
  .object({
    type: z.literal("host.mkdir"),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean(),
  })
  .strict();

const hostMovePathCommandSchema = z
  .object({
    type: z.literal("host.move_path"),
    sourcePath: z.string().min(1),
    destinationPath: z.string().min(1),
    rootPath: z.string().min(1).optional(),
  })
  .strict();

const hostRemovePathCommandSchema = z
  .object({
    type: z.literal("host.remove_path"),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean(),
  })
  .strict();

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

const projectInspectCommandSchema = z
  .object({
    type: z.literal("project.inspect"),
    path: z.string().min(1),
  })
  .strict();

const projectCloneDefaultPathCommandSchema = z
  .object({
    type: z.literal("project.clone_default_path"),
    projectSlug: z.string().min(1),
  })
  .strict();

const projectCloneCommandSchema = z
  .object({
    type: z.literal("project.clone"),
    remoteUrl: z.string().min(1),
    projectSlug: z.string().min(1),
    targetPath: z.string().min(1).optional(),
  })
  .strict();

const hostPickFolderCommandSchema = z
  .object({
    type: z.literal("host.pick_folder"),
  })
  .strict();

const pluginHostArtifactSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    byteLength: z.number().int().positive().max(HOST_ARTIFACT_MAX_BYTES),
  })
  .strict();

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

const pluginHostCallCommandSchema = z
  .object({
    type: z.literal("plugin.host.call"),
    pluginId: z.string().min(1),
    generation: z.string().min(1),
    artifact: pluginHostArtifactSchema,
    callId: z.string().min(1),
    method: z.string().min(1),
    input: jsonValueSchema,
    timeoutMs: z.number().int().positive().max(MAX_NODE_TIMER_DELAY_MS),
  })
  .strict();

const pluginHostCancelCommandSchema = z
  .object({
    type: z.literal("plugin.host.cancel"),
    pluginId: z.string().min(1),
    generation: z.string().min(1),
    callId: z.string().min(1),
  })
  .strict();

const pluginHostDisposeCommandSchema = z
  .object({
    type: z.literal("plugin.host.dispose"),
    pluginId: z.string().min(1),
    generation: z.string().min(1),
  })
  .strict();

const connectTunnelEnsureIdentityCommandSchema = z
  .object({
    type: z.literal("connect-tunnel.ensure-identity"),
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
 * raw parsed records; server policy (merge/de-dup/sort) is applied on
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
 * resolves provider-native user-home roots itself and scans provider-native
 * project roots under `cwd` when provided; `cwd: null` skips project roots.
 * bb-managed skills are resolved by the server's canonical skill catalog and
 * never cross this discovery boundary.
 */
const hostListCommandsCommandSchema = z
  .object({
    type: z.literal("host.list_commands"),
    providerId: z.string().min(1),
    cwd: z.string().min(1).nullable(),
    nativeSkillRoots: providerNativeSkillRootsSchema.optional(),
  })
  .strict();

/**
 * Which scan root a discovered skill came from, as raw root identity — not a
 * product scope. The server maps `(providerId, rootKind)` to the user-facing
 * scope (e.g. `provider-user` under `claude-code` → `claude-user`, under
 * `codex` → `codex`) and decides `manageable`. Kept here, not derived on the
 * daemon, because only the server knows which provider it queried.
 */
export const skillRootKindSchema = z.enum([
  "bb-project",
  "bb-data-dir",
  "bb-builtin",
  "provider-project",
  "provider-user",
  "shared-project",
  "shared-user",
  "plugin",
]);
export type SkillRootKind = z.infer<typeof skillRootKindSchema>;

/**
 * A discovered skill for the Skills management page. Unlike
 * `hostProviderCommandSchema` (typeahead) this carries the absolute `filePath`
 * (backs View / Delete) and the originating `rootKind`. Skill-only — legacy
 * `command`-source entries are not surfaced here.
 */
export const discoveredSkillSchema = z.object({
  id: z.string().regex(/^skill_[a-f0-9]{64}$/u),
  name: z.string(),
  description: z.string().nullable(),
  filePath: z.string(),
  rootKind: skillRootKindSchema,
  /** True when discovery followed either the skill directory or SKILL.md symlink. */
  linked: z.boolean(),
});
export type DiscoveredSkill = z.infer<typeof discoveredSkillSchema>;

/**
 * List discoverable skills (not legacy commands) for a provider, classified by
 * originating root. Same root-resolution rules as `host.list_commands`:
 * `cwd: null` skips the project roots and returns only user-home/bb scopes.
 */
const hostListSkillsCommandSchema = z
  .object({
    type: z.literal("host.list_skills"),
    providerId: z.string().min(1),
    cwd: z.string().min(1).nullable(),
    nativeSkillRoots: providerNativeSkillRootsSchema.optional(),
  })
  .strict();

/** User-owned local skill scopes that can be deleted after path confinement. */
export const deletableSkillScopeSchema = z.enum([
  "bb-user",
  "bb-project",
  // The daemon only distinguishes bb roots (derived locally) from provider
  // roots (an explicit `rootPath` from server-side discovery), so naming the
  // provider here bought nothing and closed the vocabulary to plugins.
  "provider-user",
  "provider-project",
]);
export type DeletableSkillScope = z.infer<typeof deletableSkillScopeSchema>;

/**
 * Delete a local user-owned skill directory. bb roots are derived from scope;
 * provider roots are resolved from authoritative discovery by the server and
 * supplied explicitly. The daemon realpath-confines the target to the named
 * direct child of that root and refuses symlink escapes.
 */
const hostDeleteSkillCommandSchema = z
  .object({
    type: z.literal("host.delete_skill"),
    scope: deletableSkillScopeSchema,
    name: z.string().min(1),
    cwd: z.string().min(1).nullable(),
    rootPath: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.scope === "bb-project" && command.cwd === null) {
      context.addIssue({
        code: "custom",
        path: ["cwd"],
        message: "cwd is required to delete a bb-project skill",
      });
    }
    const isBbScope =
      command.scope === "bb-user" || command.scope === "bb-project";
    if (isBbScope && command.rootPath !== null) {
      context.addIssue({
        code: "custom",
        path: ["rootPath"],
        message: "rootPath must be null for a bb skill",
      });
    }
    if (!isBbScope && command.rootPath === null) {
      context.addIssue({
        code: "custom",
        path: ["rootPath"],
        message: "rootPath is required for a provider skill",
      });
    }
  });

/**
 * Overwrite an existing bb skill's SKILL.md. Same confinement as delete: the
 * path is built host-side from `(scope, name, cwd)` (never a client path), the
 * name must be a single safe segment, and the resolved target must be exactly
 * `<bb-root>/<name>/SKILL.md` of an already-existing skill. Edits only — it
 * never creates new skills (creation is via prompt).
 */
const writableBbSkillScopeSchema = z.enum(["bb-user", "bb-project"]);

const hostWriteSkillCommandSchema = z
  .object({
    type: z.literal("host.write_skill"),
    scope: writableBbSkillScopeSchema,
    name: z.string().min(1),
    cwd: z.string().min(1).nullable(),
    content: z.string().min(1).max(1_000_000),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.scope === "bb-project" && command.cwd === null) {
      context.addIssue({
        code: "custom",
        path: ["cwd"],
        message: "cwd is required to edit a bb-project skill",
      });
    }
  });

/**
 * Copy server-owned skill trees into the host's global agent skill roots
 * (`~/.agents/skills` and `~/.claude/skills`) so agents running outside bb can
 * load them. The server picks which skills to publish and supplies their tree
 * hashes; the daemon pulls each tree and owns the home-relative destinations.
 */
const hostInstallGlobalSkillSchema = z
  .object({
    name: z.string().max(64).regex(INJECTED_SKILL_NAME_PATTERN),
    treeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    entryPath: z.string().min(1),
  })
  .strict();
export type HostInstallGlobalSkill = z.infer<
  typeof hostInstallGlobalSkillSchema
>;

const hostInstallGlobalSkillsCommandSchema = z
  .object({
    type: z.literal("host.install_global_skills"),
    skills: z.array(hostInstallGlobalSkillSchema).min(1).max(64),
  })
  .strict();

/**
 * Read what is currently installed in this host's global agent skill roots.
 * The daemon returns the raw content hash of each installed copy (hashed like a
 * skill tree, so it is comparable to a tree hash); the server decides whether
 * that means installed, out of date, or missing.
 */
const hostGlobalSkillsStatusCommandSchema = z
  .object({
    type: z.literal("host.global_skills_status"),
    names: z
      .array(z.string().max(64).regex(INJECTED_SKILL_NAME_PATTERN))
      .min(1)
      .max(64),
  })
  .strict();

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
  bridgeLaunch: hostDaemonBridgeLaunchSchema,
  cwd: z.string().min(1).optional(),
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
  maxUntrackedLineStatFiles: z.number().int().positive(),
  maxUntrackedLineStatBytes: z.number().int().positive(),
});

const workspaceDiffCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diff"),
  target: workspaceDiffTargetSchema,
  maxDiffBytes: z.number().int().positive(),
  maxFileListBytes: z.number().int().positive(),
  maxUntrackedFiles: z.number().int().positive(),
});

const workspaceDiffFilesCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diffFiles"),
  target: workspaceDiffTargetSchema,
  maxFiles: z.number().int().positive(),
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
      truncated: z.boolean(),
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

// "absent" is a real answer (gh ran and reported no PR for the branch, or a
// detached HEAD has no branch); "unavailable" means the lookup itself failed
// (gh missing / not authed / timeout / malformed output / unresolvable
// workspace) and must not be treated as "no PR exists".
const workspacePullRequestResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      pullRequest: gitHostPullRequestSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("absent") }).strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      message: z.string().min(1),
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

const hostPathMutationResultSchema = z.object({ ok: z.literal(true) }).strict();

const pluginHostCallResultSchema = z
  .object({ output: jsonValueSchema })
  .strict();

const pluginHostCancelResultSchema = z
  .object({ cancelled: z.boolean() })
  .strict();

const pluginHostDisposeResultSchema = z
  .object({ disposed: z.boolean() })
  .strict();

// No `truncated` here, unlike `pathListResultSchema`: the daemon returns the
// full raw set across all roots and the server owns de-dup/sort/limit.
const commandListResultSchema = z.object({
  commands: z.array(hostProviderCommandSchema),
});

// Like `commandListResultSchema`: the daemon returns the full raw set across
// all roots; the server owns scope-mapping, de-dup, and sort.
const skillListResultSchema = z.object({
  skills: z.array(discoveredSkillSchema),
});

const deleteSkillResultSchema = z.object({
  deletedPath: z.string(),
});

const installGlobalSkillsResultSchema = z
  .object({
    installations: z.array(
      z
        .object({
          name: z.string(),
          path: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type HostInstallGlobalSkillsResult = z.infer<
  typeof installGlobalSkillsResultSchema
>;

const globalSkillsStatusResultSchema = z
  .object({
    /** One entry per (skill name, global skill root) pair on this host. */
    entries: z.array(
      z
        .object({
          name: z.string(),
          path: z.string(),
          /** Tree hash of the installed copy, or null when nothing is there. */
          treeHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type HostGlobalSkillsStatusResult = z.infer<
  typeof globalSkillsStatusResultSchema
>;

const writeSkillResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("written"),
    filePath: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.object({
    outcome: z.literal("conflict"),
    currentSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
  }),
]);

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
const threadStopResultSchema = z
  .object({
    providerCheckpointId: z.string().min(1).nullable(),
  })
  .strict();
const emptyCommandResultSchema = z.object({});
const projectPathResultSchema = z.object({ path: z.string().min(1) }).strict();
const projectInspectResultSchema = projectPathResultSchema
  .extend({ gitRemoteUrl: z.string().min(1).nullable() })
  .strict();
const projectCloneResultSchema = projectInspectResultSchema;
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
 * limit or the weekly limit. `usedPercent` is normalized to 0-100,
 * `resetsAt` is an ISO-8601 timestamp (or null when the provider omits it),
 * and `cost` carries optional Cursor on-demand spend in USD cents.
 */
export const providerUsageWindowSchema = z.object({
  label: z.string().min(1),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().min(1).nullable(),
  cost: z
    .object({
      usedUsdCents: z.number().int().nonnegative(),
      limitUsdCents: z.number().int().positive(),
    })
    .optional(),
});
export type ProviderUsageWindow = z.infer<typeof providerUsageWindowSchema>;

/**
 * Live usage snapshot for a single provider. Discriminated on `status` so the
 * UI can render the windows, prompt the user to sign in, or surface an error
 * without inventing placeholder numbers.
 *
 * - `ok` — usage was read; `accountEmail` is null when the provider's local
 *   auth state does not expose it, and `windows` may be empty if the plan
 *   exposes none.
 * - `not_installed` — the provider CLI is not installed on this host.
 * - `unauthenticated` — no local credentials (the CLI is not logged in).
 * - `expired` — credentials exist but the token expired; the CLI must refresh
 *   it (we never refresh another tool's tokens here).
 * - `error` — network/HTTP/parse failure; `message` is user-facing. Carries
 *   `planLabel`/`accountEmail` when they were known locally before the call.
 */
export const providerUsageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    accountEmail: z.string().email().nullable(),
    planLabel: z.string().min(1).nullable(),
    windows: z.array(providerUsageWindowSchema),
  }),
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({
    status: z.literal("error"),
    message: z.string().min(1),
    /**
     * Plan and account are read from local credentials *before* the usage HTTP
     * call, so a rate limit or outage does not have to erase them. Null when the
     * provider only learns them from the response body.
     */
    planLabel: z.string().min(1).nullable().default(null),
    accountEmail: z.string().nullable().default(null),
  }),
]);
export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const providerUsageResponseSchema = z.object({
  codex: providerUsageSchema,
  claudeCode: providerUsageSchema,
  cursor: providerUsageSchema,
});
export type ProviderUsageResponse = z.infer<typeof providerUsageResponseSchema>;

const providerUsageCommandSchema = z
  .object({ type: z.literal("provider.usage") })
  .strict();

/**
 * One candidate project found on the host. `agentSeenAt` is set when a
 * supported coding agent has been run here (or in another checkout of the same
 * repo); it is a ranking hint only, never the reason a repo is listed.
 */
export const discoveredRepoSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    /** Last local activity, from `.git/HEAD` mtime. */
    lastActivityAt: z.string(),
    /** Remote URL when the repo has one; used to collapse worktrees. */
    originUrl: z.string().nullable(),
    /** True when a supported agent has been run here (or in a sibling checkout). */
    agentSeen: z.boolean(),
    /**
     * When that last agent session was, if the source reported a time. Claude
     * Code's history carries no timestamp, so `agentSeen` can be true while
     * this stays null.
     */
    agentSeenAt: z.string().nullable(),
  })
  .strict();
export type DiscoveredRepo = z.infer<typeof discoveredRepoSchema>;

export const discoverReposResultSchema = z
  .object({
    repos: z.array(discoveredRepoSchema),
    /** True when the walk hit its time budget and results may be partial. */
    truncated: z.boolean(),
  })
  .strict();
export type DiscoverReposResult = z.infer<typeof discoverReposResultSchema>;

const discoverReposCommandSchema = z
  .object({
    type: z.literal("workspace.discover_repos"),
    maxDepth: z.number().int().min(1).max(8),
    sinceDays: z.number().int().min(1).max(3650),
    limit: z.number().int().min(1).max(200),
  })
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
  "thread.rewind.discard": defineHostDaemonCommandDescriptor({
    type: "thread.rewind.discard",
    schema: threadRewindDiscardCommandSchema,
    resultSchema: emptyCommandResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: "read",
  }),
  "thread.rewind.prepare": defineHostDaemonCommandDescriptor({
    type: "thread.rewind.prepare",
    schema: threadRewindPrepareCommandSchema,
    resultSchema: threadStartResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: "read",
  }),
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
    resultSchema: threadStopResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: null,
  }),
  "thread.goal.clear": defineHostDaemonCommandDescriptor({
    type: "thread.goal.clear",
    schema: threadGoalClearCommandSchema,
    resultSchema: z.object({ cleared: z.boolean() }).strict(),
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: true,
    envLane: "read",
  }),
  "thread.plan.cancel": defineHostDaemonCommandDescriptor({
    type: "thread.plan.cancel",
    schema: threadPlanCancelCommandSchema,
    resultSchema: z.object({ cancelled: z.boolean() }).strict(),
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
  "project.clone": defineHostDaemonCommandDescriptor({
    type: "project.clone",
    schema: projectCloneCommandSchema,
    resultSchema: projectCloneResultSchema,
    transport: "settled",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
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
  "host.mkdir": defineHostDaemonCommandDescriptor({
    type: "host.mkdir",
    schema: hostMkdirCommandSchema,
    resultSchema: hostPathMutationResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.move_path": defineHostDaemonCommandDescriptor({
    type: "host.move_path",
    schema: hostMovePathCommandSchema,
    resultSchema: hostPathMutationResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "host.remove_path": defineHostDaemonCommandDescriptor({
    type: "host.remove_path",
    schema: hostRemovePathCommandSchema,
    resultSchema: hostPathMutationResultSchema,
    transport: "onlineRpc",
    retryable: false,
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
  "project.inspect": defineHostDaemonCommandDescriptor({
    type: "project.inspect",
    schema: projectInspectCommandSchema,
    resultSchema: projectInspectResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "project.clone_default_path": defineHostDaemonCommandDescriptor({
    type: "project.clone_default_path",
    schema: projectCloneDefaultPathCommandSchema,
    resultSchema: projectPathResultSchema,
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
  "plugin.host.call": defineHostDaemonCommandDescriptor({
    type: "plugin.host.call",
    schema: pluginHostCallCommandSchema,
    resultSchema: pluginHostCallResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "plugin.host.cancel": defineHostDaemonCommandDescriptor({
    type: "plugin.host.cancel",
    schema: pluginHostCancelCommandSchema,
    resultSchema: pluginHostCancelResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "plugin.host.dispose": defineHostDaemonCommandDescriptor({
    type: "plugin.host.dispose",
    schema: pluginHostDisposeCommandSchema,
    resultSchema: pluginHostDisposeResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  "connect-tunnel.ensure-identity": defineHostDaemonCommandDescriptor({
    type: "connect-tunnel.ensure-identity",
    schema: connectTunnelEnsureIdentityCommandSchema,
    resultSchema: hostDaemonConnectTunnelIdentitySchema,
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
  "host.list_skills": defineHostDaemonCommandDescriptor({
    type: "host.list_skills",
    schema: hostListSkillsCommandSchema,
    resultSchema: skillListResultSchema,
    transport: "onlineRpc",
    retryable: true,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  // Destructive host-local FS write (the second after `host.run_script`). Not
  // env-scoped, so `envLane: null`; non-retryable so a transient failure never
  // silently re-issues a delete.
  "host.delete_skill": defineHostDaemonCommandDescriptor({
    type: "host.delete_skill",
    schema: hostDeleteSkillCommandSchema,
    resultSchema: deleteSkillResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  // Host-local FS write (edit an existing bb skill's SKILL.md). Not env-scoped;
  // non-retryable so a transient failure never silently re-issues the write.
  "host.write_skill": defineHostDaemonCommandDescriptor({
    type: "host.write_skill",
    schema: hostWriteSkillCommandSchema,
    resultSchema: writeSkillResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  // Host-local FS write into the user's global agent skill roots. Replacing an
  // installed copy is idempotent, but it is still a destructive overwrite, so
  // it never silently retries.
  "host.install_global_skills": defineHostDaemonCommandDescriptor({
    type: "host.install_global_skills",
    schema: hostInstallGlobalSkillsCommandSchema,
    resultSchema: installGlobalSkillsResultSchema,
    transport: "onlineRpc",
    retryable: false,
    flushEventsBeforeResult: false,
    envLane: null,
  }),
  // Read-only inspection of the global skill roots; safe to retry.
  "host.global_skills_status": defineHostDaemonCommandDescriptor({
    type: "host.global_skills_status",
    schema: hostGlobalSkillsStatusCommandSchema,
    resultSchema: globalSkillsStatusResultSchema,
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
  "workspace.discover_repos": defineHostDaemonCommandDescriptor({
    type: "workspace.discover_repos",
    schema: discoverReposCommandSchema,
    resultSchema: discoverReposResultSchema,
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
