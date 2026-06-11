// The ndjson JSON-RPC wire contract between the daemon's workflow-run-manager
// and the workflow runner child process (plan §3: "ndjson JSON-RPC over stdio,
// bridge-process pattern"). One JSON-RPC 2.0 object per line, both directions:
//
//   daemon → child   request       run/start        (config; ack = parse ok)
//   daemon → child   notification  run/abort        (cancel the run)
//   daemon → child   notification  agent/progress   (coarse worker progress)
//   child  → daemon  request       agent/run        (Worker.runAgent proxy)
//   child  → daemon  notification  run/event        (WorkflowRunEvent stream)
//
// The child's only requests are agent/run and the daemon's only request is
// run/start, so each side decodes inbound responses unambiguously. Every
// envelope is zod-validated at the boundary: the typed decoders below are the
// only way payloads enter either process, so `unknown` never leaks past this
// module. Schemas for the M1 runtime types (AgentSpec, journal entries, run
// events, …) live here rather than beside their interfaces because this wire
// is currently their only parse boundary; M3's server ingestion can lift them.

import { z } from "zod";
import { agentProviderIdSchema } from "@bb/agent-providers";
import {
  jsonObjectSchema,
  jsonValueSchema,
  reasoningLevelSchema,
} from "@bb/domain";
import {
  agentStatusSchema,
  workflowSandboxSchema,
} from "./dsl-types.js";
import type {
  AgentResult,
  AgentSpec,
  AgentUsage,
  RunDefaults,
} from "./dsl-types.js";
import type { WorkflowJournalEntry } from "./journal.js";
import type { AgentEventMeta, WorkflowRunEvent } from "./runtime.js";

// ---------------------------------------------------------------------------
// Runtime-type schemas (wire parse boundary for the M1 interfaces)
// ---------------------------------------------------------------------------

export const agentUsageSchema: z.ZodType<AgentUsage> = z.strictObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const workflowJournalEntrySchema: z.ZodType<WorkflowJournalEntry> =
  z.strictObject({
    key: z.string(),
    agentIndex: z.number().int(),
    branchKey: z.string(),
    status: agentStatusSchema,
    resultText: z.string(),
    structured: jsonValueSchema.optional(),
    usage: agentUsageSchema,
    provider: agentProviderIdSchema,
    model: z.string().optional(),
    worktreeBranch: z.string().optional(),
    durationMs: z.number(),
  });

export const agentSpecSchema: z.ZodType<AgentSpec> = z.strictObject({
  prompt: z.string(),
  provider: agentProviderIdSchema,
  model: z.string().optional(),
  effort: reasoningLevelSchema,
  cwd: z.string(),
  sandbox: workflowSandboxSchema,
  instructions: z.string().optional(),
  schema: jsonObjectSchema.optional(),
  worktree: z.boolean().optional(),
});

export const agentResultSchema: z.ZodType<AgentResult> = z.strictObject({
  text: z.string(),
  structured: jsonValueSchema.optional(),
  status: agentStatusSchema,
  usage: agentUsageSchema,
  worktreeBranch: z.string().optional(),
});

export const runDefaultsSchema: z.ZodType<RunDefaults> = z.strictObject({
  provider: agentProviderIdSchema,
  model: z.string().optional(),
  effort: reasoningLevelSchema,
  sandbox: workflowSandboxSchema,
  cwd: z.string(),
  concurrency: z.number(),
  maxAgents: z.number(),
  maxFanout: z.number(),
  budgetOutputTokens: z.number().nullable(),
});

const agentEventMetaShape = {
  agentIndex: z.number().int(),
  label: z.string(),
  provider: agentProviderIdSchema,
  model: z.string().optional(),
  phaseIndex: z.number().int().optional(),
  phaseTitle: z.string().optional(),
} satisfies Record<keyof AgentEventMeta, z.ZodType>;

export const workflowRunEventSchema: z.ZodType<WorkflowRunEvent> =
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("run/started"), runId: z.string() }),
    z.strictObject({
      type: z.literal("phase/started"),
      phaseIndex: z.number().int(),
      title: z.string(),
    }),
    z.strictObject({
      type: z.literal("agent/queued"),
      promptPreview: z.string(),
      ...agentEventMetaShape,
    }),
    z.strictObject({ type: z.literal("agent/started"), ...agentEventMetaShape }),
    z.strictObject({
      type: z.literal("agent/progress"),
      lastToolName: z.string().optional(),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      ...agentEventMetaShape,
    }),
    z.strictObject({
      type: z.literal("agent/completed"),
      cached: z.boolean(),
      entry: workflowJournalEntrySchema,
      ...agentEventMetaShape,
    }),
    z.strictObject({
      type: z.literal("agent/failed"),
      error: z.string(),
      entry: workflowJournalEntrySchema,
      ...agentEventMetaShape,
    }),
    z.strictObject({ type: z.literal("log"), message: z.string() }),
    z.strictObject({
      type: z.literal("run/completed"),
      result: jsonValueSchema,
      usage: agentUsageSchema,
    }),
    z.strictObject({
      type: z.literal("run/failed"),
      error: z.string(),
      usage: agentUsageSchema,
    }),
    z.strictObject({ type: z.literal("run/cancelled"), usage: agentUsageSchema }),
  ]);

// ---------------------------------------------------------------------------
// Method payloads
// ---------------------------------------------------------------------------

const START_METHOD = "run/start";
const ABORT_METHOD = "run/abort";
const RUN_EVENT_METHOD = "run/event";
const AGENT_RUN_METHOD = "agent/run";
const AGENT_PROGRESS_METHOD = "agent/progress";

/** The runner child's boot config — WorkflowRunnerConfig minus the injected seams. */
export const workflowRunnerStartParamsSchema = z.strictObject({
  runId: z.string(),
  source: z.string(),
  filename: z.string(),
  /** Launch-time args; absent = launched without args. */
  args: jsonValueSchema.optional(),
  seed: z.number(),
  baseTimeMs: z.number(),
  defaults: runDefaultsSchema,
  /** Resume journal preload; empty on a fresh run. */
  journal: z.array(workflowJournalEntrySchema),
  /** Touched by the child every heartbeat interval while the run is alive. */
  heartbeatFilePath: z.string(),
  /**
   * Hard wall-clock ceiling on the whole run (the vm timeout bounds only the
   * synchronous prefix). Explicit per the no-hidden-defaults rule: null means
   * unbounded; M3's workflow.start carries the server-resolved policy value.
   */
  execTimeoutMs: z.number().int().positive().nullable(),
});
export type WorkflowRunnerStartParams = z.infer<
  typeof workflowRunnerStartParamsSchema
>;

/**
 * The run/start ack. Acceptance means the script parsed and the run loop is
 * live (events follow as run/event notifications; the terminal event — not
 * this ack — settles the run). `script_invalid` is the pre-side-effect
 * rejection path: no event was emitted and the child exits after replying.
 */
export const workflowRunnerStartResultSchema = z.union([
  z.strictObject({ accepted: z.literal(true) }),
  z.strictObject({
    accepted: z.literal(false),
    code: z.literal("script_invalid"),
    message: z.string(),
  }),
]);
export type WorkflowRunnerStartResult = z.infer<
  typeof workflowRunnerStartResultSchema
>;

export const workflowRunnerAgentRunParamsSchema = z.strictObject({
  /** Child-assigned id correlating agent/progress notifications to this call. */
  callId: z.string(),
  spec: agentSpecSchema,
  /**
   * The runtime's journal-stable display index for the logical agent (see
   * WorkerContext.agentIndex) — the daemon keys per-agent event logs, thread
   * ids, and worktree branches off it so run events and daemon artifacts
   * correlate for drill-in.
   */
  agentIndex: z.number().int().nonnegative(),
  /** 0-based attempt of this call for the logical agent (see WorkerContext.attempt). */
  attempt: z.number().int().nonnegative(),
});
export type WorkflowRunnerAgentRunParams = z.infer<
  typeof workflowRunnerAgentRunParamsSchema
>;

/** A Worker.runAgent settlement, mapped onto the worker-contract error taxonomy. */
export const workflowRunnerAgentRunResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("completed"), result: agentResultSchema }),
  z.strictObject({
    status: z.literal("error"),
    provider: agentProviderIdSchema,
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    /** Tokens the failed attempt consumed — failed turns still bill. */
    usage: agentUsageSchema.optional(),
  }),
  z.strictObject({
    status: z.literal("interrupted"),
    message: z.string().optional(),
  }),
]);
export type WorkflowRunnerAgentRunResult = z.infer<
  typeof workflowRunnerAgentRunResultSchema
>;

/**
 * The coarse WorkerProgress subset that crosses the wire: only the kinds the
 * workflow runtime folds into `agent/progress` run events. text/reasoning/
 * tool-result progress stays daemon-side (it feeds the per-agent provider
 * event logs, not the run-event stream). Assignable to WorkerProgress.
 */
export const workflowRunnerAgentProgressSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tool"), name: z.string() }),
  z.strictObject({
    kind: z.literal("usage"),
    usage: z.strictObject({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    }),
  }),
]);
export type WorkflowRunnerAgentProgress = z.infer<
  typeof workflowRunnerAgentProgressSchema
>;

export const workflowRunnerAgentProgressParamsSchema = z.strictObject({
  callId: z.string(),
  progress: workflowRunnerAgentProgressSchema,
});
export type WorkflowRunnerAgentProgressParams = z.infer<
  typeof workflowRunnerAgentProgressParamsSchema
>;

const workflowRunnerRunEventParamsSchema = z.strictObject({
  event: workflowRunEventSchema,
});

// ---------------------------------------------------------------------------
// Envelope framing
// ---------------------------------------------------------------------------

export type WorkflowRunnerWireId = string | number;

const wireIdSchema = z.union([z.string(), z.number()]);

const wireEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: wireIdSchema.optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

const WIRE_ERROR_CODE = -32600;

function parseEnvelope(
  line: string,
): { ok: true; envelope: WireEnvelope } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, error: "line is not JSON" };
  }
  const parsed = wireEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "line is not a JSON-RPC 2.0 envelope" };
  }
  return { ok: true, envelope: parsed.data };
}

/** Lines the runner child receives from the daemon. */
export type WorkflowRunnerChildInboundMessage =
  | {
      kind: "start";
      id: WorkflowRunnerWireId;
      params: WorkflowRunnerStartParams;
    }
  | { kind: "abort" }
  | { kind: "agent-progress"; params: WorkflowRunnerAgentProgressParams }
  | {
      kind: "agent-result";
      id: WorkflowRunnerWireId;
      result: WorkflowRunnerAgentRunResult;
    }
  /** An error response (or malformed result) for an agent/run request — settles it as a failure. */
  | { kind: "agent-error"; id: WorkflowRunnerWireId; message: string }
  /** Undecodable line; `id` present when it was a request that can be answered with an error. */
  | { kind: "invalid"; error: string; id?: WorkflowRunnerWireId };

export function decodeWorkflowRunnerChildInboundLine(
  line: string,
): WorkflowRunnerChildInboundMessage {
  const parsed = parseEnvelope(line);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error };
  const { envelope } = parsed;

  if (envelope.method !== undefined) {
    if (envelope.id !== undefined) {
      if (envelope.method === START_METHOD) {
        const params = workflowRunnerStartParamsSchema.safeParse(
          envelope.params,
        );
        return params.success
          ? { kind: "start", id: envelope.id, params: params.data }
          : {
              kind: "invalid",
              id: envelope.id,
              error: `invalid ${START_METHOD} params`,
            };
      }
      return {
        kind: "invalid",
        id: envelope.id,
        error: `unknown request method "${envelope.method}"`,
      };
    }
    if (envelope.method === ABORT_METHOD) return { kind: "abort" };
    if (envelope.method === AGENT_PROGRESS_METHOD) {
      const params = workflowRunnerAgentProgressParamsSchema.safeParse(
        envelope.params,
      );
      return params.success
        ? { kind: "agent-progress", params: params.data }
        : { kind: "invalid", error: `invalid ${AGENT_PROGRESS_METHOD} params` };
    }
    return {
      kind: "invalid",
      error: `unknown notification method "${envelope.method}"`,
    };
  }

  if (envelope.id !== undefined) {
    if (envelope.error !== undefined) {
      return {
        kind: "agent-error",
        id: envelope.id,
        message: envelope.error.message,
      };
    }
    const result = workflowRunnerAgentRunResultSchema.safeParse(
      envelope.result,
    );
    return result.success
      ? { kind: "agent-result", id: envelope.id, result: result.data }
      : {
          kind: "agent-error",
          id: envelope.id,
          message: `invalid ${AGENT_RUN_METHOD} result payload`,
        };
  }

  return { kind: "invalid", error: "envelope has neither method nor id" };
}

/** Lines the daemon receives from the runner child. */
export type WorkflowRunnerDaemonInboundMessage =
  | {
      kind: "agent-run";
      id: WorkflowRunnerWireId;
      params: WorkflowRunnerAgentRunParams;
    }
  | { kind: "run-event"; event: WorkflowRunEvent }
  | {
      kind: "start-result";
      id: WorkflowRunnerWireId;
      result: WorkflowRunnerStartResult;
    }
  /** An error response (or malformed result) for the run/start request — fails the start. */
  | { kind: "start-error"; id: WorkflowRunnerWireId; message: string }
  /** Undecodable line; `id` present when it was a request that can be answered with an error. */
  | { kind: "invalid"; error: string; id?: WorkflowRunnerWireId };

export function decodeWorkflowRunnerDaemonInboundLine(
  line: string,
): WorkflowRunnerDaemonInboundMessage {
  const parsed = parseEnvelope(line);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error };
  const { envelope } = parsed;

  if (envelope.method !== undefined) {
    if (envelope.id !== undefined) {
      if (envelope.method === AGENT_RUN_METHOD) {
        const params = workflowRunnerAgentRunParamsSchema.safeParse(
          envelope.params,
        );
        return params.success
          ? { kind: "agent-run", id: envelope.id, params: params.data }
          : {
              kind: "invalid",
              id: envelope.id,
              error: `invalid ${AGENT_RUN_METHOD} params`,
            };
      }
      return {
        kind: "invalid",
        id: envelope.id,
        error: `unknown request method "${envelope.method}"`,
      };
    }
    if (envelope.method === RUN_EVENT_METHOD) {
      const params = workflowRunnerRunEventParamsSchema.safeParse(
        envelope.params,
      );
      return params.success
        ? { kind: "run-event", event: params.data.event }
        : { kind: "invalid", error: `invalid ${RUN_EVENT_METHOD} params` };
    }
    return {
      kind: "invalid",
      error: `unknown notification method "${envelope.method}"`,
    };
  }

  if (envelope.id !== undefined) {
    if (envelope.error !== undefined) {
      return {
        kind: "start-error",
        id: envelope.id,
        message: envelope.error.message,
      };
    }
    const result = workflowRunnerStartResultSchema.safeParse(envelope.result);
    return result.success
      ? { kind: "start-result", id: envelope.id, result: result.data }
      : {
          kind: "start-error",
          id: envelope.id,
          message: `invalid ${START_METHOD} result payload`,
        };
  }

  return { kind: "invalid", error: "envelope has neither method nor id" };
}

// ---------------------------------------------------------------------------
// Encoders (one line each, no trailing newline)
// ---------------------------------------------------------------------------

export function encodeWorkflowRunnerStartRequest(args: {
  id: WorkflowRunnerWireId;
  params: WorkflowRunnerStartParams;
}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: args.id,
    method: START_METHOD,
    params: args.params,
  });
}

export function encodeWorkflowRunnerStartResult(args: {
  id: WorkflowRunnerWireId;
  result: WorkflowRunnerStartResult;
}): string {
  return JSON.stringify({ jsonrpc: "2.0", id: args.id, result: args.result });
}

export function encodeWorkflowRunnerAbort(): string {
  return JSON.stringify({ jsonrpc: "2.0", method: ABORT_METHOD });
}

export function encodeWorkflowRunnerRunEvent(args: {
  event: WorkflowRunEvent;
}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: RUN_EVENT_METHOD,
    params: { event: args.event },
  });
}

export function encodeWorkflowRunnerAgentRunRequest(args: {
  id: WorkflowRunnerWireId;
  params: WorkflowRunnerAgentRunParams;
}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: args.id,
    method: AGENT_RUN_METHOD,
    params: args.params,
  });
}

export function encodeWorkflowRunnerAgentRunResult(args: {
  id: WorkflowRunnerWireId;
  result: WorkflowRunnerAgentRunResult;
}): string {
  return JSON.stringify({ jsonrpc: "2.0", id: args.id, result: args.result });
}

export function encodeWorkflowRunnerAgentProgress(args: {
  params: WorkflowRunnerAgentProgressParams;
}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: AGENT_PROGRESS_METHOD,
    params: args.params,
  });
}

export function encodeWorkflowRunnerError(args: {
  id: WorkflowRunnerWireId;
  message: string;
}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: args.id,
    error: { code: WIRE_ERROR_CODE, message: args.message },
  });
}
