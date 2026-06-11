// Server-side workflow script gate. Validation is purely structural — the
// shared pure-literal meta parser plus the static determinism lint from
// @bb/workflow-runtime's vm-free `/validation` subpath — so the server never
// executes author JS and the vm module never enters its module graph (the
// hardened sandbox runs only in the daemon's runner child; the canonical
// vm-isolation test enforces both the no-vm grep and the no-barrel-import
// rule).
// Named-tier source arrives raw over the daemon's `workflow.resolve` RPC
// (daemon-returns-raw-data rule); inline source validates with no host
// round-trip at all.

import { createHash } from "node:crypto";
import {
  determinismLint,
  parseWorkflow,
  WorkflowSyntaxError,
  type Meta,
} from "@bb/workflow-runtime/validation";
import type {
  HostDaemonWorkflowListing,
  WorkflowRegistryTier,
} from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";

/**
 * A validated script snapshot, ready to be persisted onto a `workflow_runs`
 * row: meta parsed without execution, lint clean, content hashed server-side
 * (the daemon-reported hash is never trusted for the snapshot).
 */
export interface ValidatedWorkflowScript {
  content: string;
  /** sha256 hex over `content`, computed server-side. */
  hash: string;
  meta: Meta;
  /** The workflow's registry name (`meta.name`). */
  name: string;
}

function hashWorkflowSource(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Validate workflow source for every tier, inline included: structural meta
 * parse (pure-literal — an IIFE or computed expression rejects without ever
 * evaluating) + zod meta schema + static determinism lint. Findings reject
 * with 422 `workflow_validation_failed`; nothing here needs a host or a vm.
 */
export function validateWorkflowScriptSource(
  content: string,
): ValidatedWorkflowScript {
  let meta: Meta;
  try {
    meta = parseWorkflow(content).meta;
  } catch (error) {
    if (error instanceof WorkflowSyntaxError) {
      throw new ApiError(422, "workflow_validation_failed", error.message);
    }
    throw error;
  }

  const findings = determinismLint(content);
  if (findings.length > 0) {
    throw new ApiError(
      422,
      "workflow_validation_failed",
      "Workflow violates the determinism contract",
      { details: { findings } },
    );
  }

  return {
    content,
    hash: hashWorkflowSource(content),
    meta,
    name: meta.name,
  };
}

export interface ListHostWorkflowsArgs {
  hostId: string;
  /** Server-resolved checkout root (`resolveProjectSourcePath`) — the daemon never decides where to look. */
  rootPath: string;
}

/**
 * Winners-only registry listing across the tiers (project > user > builtin)
 * visible from `rootPath`, via the daemon `workflow.list` RPC. Host-offline
 * surfaces bb's existing RPC semantics (502 `host_unavailable` /
 * 504 `command_timeout`).
 */
export async function listHostWorkflows(
  deps: WorkSessionDeps,
  args: ListHostWorkflowsArgs,
): Promise<HostDaemonWorkflowListing[]> {
  const result = await callHostOnlineRpc(deps, {
    hostId: args.hostId,
    command: { type: "workflow.list", rootPath: args.rootPath },
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  return result.workflows;
}

export interface ResolveNamedWorkflowArgs {
  hostId: string;
  name: string;
  rootPath: string;
}

export interface ResolvedNamedWorkflow {
  script: ValidatedWorkflowScript;
  tier: WorkflowRegistryTier;
}

/**
 * Resolve a named workflow for launch: list (for the winning tier — the
 * `workflow.resolve` result carries raw source only), fetch the raw source,
 * then validate server-side. Unknown names are a clean 404 before any source
 * fetch; validation failures reject 422 exactly like inline source.
 */
export async function resolveNamedWorkflowForLaunch(
  deps: WorkSessionDeps,
  args: ResolveNamedWorkflowArgs,
): Promise<ResolvedNamedWorkflow> {
  const listings = await listHostWorkflows(deps, {
    hostId: args.hostId,
    rootPath: args.rootPath,
  });
  const listing = listings.find((entry) => entry.name === args.name);
  if (!listing) {
    throw new ApiError(
      404,
      "workflow_not_found",
      `No workflow named "${args.name}" is visible from this project source`,
    );
  }

  const resolved = await callHostOnlineRpc(deps, {
    hostId: args.hostId,
    command: {
      type: "workflow.resolve",
      rootPath: args.rootPath,
      name: args.name,
    },
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

  return {
    script: validateWorkflowScriptSource(resolved.content),
    tier: listing.tier,
  };
}
