import { claimFirstFinishedTurn } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import {
  reportedProviderId,
  turnErrorCategory,
} from "../../src/services/system/turn-telemetry.js";
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

async function setup(providerId = "codex") {
  const harness = await createTestAppHarness();
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = { ...harness.deps.telemetry, capture };
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
    status: "active",
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
  return { capture, harness, session, thread, turnFinished };
}

describe("turn_finished telemetry", () => {
  it("reports a completed root turn once, as the install's first turn", async () => {
    const { harness, session, thread, turnFinished } = await setup();
    try {
      const turn: HostDaemonEventEnvelope[] = [
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
      ];
      expect((await postEventBatch(harness, session.id, turn)).status).toBe(
        200,
      );
      expect(turnFinished()).toEqual([
        {
          name: "turn_finished",
          properties: {
            outcome: "completed",
            provider: "codex",
            error_category: "none",
            first_turn: true,
          },
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("reports a provider process exit as a failed turn and hides custom provider ids", async () => {
    const { harness, session, thread, turnFinished } =
      await setup("my-company-agent");
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
      expect(turnFinished()).toEqual([
        {
          name: "turn_finished",
          properties: {
            outcome: "failed",
            provider: "other",
            error_category: "process_exited",
            first_turn: true,
          },
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("claims the first turn once, and never for an install that already had several threads", async () => {
    const fresh = await createTestAppHarness();
    const upgraded = await createTestAppHarness();
    try {
      const { project } = seedProjectWithSource(fresh.deps, {
        hostId: seedHostSession(fresh.deps).host.id,
      });
      seedThread(fresh.deps, { projectId: project.id });
      expect(claimFirstFinishedTurn(fresh.db, 1)).toBe(true);
      expect(claimFirstFinishedTurn(fresh.db, 2)).toBe(false);

      const { project: upgradedProject } = seedProjectWithSource(
        upgraded.deps,
        { hostId: seedHostSession(upgraded.deps).host.id },
      );
      seedThread(upgraded.deps, { projectId: upgradedProject.id });
      seedThread(upgraded.deps, { projectId: upgradedProject.id });
      expect(claimFirstFinishedTurn(upgraded.db, 1)).toBe(false);
    } finally {
      await fresh.cleanup();
      await upgraded.cleanup();
    }
  });

  it("maps provider failures to coarse categories and keeps only built-in provider ids", () => {
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
