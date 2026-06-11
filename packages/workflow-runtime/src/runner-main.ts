// The workflow runner child process entry (plan §3, layer 3): boots from an
// ndjson JSON-RPC handshake on stdio, wraps the M1 `runWorkflowRunner` loop,
// and proxies its injected Worker to the daemon — every `agent()` becomes an
// `agent/run` request the daemon's executor answers, run events stream up as
// `run/event` notifications, and the heartbeat file is touched by the run loop
// itself. The hardened vm (and only the vm) lives in this process: provider
// sessions are daemon children, so this process can hang or die without
// killing anything but itself.
//
// Lifecycle:
// - `run/start` request → parse the script. WorkflowSyntaxError replies
//   `{accepted:false, code:"script_invalid"}` (pre-side-effect, no events) and
//   exits; otherwise `{accepted:true}` and the run loop starts. The terminal
//   run event — not the ack — settles the run; the child exits 0 after it.
// - `run/abort` notification → aborts the run's AbortSignal. In-flight
//   agent/run requests settle from the daemon side (the daemon aborts its
//   executor too), so the loop unwinds to `run/cancelled`.
// - stdin close is the parent-death watchdog: with the daemon gone there is
//   nobody to receive events or answer agent runs — exit immediately. SIGTERM
//   (the daemon's graceful kill) aborts the run instead, giving the loop a
//   chance to emit its terminal event before the SIGKILL grace expires.

import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { InMemoryJournalStore } from "./journal.js";
import { WorkflowSyntaxError } from "./meta-parser.js";
import { runWorkflowRunner } from "./runner-entry.js";
import {
  decodeWorkflowRunnerChildInboundLine,
  encodeWorkflowRunnerAgentRunRequest,
  encodeWorkflowRunnerError,
  encodeWorkflowRunnerRunEvent,
  encodeWorkflowRunnerStartResult,
} from "./runner-protocol.js";
import type {
  WorkflowRunnerAgentRunResult,
  WorkflowRunnerStartParams,
  WorkflowRunnerWireId,
} from "./runner-protocol.js";
import { parseWorkflow } from "./meta-parser.js";
import { AgentError, AgentInterrupted } from "./worker-contract.js";
import type { Worker, WorkerProgress } from "./worker-contract.js";

interface PendingAgentRun {
  settle: (result: WorkflowRunnerAgentRunResult) => void;
  fail: (error: Error) => void;
}

let started = false;
let exiting = false;
const abortController = new AbortController();
let nextAgentRequestId = 1;
const pendingAgentRuns = new Map<WorkflowRunnerWireId, PendingAgentRun>();
const progressHandlers = new Map<string, (progress: WorkerProgress) => void>();

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Exit once every queued stdout write has flushed (writes drain in order). */
function exitAfterFlush(code: number): void {
  exiting = true;
  process.stdout.write("", () => process.exit(code));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleLine(line: string): void {
  const message = decodeWorkflowRunnerChildInboundLine(line);
  switch (message.kind) {
    case "start":
      handleStart(message.id, message.params);
      break;
    case "abort":
      abortController.abort();
      break;
    case "agent-progress":
      progressHandlers.get(message.params.callId)?.(message.params.progress);
      break;
    case "agent-result":
      pendingAgentRuns.get(message.id)?.settle(message.result);
      break;
    case "agent-error":
      pendingAgentRuns.get(message.id)?.fail(new Error(message.message));
      break;
    case "invalid":
      if (message.id !== undefined) {
        writeLine(
          encodeWorkflowRunnerError({ id: message.id, message: message.error }),
        );
      } else {
        process.stderr.write(`workflow runner: ${message.error}\n`);
      }
      break;
  }
}

function handleStart(
  id: WorkflowRunnerWireId,
  params: WorkflowRunnerStartParams,
): void {
  if (started) {
    writeLine(
      encodeWorkflowRunnerError({ id, message: "workflow run already started" }),
    );
    return;
  }
  started = true;

  try {
    parseWorkflow(params.source);
  } catch (error) {
    if (error instanceof WorkflowSyntaxError) {
      writeLine(
        encodeWorkflowRunnerStartResult({
          id,
          result: {
            accepted: false,
            code: "script_invalid",
            message: error.message,
          },
        }),
      );
    } else {
      writeLine(encodeWorkflowRunnerError({ id, message: errorMessage(error) }));
    }
    exitAfterFlush(0);
    return;
  }

  writeLine(encodeWorkflowRunnerStartResult({ id, result: { accepted: true } }));
  void runAccepted(params);
}

async function runAccepted(params: WorkflowRunnerStartParams): Promise<void> {
  const journal = new InMemoryJournalStore();
  for (const entry of params.journal) {
    journal.append(entry);
  }
  try {
    await runWorkflowRunner({
      runId: params.runId,
      source: params.source,
      filename: params.filename,
      args: params.args,
      seed: params.seed,
      baseTimeMs: params.baseTimeMs,
      defaults: params.defaults,
      worker: createDaemonProxyWorker(),
      journal,
      onRunEvent: (event) => writeLine(encodeWorkflowRunnerRunEvent({ event })),
      heartbeatFilePath: params.heartbeatFilePath,
      signal: abortController.signal,
      ...(params.execTimeoutMs !== null
        ? { execTimeoutMs: params.execTimeoutMs }
        : {}),
    });
  } catch (error) {
    // runWorkflowRunner throws only before any side effect (script_invalid was
    // already handled at the ack; this is structurally invalid run defaults).
    // No event was emitted — exit nonzero so the daemon reports runner_exited.
    process.stderr.write(
      `workflow runner failed before start: ${errorMessage(error)}\n`,
    );
    exitAfterFlush(1);
    return;
  }
  // The terminal run event already streamed via onRunEvent.
  exitAfterFlush(0);
}

/**
 * The Worker the vm-side Runtime drives: each runAgent becomes an `agent/run`
 * request answered by the daemon's executor. No request timeout — turns can
 * legitimately run for a long time, and the daemon owns the stall watchdog;
 * a dead daemon resolves through the stdin-close watchdog instead.
 */
function createDaemonProxyWorker(): Worker {
  return {
    runAgent: (spec, context) => {
      const id = nextAgentRequestId;
      nextAgentRequestId += 1;
      const callId = `wfc_${id}`;
      return new Promise((resolve, reject) => {
        progressHandlers.set(callId, context.onProgress);
        const cleanup = (): void => {
          progressHandlers.delete(callId);
          pendingAgentRuns.delete(id);
        };
        pendingAgentRuns.set(id, {
          settle: (result) => {
            cleanup();
            if (result.status === "completed") {
              resolve(result.result);
              return;
            }
            if (result.status === "interrupted") {
              reject(
                result.message === undefined
                  ? new AgentInterrupted()
                  : new AgentInterrupted(result.message),
              );
              return;
            }
            reject(
              new AgentError({
                provider: result.provider,
                code: result.code,
                message: result.message,
                retryable: result.retryable,
                ...(result.usage !== undefined ? { usage: result.usage } : {}),
              }),
            );
          },
          fail: (error) => {
            cleanup();
            reject(error);
          },
        });
        writeLine(
          encodeWorkflowRunnerAgentRunRequest({
            id,
            params: {
              callId,
              spec,
              agentIndex: context.agentIndex,
              attempt: context.attempt,
            },
          }),
        );
      });
    },
  };
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (entryPoint === undefined) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(resolvePath(entryPoint))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // A broken stdout pipe means the daemon is gone — nothing left to report to.
  process.stdout.on("error", () => process.exit(1));

  process.once("SIGTERM", () => abortController.abort());
  process.once("SIGINT", () => abortController.abort());

  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", handleLine);
  rl.on("close", () => {
    // Parent-death watchdog: the daemon holds our stdin for the lifetime of
    // the run. Provider processes are daemon children, not ours — nothing
    // else dies with us.
    if (!exiting) process.exit(1);
  });
}
