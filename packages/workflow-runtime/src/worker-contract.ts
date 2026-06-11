// The provider-execution boundary of the deterministic workflow runtime, ported from
// omegacode/src/worker/index.ts. bb's runtime receives a single injected Worker that multiplexes
// every provider (the daemon-side executor over createAgentRuntime in production, FakeWorker in
// tests), so omegacode's per-provider `Worker.id`/`shutdown()` and `WorkerFactory` are gone:
// provider selection rides `AgentSpec.provider`, and worker disposal is owned by the embedder.

import type { AgentProviderId } from "@bb/agent-providers";
import type { AgentResult, AgentSpec, AgentUsage } from "./dsl-types.js";

/** Conversation/progress signals a worker emits while a turn runs (drives live run events). */
export type WorkerProgress =
  /** Assistant message text (chunk or delta). */
  | { kind: "text"; text: string }
  /** Thinking / reasoning text. */
  | { kind: "reasoning"; text: string }
  /** Tool / command / file-change use. */
  | { kind: "tool"; id?: string; name: string; input?: unknown }
  | {
      kind: "tool-result";
      id?: string;
      name?: string;
      output?: string;
      isError?: boolean;
    }
  | { kind: "usage"; usage: Partial<AgentUsage> };

export interface WorkerContext {
  /**
   * The runtime's journal-stable display index for this logical agent — the
   * same index carried by `agent/queued|started|completed|failed` run events
   * and journal entries. Workers key per-agent artifacts (event logs,
   * synthetic thread ids, worktree branches) off it so run events and
   * worker-side artifacts stay correlated for per-agent drill-in.
   */
  agentIndex: number;
  /**
   * 0-based attempt of this `runAgent` call for the logical agent: `withRetry`
   * re-invocations and the corrective schema re-prompt each increment it.
   * Workers append every attempt's output into the one agentIndex-keyed log
   * and suffix attempt-scoped resources (worktree branches) with it.
   */
  attempt: number;
  signal: AbortSignal;
  onProgress: (progress: WorkerProgress) => void;
}

/** A provider backend: runs one agent turn to completion. */
export interface Worker {
  runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult>;
}

export interface AgentErrorArgs {
  provider: AgentProviderId;
  code: string;
  message: string;
  retryable?: boolean;
  usage?: AgentUsage;
}

/** A worker raised this when a turn failed for a provider reason (after retries). */
export class AgentError extends Error {
  readonly provider: AgentProviderId;
  readonly code: string;
  readonly retryable: boolean;
  /** Tokens the failed turn consumed, when the provider reported them — failed turns still bill. */
  readonly usage?: AgentUsage;

  constructor(args: AgentErrorArgs) {
    super(args.message);
    this.name = "AgentError";
    this.provider = args.provider;
    this.code = args.code;
    this.retryable = args.retryable ?? false;
    this.usage = args.usage;
  }
}

/** Raised when an agent turn was interrupted (cancel, abort signal, stall-abort). */
export class AgentInterrupted extends Error {
  constructor(message = "agent interrupted") {
    super(message);
    this.name = "AgentInterrupted";
  }
}
