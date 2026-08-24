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
  providerHealth: "provider/health",
  providerUsage: "provider/usage",
  providerInstallationStatus: "provider/installation/status",
  providerInstallationRun: "provider/installation/run",
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
 * One injected skill root, the same shape for every provider: `path` is an
 * absolute directory holding one subdirectory per listed skill
 * (`<path>/<skill.name>/SKILL.md`) and `skills` lists every skill in it.
 * The bridge maps it to its provider's own layout — codex adds the
 * directory as an extra skills root, claude assembles a local plugin around
 * it, pi adds it as a skill path, an ACP bridge lists the skills in the
 * session instructions — so no provider-native manifest is staged by core.
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
