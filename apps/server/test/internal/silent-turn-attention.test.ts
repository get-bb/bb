import { getThread, threads } from "@bb/db";
import { eq } from "drizzle-orm";
import { turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

async function completeTurn(completion: {
  status: "completed" | "failed";
  silent?: true;
}) {
  const harness = await createTestAppHarness();
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "acp-example",
    status: "active",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "hello",
    providerThreadId: "provider-thread",
    threadId: thread.id,
  });
  harness.deps.db
    .update(threads)
    .set({ latestAttentionAt: 1 })
    .where(eq(threads.id, thread.id))
    .run();
  const events: HostDaemonEventEnvelope[] = [
    {
      threadId: thread.id,
      event: {
        type: "turn/started",
        threadId: thread.id,
        providerThreadId: "provider-thread",
        scope: turnScope("turn-1"),
      },
    },
    {
      threadId: thread.id,
      event: {
        type: "turn/completed",
        threadId: thread.id,
        providerThreadId: "provider-thread",
        scope: turnScope("turn-1"),
        ...completion,
      },
    },
  ];
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: session.id,
      eventGroups: groupHostDaemonEvents(events),
    }),
  });
  expect(response.status).toBe(200);
  await vi.waitFor(() =>
    expect(getThread(harness.deps.db, thread.id)?.status).not.toBe("active"),
  );
  return getThread(harness.deps.db, thread.id);
}

afterEach(() => vi.useRealTimers());

describe("unread after an agent-initiated turn", () => {
  it("marks one background run after a prompt unread 3 times, not 17", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const harness = await createTestAppHarness();
    const { host, session } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "acp-example",
      status: "idle",
    });
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      inputText: "hello",
      providerThreadId: "provider-thread",
      threadId: thread.id,
    });
    const quiet = new Set([
      2,
      3,
      ...Array.from({ length: 12 }, (_, i) => i + 5),
    ]);
    const attention: number[] = [];
    for (let turn = 1; turn <= 17; turn += 1) {
      vi.setSystemTime(1_000_000 + turn * 10_000);
      const turnId = `turn-${turn}`;
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: thread.id,
              event: {
                type: "turn/started",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope(turnId),
              },
            },
            {
              threadId: thread.id,
              event: {
                type: "turn/completed",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope(turnId),
                status: "completed",
                ...(quiet.has(turn) ? { silent: true as const } : {}),
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(getThread(harness.deps.db, thread.id)?.status).toBe("idle"),
      );
      attention.push(getThread(harness.deps.db, thread.id)!.latestAttentionAt);
    }
    expect(new Set(attention).size).toBe(3);
    expect(attention[0]).toBe(1_010_000);
    expect(attention[3]).toBe(1_040_000);
    expect(attention[16]).toBe(1_170_000);
  });

  it("leaves read state alone when the turn left nothing to read", async () => {
    const thread = await completeTurn({ status: "completed", silent: true });
    expect(thread?.status).toBe("idle");
    expect(thread?.latestAttentionAt).toBe(1);
  });

  it("still marks the thread unread for an ordinary completed turn", async () => {
    const thread = await completeTurn({ status: "completed" });
    expect(thread?.status).toBe("idle");
    expect(thread?.latestAttentionAt).toBeGreaterThan(1);
  });

  it("still marks the thread unread for a failure, silent or not", async () => {
    const thread = await completeTurn({ status: "failed", silent: true });
    expect(thread?.status).toBe("error");
    expect(thread?.latestAttentionAt).toBeGreaterThan(1);
  });
});
