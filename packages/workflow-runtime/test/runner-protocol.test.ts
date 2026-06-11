// Codec tests for the daemon <-> runner-child ndjson JSON-RPC protocol: every
// encoder's output decodes back to the same typed message on the receiving
// side, and malformed lines degrade to typed "invalid"/error messages instead
// of leaking unvalidated payloads.

import { describe, expect, it } from "vitest";
import type { WorkflowJournalEntry } from "../src/journal.js";
import {
  decodeWorkflowRunnerChildInboundLine,
  decodeWorkflowRunnerDaemonInboundLine,
  encodeWorkflowRunnerAbort,
  encodeWorkflowRunnerAgentProgress,
  encodeWorkflowRunnerAgentRunRequest,
  encodeWorkflowRunnerAgentRunResult,
  encodeWorkflowRunnerError,
  encodeWorkflowRunnerRunEvent,
  encodeWorkflowRunnerStartRequest,
  encodeWorkflowRunnerStartResult,
} from "../src/runner-protocol.js";
import type {
  WorkflowRunnerAgentRunParams,
  WorkflowRunnerStartParams,
} from "../src/runner-protocol.js";
import type { WorkflowRunEvent } from "../src/runtime.js";

const START_PARAMS: WorkflowRunnerStartParams = {
  runId: "wfr_test",
  source: 'export const meta = { name: "t", description: "d" };\nreturn 1;\n',
  filename: "t.workflow.js",
  args: { topic: "owls" },
  seed: 42,
  baseTimeMs: 1_700_000_000_000,
  defaults: {
    provider: "codex",
    effort: "medium",
    sandbox: "read-only",
    cwd: "/tmp/work",
    concurrency: 2,
    maxAgents: 10,
    maxFanout: 5,
    budgetOutputTokens: null,
  },
  journal: [],
  heartbeatFilePath: "/tmp/run/.heartbeat",
  execTimeoutMs: null,
};

const JOURNAL_ENTRY: WorkflowJournalEntry = {
  key: "bb1:abc",
  agentIndex: 1,
  branchKey: "root",
  status: "completed",
  resultText: "done",
  structured: { answer: "yes" },
  usage: { inputTokens: 10, outputTokens: 5 },
  provider: "claude-code",
  model: "some-model",
  durationMs: 1234,
};

const AGENT_RUN_PARAMS: WorkflowRunnerAgentRunParams = {
  callId: "wfc_1",
  spec: {
    prompt: "research owls",
    provider: "codex",
    effort: "medium",
    cwd: "/tmp/work",
    sandbox: "read-only",
    schema: { type: "object" },
  },
  agentIndex: 1,
  attempt: 0,
};

describe("runner child inbound", () => {
  it("round-trips run/start", () => {
    const line = encodeWorkflowRunnerStartRequest({ id: 7, params: START_PARAMS });
    const decoded = decodeWorkflowRunnerChildInboundLine(line);
    expect(decoded).toEqual({ kind: "start", id: 7, params: START_PARAMS });
  });

  it("rejects malformed run/start params with the request id", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "run/start",
      params: { runId: "wfr_x" },
    });
    const decoded = decodeWorkflowRunnerChildInboundLine(line);
    expect(decoded.kind).toBe("invalid");
    if (decoded.kind === "invalid") {
      expect(decoded.id).toBe(9);
    }
  });

  it("decodes run/abort", () => {
    expect(
      decodeWorkflowRunnerChildInboundLine(encodeWorkflowRunnerAbort()),
    ).toEqual({ kind: "abort" });
  });

  it("round-trips agent/progress notifications", () => {
    const params = {
      callId: "wfc_2",
      progress: { kind: "usage", usage: { inputTokens: 3, outputTokens: 4 } },
    } as const;
    const decoded = decodeWorkflowRunnerChildInboundLine(
      encodeWorkflowRunnerAgentProgress({ params }),
    );
    expect(decoded).toEqual({ kind: "agent-progress", params });
  });

  it("round-trips every agent/run result variant", () => {
    const completed = {
      status: "completed",
      result: {
        text: "ok",
        structured: { answer: "yes" },
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    } as const;
    expect(
      decodeWorkflowRunnerChildInboundLine(
        encodeWorkflowRunnerAgentRunResult({ id: 1, result: completed }),
      ),
    ).toEqual({ kind: "agent-result", id: 1, result: completed });

    const failed = {
      status: "error",
      provider: "pi",
      code: "turn_stalled",
      message: "stalled",
      retryable: true,
      usage: { inputTokens: 7, outputTokens: 0 },
    } as const;
    expect(
      decodeWorkflowRunnerChildInboundLine(
        encodeWorkflowRunnerAgentRunResult({ id: 2, result: failed }),
      ),
    ).toEqual({ kind: "agent-result", id: 2, result: failed });

    const interrupted = { status: "interrupted", message: "cancelled" } as const;
    expect(
      decodeWorkflowRunnerChildInboundLine(
        encodeWorkflowRunnerAgentRunResult({ id: 3, result: interrupted }),
      ),
    ).toEqual({ kind: "agent-result", id: 3, result: interrupted });
  });

  it("maps error responses and malformed results to agent-error", () => {
    expect(
      decodeWorkflowRunnerChildInboundLine(
        encodeWorkflowRunnerError({ id: 4, message: "boom" }),
      ),
    ).toEqual({ kind: "agent-error", id: 4, message: "boom" });

    const malformed = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      result: { status: "nope" },
    });
    const decoded = decodeWorkflowRunnerChildInboundLine(malformed);
    expect(decoded.kind).toBe("agent-error");
  });

  it("flags non-JSON, non-envelope, and unknown-method lines as invalid", () => {
    expect(decodeWorkflowRunnerChildInboundLine("not json").kind).toBe(
      "invalid",
    );
    expect(decodeWorkflowRunnerChildInboundLine('{"foo":1}').kind).toBe(
      "invalid",
    );
    const unknownRequest = decodeWorkflowRunnerChildInboundLine(
      JSON.stringify({ jsonrpc: "2.0", id: 6, method: "run/unknown" }),
    );
    expect(unknownRequest.kind).toBe("invalid");
    if (unknownRequest.kind === "invalid") {
      expect(unknownRequest.id).toBe(6);
    }
  });
});

describe("daemon inbound", () => {
  it("round-trips agent/run requests", () => {
    const line = encodeWorkflowRunnerAgentRunRequest({
      id: 11,
      params: AGENT_RUN_PARAMS,
    });
    expect(decodeWorkflowRunnerDaemonInboundLine(line)).toEqual({
      kind: "agent-run",
      id: 11,
      params: AGENT_RUN_PARAMS,
    });
  });

  it("rejects malformed agent/run params with the request id", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "agent/run",
      params: { callId: "wfc_1", spec: { prompt: "x" } },
    });
    const decoded = decodeWorkflowRunnerDaemonInboundLine(line);
    expect(decoded.kind).toBe("invalid");
    if (decoded.kind === "invalid") {
      expect(decoded.id).toBe(12);
    }
  });

  it("round-trips run events including journal-bearing ones", () => {
    const events: WorkflowRunEvent[] = [
      { type: "run/started", runId: "wfr_test" },
      { type: "phase/started", phaseIndex: 1, title: "Research" },
      {
        type: "agent/completed",
        cached: false,
        entry: JOURNAL_ENTRY,
        agentIndex: 1,
        label: "research owls",
        provider: "claude-code",
        model: "some-model",
        phaseIndex: 1,
        phaseTitle: "Research",
      },
      {
        type: "agent/failed",
        error: "boom",
        entry: { ...JOURNAL_ENTRY, status: "failed", resultText: "" },
        agentIndex: 2,
        label: "second",
        provider: "codex",
      },
      {
        type: "run/completed",
        result: { ok: true },
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ];
    for (const event of events) {
      expect(
        decodeWorkflowRunnerDaemonInboundLine(
          encodeWorkflowRunnerRunEvent({ event }),
        ),
      ).toEqual({ kind: "run-event", event });
    }
  });

  it("rejects a run event with an out-of-enum payload", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "run/event",
      params: { event: { type: "run/exploded" } },
    });
    expect(decodeWorkflowRunnerDaemonInboundLine(line).kind).toBe("invalid");
  });

  it("round-trips run/start results and maps errors to start-error", () => {
    expect(
      decodeWorkflowRunnerDaemonInboundLine(
        encodeWorkflowRunnerStartResult({ id: 1, result: { accepted: true } }),
      ),
    ).toEqual({ kind: "start-result", id: 1, result: { accepted: true } });

    const rejected = {
      accepted: false,
      code: "script_invalid",
      message: "meta must be a pure object literal",
    } as const;
    expect(
      decodeWorkflowRunnerDaemonInboundLine(
        encodeWorkflowRunnerStartResult({ id: 2, result: rejected }),
      ),
    ).toEqual({ kind: "start-result", id: 2, result: rejected });

    expect(
      decodeWorkflowRunnerDaemonInboundLine(
        encodeWorkflowRunnerError({ id: 3, message: "already started" }),
      ),
    ).toEqual({ kind: "start-error", id: 3, message: "already started" });

    const malformed = JSON.stringify({ jsonrpc: "2.0", id: 4, result: {} });
    expect(decodeWorkflowRunnerDaemonInboundLine(malformed).kind).toBe(
      "start-error",
    );
  });
});
