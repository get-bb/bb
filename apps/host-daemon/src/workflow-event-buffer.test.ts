import Database from "better-sqlite3";
import {
  canonicalizeWorkflowRunEventPayload,
  hostDaemonProducerEventIdSchema,
  type HostDaemonProducerEventId,
  type WorkflowRunEvent,
} from "@bb/domain";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowEventBuffer,
  shouldFlushWorkflowRunEventImmediately,
  WorkflowEventBufferDisposedError,
  type CreateWorkflowEventBufferOptions,
  type WorkflowRunEventPostResult,
} from "./workflow-event-buffer.js";
import type { HostDaemonWorkflowRunEventEnvelope } from "@bb/host-daemon-contract";
import { ServerResponseError } from "./server-client.js";

interface OutboundRow {
  producerEventId: string;
  runId: string;
  eventType: string;
  payloadHash: string;
  postAttemptCount: number;
}

function createLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  };
}

const dataDirs: string[] = [];

function createDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "bb-workflow-event-buffer-"));
  dataDirs.push(dataDir);
  return dataDir;
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { force: true, recursive: true });
  }
});

function createProducerEventId(value: string): HostDaemonProducerEventId {
  return hostDaemonProducerEventIdSchema.parse(value);
}

function createProducerEventIdGenerator(
  values: readonly string[],
): CreateWorkflowEventBufferOptions["createProducerEventId"] {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("No producer event id left in test generator");
    }
    index += 1;
    return createProducerEventId(value);
  };
}

function acceptedPostResult(
  events: readonly HostDaemonWorkflowRunEventEnvelope[],
): WorkflowRunEventPostResult {
  return {
    acceptedEvents: events.map((event, index) => ({
      producerEventId: event.producerEventId,
      runId: event.runId,
      sequence: index + 1,
    })),
    rejectedEvents: [],
  };
}

function progressEvent(agentIndex: number): WorkflowRunEvent {
  return {
    type: "agent/progress",
    agentIndex,
    label: `agent-${agentIndex}`,
    provider: "fake-provider",
    lastToolName: "bash",
  };
}

function completedRunEvent(): WorkflowRunEvent {
  return {
    type: "run/completed",
    result: { summary: "done" },
    usage: { inputTokens: 10, outputTokens: 4 },
  };
}

function agentCompletedEvent(agentIndex: number): WorkflowRunEvent {
  return {
    type: "agent/completed",
    cached: false,
    agentIndex,
    label: `agent-${agentIndex}`,
    provider: "fake-provider",
    entry: {
      key: `key-${agentIndex}`,
      agentIndex,
      branchKey: "root",
      status: "completed",
      resultText: "result text",
      usage: { inputTokens: 3, outputTokens: 2 },
      provider: "fake-provider",
      durationMs: 12,
    },
  };
}

function readOutboundRows(dataDir: string): OutboundRow[] {
  const db = new Database(join(dataDir, "workflow-event-spool.sqlite"));
  try {
    return db
      .prepare<
        [],
        OutboundRow
      >("SELECT producerEventId, runId, eventType, payloadHash, postAttemptCount FROM outbound_workflow_run_events ORDER BY localOrder ASC")
      .all();
  } finally {
    db.close();
  }
}

describe("workflow event buffer", () => {
  it("flushes pushed events in order through the poster callback", async () => {
    const dataDir = createDataDir();
    const batches: HostDaemonWorkflowRunEventEnvelope[][] = [];
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger: createLogger(),
      createProducerEventId: createProducerEventIdGenerator([
        "hdevt_aaaaaaaaaaaaaaaaaaaa",
        "hdevt_bbbbbbbbbbbbbbbbbbbb",
        "hdevt_cccccccccccccccccccc",
      ]),
      postEvents: async (events) => {
        batches.push(events);
        return acceptedPostResult(events);
      },
    });

    buffer.push({ runId: "wfr_1", event: progressEvent(0) });
    buffer.push({ runId: "wfr_1", event: { type: "log", message: "step" } });
    buffer.push({ runId: "wfr_2", event: { type: "run/started", runId: "wfr_2" } });
    await buffer.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        producerEventId: "hdevt_aaaaaaaaaaaaaaaaaaaa",
        runId: "wfr_1",
        event: { type: "agent/progress" },
      },
      {
        producerEventId: "hdevt_bbbbbbbbbbbbbbbbbbbb",
        runId: "wfr_1",
        event: { type: "log" },
      },
      {
        producerEventId: "hdevt_cccccccccccccccccccc",
        runId: "wfr_2",
        event: { type: "run/started" },
      },
    ]);
    expect(buffer.depth()).toBe(0);
    await buffer.dispose();
  });

  it("rejects a run/started payload whose runId diverges from the envelope", async () => {
    const dataDir = createDataDir();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger: createLogger(),
      postEvents: async (events) => acceptedPostResult(events),
    });
    expect(() =>
      buffer.push({
        runId: "wfr_envelope",
        event: { type: "run/started", runId: "wfr_other" },
      }),
    ).toThrow("runId does not match payload runId");
    expect(buffer.depth()).toBe(0);
    await buffer.dispose();
  });

  it("stores the protocol-independent canonical payload hash", async () => {
    const dataDir = createDataDir();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger: createLogger(),
      // Never settles: the row must still be in the spool when read below.
      postEvents: async () => {
        throw new Error("server unreachable");
      },
    });

    const event = completedRunEvent();
    buffer.push({ runId: "wfr_hash", event });
    await buffer.dispose();

    const rows = readOutboundRows(dataDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payloadHash).toBe(
      createHash("sha256")
        .update(canonicalizeWorkflowRunEventPayload({ event, runId: "wfr_hash" }))
        .digest("hex"),
    );
  });

  it("retries a failed post with identical producer ids and payloads", async () => {
    const dataDir = createDataDir();
    const batches: HostDaemonWorkflowRunEventEnvelope[][] = [];
    let failNext = true;
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger: createLogger(),
      postEvents: async (events) => {
        batches.push(events);
        if (failNext) {
          failNext = false;
          throw new Error("connect ECONNREFUSED");
        }
        return acceptedPostResult(events);
      },
    });

    buffer.push({ runId: "wfr_retry", event: progressEvent(1) });
    await buffer.flush();
    expect(buffer.depth()).toBe(1);
    expect(readOutboundRows(dataDir)[0]?.postAttemptCount).toBe(1);

    await buffer.flush();
    expect(buffer.depth()).toBe(0);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
    await buffer.dispose();
  });

  it("survives a restart and resends unacknowledged events unchanged", async () => {
    const dataDir = createDataDir();
    const logger = createLogger();
    const first = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger,
      postEvents: async () => {
        throw new Error("server unreachable");
      },
    });
    const pushed = first.push({
      runId: "wfr_restart",
      event: completedRunEvent(),
    });
    await first.flush();
    await first.dispose();

    const batches: HostDaemonWorkflowRunEventEnvelope[][] = [];
    const second = createWorkflowEventBuffer({
      dataDir,
      logger,
      postEvents: async (events) => {
        batches.push(events);
        return acceptedPostResult(events);
      },
    });
    expect(second.depth()).toBe(1);
    await second.flush();

    expect(second.depth()).toBe(0);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toEqual({
      producerEventId: pushed.producerEventId,
      runId: "wfr_restart",
      event: completedRunEvent(),
    });
    await second.dispose();
  });

  it("deletes rejected rows so stale events do not block valid events", async () => {
    const dataDir = createDataDir();
    const logger = createLogger();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger,
      createProducerEventId: createProducerEventIdGenerator([
        "hdevt_dddddddddddddddddddd",
        "hdevt_eeeeeeeeeeeeeeeeeeee",
      ]),
      postEvents: async (events) => ({
        acceptedEvents: events
          .filter((event) => event.producerEventId !== "hdevt_dddddddddddddddddddd")
          .map((event, index) => ({
            producerEventId: event.producerEventId,
            runId: event.runId,
            sequence: index + 1,
          })),
        rejectedEvents: events
          .filter((event) => event.producerEventId === "hdevt_dddddddddddddddddddd")
          .map((event) => ({
            producerEventId: event.producerEventId,
            runId: event.runId,
            reason: "run_not_owned_by_host",
          })),
      }),
    });

    buffer.push({ runId: "wfr_foreign", event: progressEvent(0) });
    buffer.push({ runId: "wfr_mine", event: progressEvent(1) });
    await buffer.flush();

    expect(buffer.depth()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectedEvents: [
          expect.objectContaining({
            producerEventId: "hdevt_dddddddddddddddddddd",
            reason: "run_not_owned_by_host",
            runId: "wfr_foreign",
          }),
        ],
      }),
      "workflow event flush discarded rejected events",
    );
    await buffer.dispose();
  });

  it("fails closed after repeated non-retryable server post failures", async () => {
    const dataDir = createDataDir();
    const logger = createLogger();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger,
      postEvents: async () => {
        throw new ServerResponseError({
          action: "post workflow run events",
          bodyMessage: "bad payload",
          code: "invalid_request",
          retryable: false,
          status: 400,
          statusText: "Bad Request",
        });
      },
    });

    buffer.push({ runId: "wfr_bad", event: progressEvent(0) });
    await buffer.flush();
    await buffer.flush();
    await expect(buffer.flush()).rejects.toThrow(
      "non-retryable server response after 3 attempts",
    );
    // The event is retained durably — failing closed never drops local data.
    expect(buffer.depth()).toBe(1);
    await buffer.dispose();
  });

  it("fails closed when an acknowledgement references an unsent producer id", async () => {
    const dataDir = createDataDir();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      logger: createLogger(),
      postEvents: async () => ({
        acceptedEvents: [
          {
            producerEventId: createProducerEventId("hdevt_ffffffffffffffffffff"),
            runId: "wfr_x",
            sequence: 1,
          },
        ],
        rejectedEvents: [],
      }),
    });

    buffer.push({ runId: "wfr_x", event: progressEvent(0) });
    await expect(buffer.flush()).rejects.toThrow(
      "acknowledgement for unsent producerEventId",
    );
    expect(buffer.depth()).toBe(1);
    await buffer.dispose();
  });

  it("rejects pushes after disposal", async () => {
    const dataDir = createDataDir();
    const buffer = createWorkflowEventBuffer({
      dataDir,
      logger: createLogger(),
      postEvents: async (events) => acceptedPostResult(events),
    });
    await buffer.dispose();
    expect(() =>
      buffer.push({ runId: "wfr_late", event: progressEvent(0) }),
    ).toThrow(WorkflowEventBufferDisposedError);
  });

  it("classifies immediate flush event types", () => {
    expect(shouldFlushWorkflowRunEventImmediately(completedRunEvent())).toBe(
      true,
    );
    expect(
      shouldFlushWorkflowRunEventImmediately({
        type: "run/failed",
        error: "boom",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ).toBe(true);
    expect(
      shouldFlushWorkflowRunEventImmediately({
        type: "run/cancelled",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ).toBe(true);
    expect(shouldFlushWorkflowRunEventImmediately(agentCompletedEvent(0))).toBe(
      true,
    );
    expect(
      shouldFlushWorkflowRunEventImmediately({
        type: "agent/failed",
        error: "agent broke",
        agentIndex: 0,
        label: "agent-0",
        provider: "fake-provider",
        entry: {
          key: "key-0",
          agentIndex: 0,
          branchKey: "root",
          status: "failed",
          resultText: "",
          usage: { inputTokens: 1, outputTokens: 0 },
          provider: "fake-provider",
          durationMs: 5,
        },
      }),
    ).toBe(true);
    expect(shouldFlushWorkflowRunEventImmediately(progressEvent(0))).toBe(
      false,
    );
    expect(
      shouldFlushWorkflowRunEventImmediately({
        type: "log",
        message: "hello",
      }),
    ).toBe(false);
    expect(
      shouldFlushWorkflowRunEventImmediately({
        type: "run/started",
        runId: "wfr_1",
      }),
    ).toBe(false);
  });
});
