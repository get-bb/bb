import {
  availableModelSchema,
  clientTurnRequestIdSchema,
  dynamicToolSchema,
  instructionModeSchema,
  promptInputSchema,
} from "@bb/domain";
import { z } from "zod";
import { bridgeExecutionOptionsSchema } from "./execution-options.js";

/**
 * Canonical runtime → bridge request methods. One vocabulary for every
 * provider: a bridge maps these to its provider's native dialect internally
 * (codex `thread/stop` → `turn/interrupt`, `thread/discard` →
 * `thread/archive`, …). Methods gated by a handshake capability are simply
 * never sent to a bridge that did not advertise them.
 */
export const BRIDGE_REQUEST_METHODS = {
  initialize: "initialize",
  modelList: "model/list",
  experimentalProviderHealth: "provider/health",
  experimentalProviderUsage: "provider/usage",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  threadFork: "thread/fork",
  threadStop: "thread/stop",
  threadDiscard: "thread/discard",
  threadNameSet: "thread/name/set",
  threadArchive: "thread/archive",
  threadUnarchive: "thread/unarchive",
  threadGoalClear: "thread/goal/clear",
  turnStart: "turn/start",
  turnSteer: "turn/steer",
  skillsConfigure: "skills/configure",
} as const;

export type BridgeRequestMethod =
  (typeof BRIDGE_REQUEST_METHODS)[keyof typeof BRIDGE_REQUEST_METHODS];

export const bridgeRequestMethodValues = Object.values(
  BRIDGE_REQUEST_METHODS,
) as readonly BridgeRequestMethod[];

const sessionConstructionFields = {
  threadId: z.string().min(1),
  cwd: z.string().min(1),
  options: bridgeExecutionOptionsSchema,
  dynamicTools: z.array(dynamicToolSchema).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
  instructionMode: instructionModeSchema,
};

export const modelListParamsSchema = z
  .object({ cwd: z.string().min(1).optional() })
  .passthrough();

/**
 * Sessionless provider maintenance query. `providerOptions` carries the same
 * provider-scoped statics as model/list (notably an ACP launch spec), while
 * `providerId` lets one bridge implementation serve several provider ids.
 */
export const experimental_providerMaintenanceParamsSchema = z
  .object({
    providerId: z.string().min(1),
    cwd: z.string().min(1).optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ExperimentalProviderMaintenanceParams = z.infer<
  typeof experimental_providerMaintenanceParamsSchema
>;

/**
 * Cheap, host-local readiness reported by a provider implementation. Network
 * usage and update checks deliberately live outside this result so choosing a
 * provider for the composer never waits on them.
 */
export const experimental_providerHealthSchema = z
  .object({
    status: z.enum([
      "ready",
      "not_installed",
      "unauthenticated",
      "expired",
      "unsupported_version",
      "unknown",
    ]),
    statusMessage: z.string().min(1).nullable(),
    accountEmail: z.string().nullable(),
    planLabel: z.string().min(1).nullable(),
    installedVersion: z.string().min(1).nullable(),
    minimumSupportedVersion: z.string().min(1).nullable(),
    canInstall: z.boolean(),
    canUpdate: z.boolean(),
    loginCommand: z.string().min(1).nullable(),
  })
  .passthrough();

export type ExperimentalProviderHealth = z.infer<
  typeof experimental_providerHealthSchema
>;

/** One usage window reported by a provider subscription. */
export const experimental_providerUsageWindowSchema = z
  .object({
    label: z.string().min(1),
    usedPercent: z.number().min(0).max(100),
    resetsAt: z.string().min(1).nullable(),
    cost: z
      .object({
        usedUsdCents: z.number().int().nonnegative(),
        limitUsdCents: z.number().int().positive(),
      })
      .optional(),
  })
  .passthrough();

export type ExperimentalProviderUsageWindow = z.infer<
  typeof experimental_providerUsageWindowSchema
>;

/** Live usage for one provider, normalized by that provider's bridge. */
export const experimental_providerUsageSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      accountEmail: z.string().email().nullable(),
      planLabel: z.string().min(1).nullable(),
      windows: z.array(experimental_providerUsageWindowSchema),
    })
    .passthrough(),
  z.object({ status: z.literal("not_installed") }).passthrough(),
  z.object({ status: z.literal("unauthenticated") }).passthrough(),
  z.object({ status: z.literal("expired") }).passthrough(),
  z
    .object({
      status: z.literal("error"),
      message: z.string().min(1),
      planLabel: z.string().min(1).nullable().default(null),
      accountEmail: z.string().nullable().default(null),
    })
    .passthrough(),
]);

export type ExperimentalProviderUsage = z.infer<
  typeof experimental_providerUsageSchema
>;

export const experimental_providerHealthResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        health: experimental_providerHealthSchema,
      })
      .passthrough(),
  ],
);

export type ExperimentalProviderHealthResult = z.infer<
  typeof experimental_providerHealthResultSchema
>;

export const experimental_providerUsageResultSchema = z.discriminatedUnion(
  "supported",
  [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        usage: experimental_providerUsageSchema,
      })
      .passthrough(),
  ],
);

export type ExperimentalProviderUsageResult = z.infer<
  typeof experimental_providerUsageResultSchema
>;

export const threadStartParamsSchema = z
  .object({
    ...sessionConstructionFields,
    input: z.array(promptInputSchema).optional(),
  })
  .passthrough();

export const threadResumeParamsSchema = z
  .object({
    ...sessionConstructionFields,
    providerThreadId: z.string().min(1),
  })
  .passthrough();

export const threadForkParamsSchema = z
  .object({
    ...sessionConstructionFields,
    sourceProviderThreadId: z.string().min(1),
    /**
     * Absent means fork at the tip. Bridges whose handshake advertises
     * `fork: "tip"` reject a request carrying a checkpoint instead of
     * silently cloning more history than the bb timeline shows.
     */
    sourceProviderCheckpointId: z.string().min(1).optional(),
  })
  .passthrough();

export const threadStopParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    /**
     * "interrupt" stops an active turn and settles it as interrupted.
     * "release" detaches an idle session so its resources can be reclaimed;
     * it must never fabricate an interruption. One verb serving both intents
     * is the #1584 incident — the field is required.
     */
    intent: z.enum(["interrupt", "release"]),
    /** Non-null when the stop interrupts an active provider turn. */
    activeTurnId: z.string().min(1).nullable(),
  })
  .passthrough();

const threadRefParams = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
  })
  .passthrough();

export const threadDiscardParamsSchema = threadRefParams;
export const threadArchiveParamsSchema = threadRefParams;
export const threadUnarchiveParamsSchema = threadRefParams;
export const threadGoalClearParamsSchema = threadRefParams;

export const threadNameSetParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    title: z.string().min(1),
  })
  .passthrough();

const turnInputFields = {
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1),
  input: z.array(promptInputSchema),
  clientRequestId: clientTurnRequestIdSchema,
  options: bridgeExecutionOptionsSchema,
};

export const turnStartParamsSchema = z.object(turnInputFields).passthrough();

export const turnSteerParamsSchema = z
  .object({
    ...turnInputFields,
    expectedTurnId: z.string().min(1),
  })
  .passthrough();

/**
 * One staged skill root: an absolute directory the bridge hands to its
 * provider, plus the skills it contains. `skills` is always present (empty for
 * providers whose native form discovers skills from the directory itself);
 * only providers that must name skills inline — ACP, which lists them in the
 * session instructions — read it.
 */
export const skillsConfigureRootSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    skills: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type SkillsConfigureRoot = z.infer<typeof skillsConfigureRootSchema>;

/**
 * The canonical skill-injection payload. One shape for every provider: the
 * staged roots plus their skills. Each bridge transforms a root into its
 * provider's native form (a Claude local plugin, a codex extra skills root, a
 * pi additional skill path, an ACP prompt listing) — the per-provider shapes
 * never cross the wire.
 */
export const skillsConfigureParamsSchema = z
  .object({
    roots: z.array(skillsConfigureRootSchema),
  })
  .passthrough();

export type SkillsConfigureParams = z.infer<typeof skillsConfigureParamsSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Result of thread/start, thread/resume, and thread/fork. */
export const threadIdentityResultSchema = z
  .object({
    providerThreadId: z.string().min(1),
    /** Refines the handshake's `sessionRestore` for this session. */
    sessionRestorable: z.boolean().optional(),
  })
  .passthrough();

export type ThreadIdentityResult = z.infer<typeof threadIdentityResultSchema>;

export const modelListResultSchema = z
  .object({
    models: z.array(availableModelSchema),
    selectedOnlyModels: z.array(availableModelSchema).default([]),
  })
  .passthrough();

export type ModelListResult = z.infer<typeof modelListResultSchema>;
