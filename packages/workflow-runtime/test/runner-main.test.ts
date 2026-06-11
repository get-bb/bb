// Process-level tests for the runner child entry: spawn the real
// runner-main.ts under tsx and act as the daemon over stdio — handshake,
// agent/run proxying, event streaming, abort, script rejection, and the
// stdin-close parent-death watchdog.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeWorkflowRunnerDaemonInboundLine,
  encodeWorkflowRunnerAbort,
  encodeWorkflowRunnerAgentRunResult,
  encodeWorkflowRunnerStartRequest,
} from "../src/runner-protocol.js";
import type {
  WorkflowRunnerDaemonInboundMessage,
  WorkflowRunnerStartParams,
} from "../src/runner-protocol.js";

const runnerMainPath = fileURLToPath(
  new URL("../src/runner-main.ts", import.meta.url),
);

const SINGLE_AGENT_WORKFLOW = `export const meta = { name: "one", description: "single agent" };
const answer = await agent("what is an owl?");
return { answer };
`;

interface RunnerHarness {
  child: ChildProcess;
  send: (line: string) => void;
  /** All decoded daemon-inbound messages observed so far. */
  messages: WorkflowRunnerDaemonInboundMessage[];
  waitForMessage: (
    predicate: (message: WorkflowRunnerDaemonInboundMessage) => boolean,
  ) => Promise<WorkflowRunnerDaemonInboundMessage>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const harnesses: RunnerHarness[] = [];
const tempDirs: string[] = [];

function spawnRunner(): RunnerHarness {
  const child = spawn(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
      runnerMainPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const messages: WorkflowRunnerDaemonInboundMessage[] = [];
  const waiters: Array<{
    predicate: (message: WorkflowRunnerDaemonInboundMessage) => boolean;
    resolve: (message: WorkflowRunnerDaemonInboundMessage) => void;
  }> = [];
  const stdout = createInterface({ input: child.stdout! });
  stdout.on("line", (line) => {
    const message = decodeWorkflowRunnerDaemonInboundLine(line);
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]!;
      if (waiter.predicate(message)) {
        waiters.splice(i, 1);
        waiter.resolve(message);
      }
    }
  });
  const stderrChunks: string[] = [];
  const stderr = createInterface({ input: child.stderr! });
  stderr.on("line", (line) => stderrChunks.push(line));
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const harness: RunnerHarness = {
    child,
    send: (line) => child.stdin!.write(`${line}\n`),
    messages,
    waitForMessage: (predicate) => {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    exited,
  };
  harnesses.push(harness);
  return harness;
}

async function makeStartParams(
  source: string,
  overrides: Partial<WorkflowRunnerStartParams> = {},
): Promise<WorkflowRunnerStartParams> {
  const dir = await mkdtemp(join(tmpdir(), "bb-wf-runner-"));
  tempDirs.push(dir);
  return {
    runId: "wfr_runner_main_test",
    source,
    filename: "test.workflow.js",
    seed: 7,
    baseTimeMs: 1_700_000_000_000,
    defaults: {
      provider: "codex",
      effort: "medium",
      sandbox: "read-only",
      cwd: dir,
      concurrency: 2,
      maxAgents: 10,
      maxFanout: 5,
      budgetOutputTokens: null,
    },
    journal: [],
    heartbeatFilePath: join(dir, ".heartbeat"),
    execTimeoutMs: null,
    ...overrides,
  };
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    if (harness.child.exitCode === null && !harness.child.killed) {
      harness.child.kill("SIGKILL");
    }
    await harness.exited;
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("runner-main", () => {
  it(
    "boots from run/start, proxies agent runs, streams events, and exits cleanly",
    async () => {
      const harness = spawnRunner();
      const params = await makeStartParams(SINGLE_AGENT_WORKFLOW);
      harness.send(encodeWorkflowRunnerStartRequest({ id: 1, params }));

      const ack = await harness.waitForMessage((m) => m.kind === "start-result");
      expect(ack).toEqual({
        kind: "start-result",
        id: 1,
        result: { accepted: true },
      });

      // A second run/start must be answered with an error, not restarted.
      harness.send(encodeWorkflowRunnerStartRequest({ id: 2, params }));
      const duplicate = await harness.waitForMessage(
        (m) => m.kind === "start-error" && m.id === 2,
      );
      expect(duplicate.kind).toBe("start-error");

      const agentRun = await harness.waitForMessage((m) => m.kind === "agent-run");
      if (agentRun.kind !== "agent-run") throw new Error("expected agent-run");
      expect(agentRun.params.spec.prompt).toBe("what is an owl?");
      expect(agentRun.params.spec.provider).toBe("codex");
      // The wire carries the runtime's journal-stable display index (1-based)
      // and the attempt counter — what the daemon keys per-agent logs on.
      expect(agentRun.params.agentIndex).toBe(1);
      expect(agentRun.params.attempt).toBe(0);

      harness.send(
        encodeWorkflowRunnerAgentRunResult({
          id: agentRun.id,
          result: {
            status: "completed",
            result: {
              text: "a bird",
              status: "completed",
              usage: { inputTokens: 5, outputTokens: 3 },
            },
          },
        }),
      );

      const terminal = await harness.waitForMessage(
        (m) => m.kind === "run-event" && m.event.type === "run/completed",
      );
      if (
        terminal.kind !== "run-event" ||
        terminal.event.type !== "run/completed"
      ) {
        throw new Error("expected run/completed");
      }
      expect(terminal.event.result).toEqual({ answer: "a bird" });
      expect(terminal.event.usage).toEqual({ inputTokens: 5, outputTokens: 3 });

      const exit = await harness.exited;
      expect(exit.code).toBe(0);

      // The run loop touched the heartbeat deadman file.
      const heartbeat = await readFile(params.heartbeatFilePath, "utf8");
      expect(Number(heartbeat)).toBeGreaterThan(0);

      const eventTypes = harness.messages
        .filter((m) => m.kind === "run-event")
        .map((m) => (m.kind === "run-event" ? m.event.type : ""));
      expect(eventTypes).toContain("run/started");
      expect(eventTypes).toContain("agent/completed");
    },
    30_000,
  );

  it(
    "rejects an invalid script as script_invalid without running it",
    async () => {
      const harness = spawnRunner();
      const params = await makeStartParams("const nope = 1;\n");
      harness.send(encodeWorkflowRunnerStartRequest({ id: 1, params }));

      const ack = await harness.waitForMessage((m) => m.kind === "start-result");
      if (ack.kind !== "start-result") throw new Error("expected start-result");
      expect(ack.result).toMatchObject({ accepted: false, code: "script_invalid" });

      const exit = await harness.exited;
      expect(exit.code).toBe(0);
      // Pre-side-effect rejection: no run events were emitted.
      expect(harness.messages.some((m) => m.kind === "run-event")).toBe(false);
    },
    30_000,
  );

  it(
    "aborts to run/cancelled when the daemon sends run/abort",
    async () => {
      const harness = spawnRunner();
      const params = await makeStartParams(SINGLE_AGENT_WORKFLOW);
      harness.send(encodeWorkflowRunnerStartRequest({ id: 1, params }));
      const agentRun = await harness.waitForMessage((m) => m.kind === "agent-run");
      if (agentRun.kind !== "agent-run") throw new Error("expected agent-run");

      harness.send(encodeWorkflowRunnerAbort());
      // The daemon side settles in-flight agent runs as interrupted on abort.
      harness.send(
        encodeWorkflowRunnerAgentRunResult({
          id: agentRun.id,
          result: { status: "interrupted" },
        }),
      );

      const terminal = await harness.waitForMessage(
        (m) => m.kind === "run-event" && m.event.type === "run/cancelled",
      );
      expect(terminal.kind).toBe("run-event");

      const exit = await harness.exited;
      expect(exit.code).toBe(0);
    },
    30_000,
  );

  it(
    "self-terminates when stdin closes mid-run (parent-death watchdog)",
    async () => {
      const harness = spawnRunner();
      const params = await makeStartParams(SINGLE_AGENT_WORKFLOW);
      harness.send(encodeWorkflowRunnerStartRequest({ id: 1, params }));
      await harness.waitForMessage((m) => m.kind === "agent-run");

      harness.child.stdin!.end();

      const exit = await harness.exited;
      expect(exit.code).toBe(1);
    },
    30_000,
  );
});
