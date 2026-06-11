// Workflow-run policy: every run default is resolved exactly once here, at the
// server boundary, into explicit `workflow_runs` columns (AGENTS.md: fill
// defaults once at the boundary, explicit values thereafter). The lifecycle
// module and the daemon never invent defaults.

import { randomInt } from "node:crypto";
import { isAgentProviderId } from "@bb/agent-providers";
import {
  getProjectWorkflowPolicy,
  type CreateWorkflowRunInput,
  type DbQueryConnection,
} from "@bb/db";
import {
  isWorkflowSandboxAllowedByCeiling,
  type ReasoningLevel,
  type WorkflowRunSourceTier,
  type WorkflowSandbox,
} from "@bb/domain";
import { KEY_VERSION, type Meta } from "@bb/workflow-runtime/validation";
import { ApiError } from "../../errors.js";
import type { ResolvedHostPath } from "../projects/project-source-path.js";
import type { ValidatedWorkflowScript } from "./workflow-registry.js";

/**
 * Wall-clock ceiling on a whole run, carried on `workflow.start` as
 * `execTimeoutMs`. Null = unbounded (the omegacode default). Deliberately a
 * global server constant, not per-project policy (M7 decision, recorded in
 * the plan): no consumer has asked for a bound, and making it policy would
 * also require snapshotting it as a run column — it is filled at
 * command-build time, so resume would otherwise re-resolve it.
 */
export const WORKFLOW_RUN_EXEC_TIMEOUT_MS: number | null = null;

/**
 * Server policy defaults applied when neither the launch request nor the
 * workflow's meta declares a value. Provider/sandbox/caps mirror omegacode's
 * DEFAULTS; effort matches bb's standard thread default. (The run budget
 * default lives on the per-project policy —
 * `PROJECT_WORKFLOW_POLICY_DEFAULTS.defaultBudgetOutputTokens`.)
 */
export const WORKFLOW_RUN_POLICY_DEFAULTS = {
  providerId: "codex",
  effort: "medium" as ReasoningLevel,
  sandbox: "read-only" as WorkflowSandbox,
  concurrency: 8,
  maxAgents: 1000,
  maxFanout: 4096,
} as const;

/**
 * The effective per-project workflow policy, resolved once at the launch
 * boundary. `sandboxCeiling` is the most permissive sandbox the project's
 * runs may use — both as the resolved run default (launch gate, 422) and for
 * per-call `agent({sandbox})` specs (executor enforcement against the
 * run-row snapshot). Raising it to "danger-full-access" IS the
 * danger-full-access allowance.
 */
export interface ProjectWorkflowPolicy {
  /** Run budget when the launch doesn't override it; null = unbounded. */
  defaultBudgetOutputTokens: number | null;
  sandboxCeiling: WorkflowSandbox;
}

/**
 * Policy for projects with no explicit `project_workflow_policies` row — the
 * pre-policy behavior preserved exactly: read-only and workspace-write
 * allowed, danger-full-access requires an explicit per-project grant, no
 * budget default.
 */
export const PROJECT_WORKFLOW_POLICY_DEFAULTS: ProjectWorkflowPolicy = {
  defaultBudgetOutputTokens: null,
  sandboxCeiling: "workspace-write",
};

/** Row absence means the built-in defaults; the row's fields are explicit. */
export function getEffectiveProjectWorkflowPolicy(
  db: DbQueryConnection,
  projectId: string,
): ProjectWorkflowPolicy {
  const row = getProjectWorkflowPolicy(db, projectId);
  if (!row) {
    return PROJECT_WORKFLOW_POLICY_DEFAULTS;
  }
  return {
    defaultBudgetOutputTokens: row.defaultBudgetOutputTokens,
    sandboxCeiling: row.sandboxCeiling,
  };
}

/**
 * Launch-request overrides. Optionality carries real semantics: an omitted
 * field means "no override" and resolution falls through to the workflow's
 * meta defaults, then to server policy.
 */
export interface WorkflowRunDefaultOverrides {
  budgetOutputTokens?: number;
  effort?: ReasoningLevel;
  model?: string;
  providerId?: string;
  sandbox?: WorkflowSandbox;
}

/** The fully-resolved default columns of a `workflow_runs` row. */
export interface ResolvedWorkflowRunDefaults {
  budgetOutputTokens: number | null;
  concurrency: number;
  effort: ReasoningLevel;
  maxAgents: number;
  maxFanout: number;
  model: string | null;
  providerId: string;
  sandbox: WorkflowSandbox;
  /** The project's sandbox ceiling, snapshotted as a run column so resume
   *  (which rebuilds `workflow.start` from the row) never re-resolves it. */
  sandboxCeiling: WorkflowSandbox;
}

export interface ResolveWorkflowRunDefaultsArgs {
  meta: Meta;
  overrides: WorkflowRunDefaultOverrides;
  /** Effective per-project policy, read once at the route boundary
   *  (`getEffectiveProjectWorkflowPolicy`). */
  projectPolicy: ProjectWorkflowPolicy;
}

/**
 * Resolution order per field: launch override → workflow meta default →
 * per-project policy default → server policy default. A resolved sandbox
 * above the project's ceiling is rejected with 422
 * `workflow_sandbox_not_allowed`, never silently clamped — an explicit
 * override or meta default the policy forbids must fail loudly (the Run
 * dialog renders the 422 inline; a clamped launch would run with different
 * semantics than requested). A provider override outside the catalog is
 * likewise rejected here (422) — meta's `defaultProvider` is already
 * catalog-validated by the meta schema, and the daemon-side runDefaults
 * parse would otherwise fail the run only after launch.
 */
export function resolveWorkflowRunDefaults(
  args: ResolveWorkflowRunDefaultsArgs,
): ResolvedWorkflowRunDefaults {
  if (
    args.overrides.providerId !== undefined &&
    !isAgentProviderId(args.overrides.providerId)
  ) {
    throw new ApiError(
      422,
      "workflow_provider_unknown",
      `Unknown workflow provider "${args.overrides.providerId}"`,
    );
  }
  const sandbox =
    args.overrides.sandbox ??
    args.meta.defaultSandbox ??
    WORKFLOW_RUN_POLICY_DEFAULTS.sandbox;
  const ceiling = args.projectPolicy.sandboxCeiling;
  if (!isWorkflowSandboxAllowedByCeiling({ sandbox, ceiling })) {
    throw new ApiError(
      422,
      "workflow_sandbox_not_allowed",
      `Workflow sandbox "${sandbox}" exceeds this project's sandbox ceiling "${ceiling}"${
        sandbox === "danger-full-access"
          ? " — danger-full-access requires raising the project's workflow policy ceiling"
          : ""
      }`,
    );
  }

  return {
    providerId:
      args.overrides.providerId ??
      args.meta.defaultProvider ??
      WORKFLOW_RUN_POLICY_DEFAULTS.providerId,
    model: args.overrides.model ?? args.meta.defaultModel ?? null,
    effort: args.overrides.effort ?? WORKFLOW_RUN_POLICY_DEFAULTS.effort,
    sandbox,
    sandboxCeiling: ceiling,
    concurrency: WORKFLOW_RUN_POLICY_DEFAULTS.concurrency,
    maxAgents: WORKFLOW_RUN_POLICY_DEFAULTS.maxAgents,
    maxFanout: WORKFLOW_RUN_POLICY_DEFAULTS.maxFanout,
    budgetOutputTokens:
      args.overrides.budgetOutputTokens ??
      args.projectPolicy.defaultBudgetOutputTokens,
  };
}

export interface BuildWorkflowRunCreateInputArgs {
  /** Null = launched outside a thread (unanchored run). */
  anchorThreadId: string | null;
  /** Serialized launch args; null = launched without args. */
  argsJson: string | null;
  /** Launch idempotency key; null = no replay protection requested. */
  clientRequestId: string | null;
  /**
   * The launch target, resolved exactly once at the route boundary
   * (`resolveProjectSourcePath`) and shared with named-source registry
   * resolution — so the persisted `hostId`/`workspacePath` always match the
   * source root the script was resolved against.
   */
  launchTarget: ResolvedHostPath;
  overrides: WorkflowRunDefaultOverrides;
  projectId: string;
  /** Effective per-project policy, read once at the route boundary. */
  projectPolicy: ProjectWorkflowPolicy;
  script: ValidatedWorkflowScript;
  sourceTier: WorkflowRunSourceTier;
}

/**
 * Assemble the complete `workflow_runs` insert: the pre-resolved launch
 * target, defaults via `resolveWorkflowRunDefaults`, a fresh server-generated
 * seed, and the current resume-key scheme version.
 */
export function buildWorkflowRunCreateInput(
  args: BuildWorkflowRunCreateInputArgs,
): CreateWorkflowRunInput {
  const defaults = resolveWorkflowRunDefaults({
    meta: args.script.meta,
    overrides: args.overrides,
    projectPolicy: args.projectPolicy,
  });

  return {
    projectId: args.projectId,
    hostId: args.launchTarget.hostId,
    workspacePath: args.launchTarget.path,
    anchorThreadId: args.anchorThreadId,
    clientRequestId: args.clientRequestId,
    workflowName: args.script.name,
    sourceTier: args.sourceTier,
    scriptSource: args.script.content,
    scriptHash: args.script.hash,
    argsJson: args.argsJson,
    seed: randomInt(0, 2_147_483_647),
    keyVersion: KEY_VERSION,
    ...defaults,
  };
}
