import { reportedProviderId } from "../../src/services/system/provider-telemetry.js";
import { appSettingsValues, getThread } from "@bb/db";
import { eq } from "drizzle-orm";
import { threadScope, turnScope, type ThreadStatus } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import {
  setTurnTelemetryDeps,
  turnErrorCategory,
  turnFinishedOutcome,
} from "../../src/services/system/turn-telemetry.js";
import {
  applyLoggedThreadLifecycleEvent,
  applyLoggedThreadLifecycleEventInTransaction,
} from "../../src/services/threads/lifecycle-outcome.js";
import { interruptActiveThreadsForHost } from "../../src/services/threads/thread-lifecycle.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

afterEach(() => {
  setTurnTelemetryDeps(undefined);
});

async function postEventBatch(
  harness: TestAppHarness,
  sessionId: string,
  events: HostDaemonEventEnvelope[],
): Promise<Response> {
  return harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(events),
    }),
  });
}

async function setup(
  options: { providerId?: string; status?: ThreadStatus } = {},
) {
  const harness = await createTestAppHarness();
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = {
    ...harness.deps.telemetry,
    capture,
    isEnabled: () => true,
  };
  setTurnTelemetryDeps({
    ...harness.deps,
    get telemetry() {
      return harness.deps.telemetry;
    },
  });
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: options.providerId ?? "codex",
    status: options.status ?? "active",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "hello",
    providerThreadId: "provider-thread",
    threadId: thread.id,
  });
  const turnFinished = () =>
    capture.mock.calls
      .map(([event]) => event)
      .filter((event) => event.name === "turn_finished");
  return { harness, host, session, thread, turnFinished };
}

describe("turn_finished telemetry", () => {
  it("reports a completed root turn once, as the install's first turn", async () => {
    const { harness, session, thread, turnFinished } = await setup();
    try {
      const response = await postEventBatch(harness, session.id, [
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
            status: "completed",
          },
        },
      ]);
      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(turnFinished()).toMatchObject([
          {
            name: "turn_finished",
            properties: {
              outcome: "succeeded",
              provider: "codex",
              error_category: "none",
              install_turn_number: 1,
            },
          },
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("reports a provider process exit as a failed turn and hides custom provider ids", async () => {
    const { harness, session, thread, turnFinished } = await setup({
      providerId: "my-company-agent",
    });
    try {
      const response = await postEventBatch(harness, session.id, [
        {
          threadId: thread.id,
          event: {
            type: "system/error",
            threadId: thread.id,
            scope: threadScope(),
            code: "provider_process_exited",
            message: "Provider process exited",
          },
        },
      ]);
      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(turnFinished()).toMatchObject([
          {
            name: "turn_finished",
            properties: {
              outcome: "failed",
              provider: "other",
              error_category: "process_exited",
              install_turn_number: 1,
            },
          },
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    { reason: "host-daemon-restarted" as const, cause: undefined },
    {
      reason: "host-daemon-restarted" as const,
      cause: "host-connection-lost" as const,
    },
  ])(
    "reports a host interruption ($reason, $cause) as host_lost",
    async ({ reason, cause }) => {
      const { harness, host, turnFinished } = await setup();
      try {
        interruptActiveThreadsForHost(harness.deps, {
          hostId: host.id,
          includeStopping: false,
          reason,
          ...(cause ? { cause } : {}),
        });
        await vi.waitFor(() =>
          expect(turnFinished()).toMatchObject([
            {
              properties: { outcome: "failed", error_category: "host_lost" },
            },
          ]),
        );
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("keeps a command failure after an earlier host interruption as start_failed", async () => {
    const { harness, host, session, thread, turnFinished } = await setup();
    try {
      interruptActiveThreadsForHost(harness.deps, {
        hostId: host.id,
        includeStopping: false,
        reason: "host-daemon-restarted",
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.preparing" },
        threadId: thread.id,
      });
      const response = await postEventBatch(harness, session.id, [
        {
          threadId: thread.id,
          event: {
            type: "system/error",
            threadId: thread.id,
            scope: threadScope(),
            code: "thread_command_failed",
            message: "Command thread.start failed",
          },
        },
      ]);
      expect(response.status).toBe(200);
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.failed" },
        threadId: thread.id,
      });
      await vi.waitFor(() =>
        expect(
          turnFinished().map((event) =>
            event.name === "turn_finished"
              ? event.properties.error_category
              : null,
          ),
        ).toEqual(["host_lost", "start_failed"]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    {
      name: "a failure from any path",
      status: "active" as const,
      events: [{ type: "run.failed" as const }],
      outcomes: ["failed"],
    },
    {
      name: "a settled stop",
      status: "active" as const,
      events: [
        { type: "stop.requested" as const },
        { type: "stop.settled" as const },
      ],
      outcomes: ["stopped"],
    },
    {
      name: "a fork seed settling without a turn",
      status: "starting" as const,
      events: [{ type: "run.succeeded" as const }],
      outcomes: [],
    },
  ])(
    "reports $name from the lifecycle owner",
    async ({ status, events, outcomes }) => {
      const { harness, thread, turnFinished } = await setup({ status });
      try {
        for (const event of events) {
          applyLoggedThreadLifecycleEvent(harness.deps, {
            event,
            threadId: thread.id,
          });
        }
        await new Promise((resolve) => setImmediate(resolve));
        expect(
          turnFinished().map((event) =>
            event.name === "turn_finished" ? event.properties.outcome : null,
          ),
        ).toEqual(outcomes);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("numbers concurrent finishes without gaps and pauses while telemetry is off", async () => {
    const { harness, thread, turnFinished } = await setup();
    try {
      const second = seedThread(harness.deps, {
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        status: "active",
      });
      const finish = (threadId: string) =>
        applyLoggedThreadLifecycleEvent(harness.deps, {
          threadId,
          event: { type: "run.succeeded" },
        });
      await Promise.all([
        Promise.resolve().then(() => finish(thread.id)),
        Promise.resolve().then(() => finish(second.id)),
      ]);
      expect(
        turnFinished().map((event) => event.properties.install_turn_number),
      ).toEqual([1, 2]);
      harness.deps.telemetry.isEnabled = () => false;
      const optedOut = seedThread(harness.deps, {
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        status: "active",
      });
      finish(optedOut.id);
      expect(turnFinished()).toHaveLength(2);
      harness.deps.telemetry.isEnabled = () => true;
      const resumed = seedThread(harness.deps, {
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        status: "active",
      });
      finish(resumed.id);
      expect(
        turnFinished().map((event) => event.properties.install_turn_number),
      ).toEqual([1, 2, 3]);
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    ["unauthorized", "auth"],
    ["billing", "billing"],
    ["budget-exceeded", "billing"],
    ["rate-limit", "rate_limit"],
    ["overloaded", "provider_unavailable"],
    ["connection-failed", "provider_unavailable"],
    ["stream-disconnected", "provider_unavailable"],
    ["context-window-exceeded", "limit_reached"],
    ["max-output-tokens", "limit_reached"],
    ["max-turns", "limit_reached"],
    ["policy", "other"],
    [null, "other"],
  ] as const)("maps %s to %s", (category, expected) => {
    expect(turnErrorCategory(category)).toBe(expected);
  });

  it("does not count duplicate notifications or rolled-back finishes", async () => {
    const { harness, thread, turnFinished } = await setup();
    try {
      expect(() =>
        harness.db.transaction((db) => {
          applyLoggedThreadLifecycleEventInTransaction(
            { ...harness.deps, db },
            {
              threadId: thread.id,
              event: { type: "run.succeeded" },
            },
          );
          expect(turnFinished()).toEqual([]);
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(turnFinished()).toEqual([]);
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      for (let i = 0; i < 2; i++) {
        applyLoggedThreadLifecycleEvent(harness.deps, {
          threadId: thread.id,
          event: { type: "run.succeeded" },
        });
      }
      expect(turnFinished()).toEqual([
        {
          name: "turn_finished",
          properties: {
            outcome: "succeeded",
            error_category: "none",
            provider: "codex",
            install_turn_number: 1,
          },
        },
      ]);
      expect(
        harness.db
          .select()
          .from(appSettingsValues)
          .where(eq(appSettingsValues.key, "installTurnNumber"))
          .get()?.value,
      ).toBe("1");
    } finally {
      await harness.cleanup();
    }
  });

  it("maps outcomes, provider failures, and provider ids to coarse values", () => {
    expect(turnFinishedOutcome({ type: "run.succeeded" }, "active")).toBe(
      "succeeded",
    );
    expect(turnFinishedOutcome({ type: "run.succeeded" }, "starting")).toBe(
      null,
    );
    expect(turnFinishedOutcome({ type: "run.failed" }, "starting")).toBe(
      "failed",
    );
    expect(turnErrorCategory("unauthorized")).toBe("auth");
    expect(turnErrorCategory("budget-exceeded")).toBe("billing");
    expect(turnErrorCategory("rate-limit")).toBe("rate_limit");
    expect(turnErrorCategory("stream-disconnected")).toBe(
      "provider_unavailable",
    );
    expect(turnErrorCategory("max-turns")).toBe("limit_reached");
    expect(turnErrorCategory("policy")).toBe("other");
    expect(turnErrorCategory(null)).toBe("other");
    expect(reportedProviderId("claude-code")).toBe("claude-code");
    expect(reportedProviderId("acp-hermes-agent")).toBe("acp-hermes-agent");
    expect(reportedProviderId("acp-my-private-agent")).toBe("other");
  });
});
