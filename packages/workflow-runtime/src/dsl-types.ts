// Workflow DSL contracts, ported from omegacode's src/dsl/types.ts and retyped
// onto bb: provider ids come from the @bb/agent-providers catalog, effort is
// bb's ReasoningLevel, and the workflow-facing sandbox enum maps onto bb
// permission modes. bb-specific departures from omegacode:
// - `approval` is gone: workflows are autonomous by contract (the executor
//   auto-resolves interactive requests), so the field would be accepted but
//   ignored.
// - usage carries no dollar cost: cost accounting is an explicit bb non-goal.
// - run defaults are filled once at the server boundary and arrive fully
//   explicit; this package ships no DEFAULTS constant (the server owns policy).

import { z } from "zod";
import { agentProviderIdSchema } from "@bb/agent-providers";
import type { AgentProviderId } from "@bb/agent-providers";
import type {
  JsonObject,
  JsonValue,
  PermissionMode,
  ReasoningLevel,
} from "@bb/domain";

/**
 * Workflow-facing sandbox levels, as authored in workflow files. read-only: no
 * writes; workspace-write: writes within cwd; danger-full-access: unrestricted
 * — gated by the project's workflow-policy sandbox ceiling (plan M7): the
 * server 422s an over-ceiling run default at launch, and the daemon executor
 * terminally fails any per-call spec above the ceiling snapshotted on the
 * run. The runtime itself only enum-checks; it never enforces policy.
 */
export const workflowSandboxValues = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;
export const workflowSandboxSchema = z.enum(workflowSandboxValues);
export type WorkflowSandbox = z.infer<typeof workflowSandboxSchema>;

const PERMISSION_MODE_BY_WORKFLOW_SANDBOX: Record<
  WorkflowSandbox,
  PermissionMode
> = {
  "read-only": "readonly",
  "workspace-write": "workspace-write",
  "danger-full-access": "full",
};

/**
 * Map a workflow sandbox level onto the bb permission mode the agent session
 * runs with. Providers derive their own semantics from the permission mode
 * (codex OS sandbox policy, claude tool gating) — worktree isolation remains
 * the only hard boundary for parallel mutators.
 */
export function permissionModeForWorkflowSandbox(
  sandbox: WorkflowSandbox,
): PermissionMode {
  return PERMISSION_MODE_BY_WORKFLOW_SANDBOX[sandbox];
}

/**
 * A plain JSON Schema object (draft-07-ish), authored in untyped workflow JS —
 * genuinely freeform, so `unknown` values are correct here. We do not
 * constrain it further at the type level; ajv validates structured output
 * against it at runtime.
 */
export type JSONSchema = Record<string, unknown>;

/** Options a workflow author passes to `agent()`. All optional: omitted fields inherit the run defaults. */
export interface AgentOpts {
  provider?: AgentProviderId;
  label?: string;
  phase?: string;
  model?: string;
  effort?: ReasoningLevel;
  cwd?: string;
  sandbox?: WorkflowSandbox;
  instructions?: string;
  /**
   * JSON Schema for structured output. Typed JsonObject (not the freeform
   * JSONSchema walking alias) because an authored schema is pure JSON — it is
   * canonicalized into the agent's resume key and serialized to providers.
   */
  schema?: JsonObject;
  /**
   * Run in an isolated git worktree. Boolean only: the branch name is
   * runtime-derived (`wf/<runId>-<agentIndex>`), and the runtime rejects
   * unsupported options (omegacode's string branch names, `maxTurns`) at the
   * agent() call so authors fail fast instead of burning a run slot.
   */
  worktree?: boolean;
  /** Pin a stable resume cache key; otherwise the chained key is used. */
  key?: string;
}

/**
 * A fully-resolved request handed to a Worker. Policy fields are explicit:
 * authored opts have been merged with the run defaults, so a Worker never
 * applies defaults of its own.
 */
export interface AgentSpec {
  prompt: string;
  provider: AgentProviderId;
  /** Omitted = no model override; the provider uses its default model. */
  model?: string;
  effort: ReasoningLevel;
  cwd: string;
  sandbox: WorkflowSandbox;
  instructions?: string;
  /** See AgentOpts.schema: pure JSON by contract (key-hashed and provider-serialized). */
  schema?: JsonObject;
  /**
   * Run this agent in an isolated git worktree. Provisioning is Worker-owned
   * (the daemon executor creates the worktree on a `wf/<runId>-<agentIndex>`
   * branch, scopes cwd/sandbox to it, and reports the preserved branch);
   * omitted = run in the resolved cwd.
   */
  worktree?: boolean;
}

/** Token usage attributed to one agent (accumulated across corrective retries). */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export function emptyUsage(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export const agentStatusValues = [
  "completed",
  "failed",
  "interrupted",
] as const;
export const agentStatusSchema = z.enum(agentStatusValues);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/** Normalized result every Worker returns. */
export interface AgentResult {
  text: string;
  /** Present only when the spec carried a schema. Already client-side validated. */
  structured?: JsonValue;
  status: AgentStatus;
  usage: AgentUsage;
  /**
   * Present only when the agent ran in a worktree whose changes were preserved:
   * the branch the Worker kept after teardown (see AgentSpec.worktree). The
   * runtime threads it into the journal entry and `agent/completed` event.
   */
  worktreeBranch?: string;
}

export const metaPhaseSchema = z.strictObject({
  title: z.string().min(1),
  detail: z.string().min(1).optional(),
});
export type MetaPhase = z.infer<typeof metaPhaseSchema>;

/**
 * The pure-literal `export const meta = {...}` at the top of a workflow file.
 * Optional fields carry real omission semantics: no phases = no declared phase
 * plan, no whenToUse = no selection hint, no default* = defer to the run-level
 * defaults resolved at the server boundary. Strict: an unknown key rejects so
 * a typo'd field is never silently ignored.
 */
export const metaSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  phases: z.array(metaPhaseSchema).optional(),
  whenToUse: z.string().min(1).optional(),
  defaultProvider: agentProviderIdSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  defaultSandbox: workflowSandboxSchema.optional(),
});
export type Meta = z.infer<typeof metaSchema>;

/** The token budget surfaced to a workflow. `total` is the output-token ceiling (null = no ceiling). */
export interface WorkflowBudget {
  total: number | null;
  spent(): number;
  remaining(): number;
}

/**
 * A pipeline stage. Values flowing between stages are author-controlled
 * untyped JS, so they are genuinely unknowable here.
 */
export type PipelineStage = (
  prev: unknown,
  item: unknown,
  index: number,
) => unknown | Promise<unknown>;

/**
 * The injected globals available inside a workflow file. `agent()` resolves to
 * the result text, or to the validated structured value when the call carried
 * a schema; `parallel()` degrades a failed branch to null rather than failing
 * the fan-out.
 */
export interface WorkflowGlobals {
  agent: (prompt: string, opts?: AgentOpts) => Promise<JsonValue>;
  parallel: <T>(
    thunks: ReadonlyArray<() => Promise<T>>,
  ) => Promise<Array<T | null>>;
  pipeline: (
    items: unknown[],
    ...stages: PipelineStage[]
  ) => Promise<unknown[]>;
  phase: (title: string) => void;
  log: (msg: string) => void;
  now: () => number;
  random: () => number;
  budget: WorkflowBudget;
  /** The launch-time args (parsed JSON); undefined when the run was launched without args. */
  args: JsonValue | undefined;
}

/**
 * Resolved per-run defaults. bb fills these once at the server boundary
 * (explicit `workflow_runs` columns); the runtime never invents its own
 * defaults. Omitted model = no run-level override (a real state, not a hidden
 * default); null budget = no ceiling.
 */
export interface RunDefaults {
  provider: AgentProviderId;
  /** Omitted = no run-level model override; each provider uses its default model. */
  model?: string;
  effort: ReasoningLevel;
  sandbox: WorkflowSandbox;
  cwd: string;
  concurrency: number;
  /** Lifetime agent() call cap (runaway-loop backstop). */
  maxAgents: number;
  /** Max items per parallel()/pipeline() call. */
  maxFanout: number;
  /** Output-token ceiling for the run (null = no ceiling). */
  budgetOutputTokens: number | null;
}
