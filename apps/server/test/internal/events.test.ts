import {
  createThreadHandoff,
  getThread,
  getThreadHandoffByReplacementThreadId,
} from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedHandoff(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const source = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  const replacement = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "starting",
  });
  createThreadHandoff(harness.db, {
    archiveSource: true,
    environmentId: environment.id,
    idempotencyKey: `events-${replacement.id}`,
    model: "gpt-5.6-codex",
    permissionMode: "accept-edits",
    projectId: project.id,
    providerId: "codex",
    reasoningLevel: "high",
    replacementThreadId: replacement.id,
    serviceTier: null,
    sourceThreadId: source.id,
  });
  return { environment, replacement, session, source };
}

async function postTurnStarted(args: {
  harness: TestAppHarness;
  parentToolCallId?: string;
  sessionId: string;
  threadId: string;
  turnId: string;
}) {
  return args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      eventGroups: groupHostDaemonEvents([
        createTestDaemonEventEnvelope({
          event: {
            type: "turn/started",
            threadId: args.threadId,
            providerThreadId: "provider-replacement",
            scope: turnScope(args.turnId),
            ...(args.parentToolCallId
              ? { parentToolCallId: args.parentToolCallId }
              : {}),
          },
        }),
      ]),
    }),
  });
}

describe("thread handoff event settlement", () => {
  it("settles only after an accepted non-stale root turn/started", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);

      const response = await postTurnStarted({
        harness,
        sessionId: fixture.session.id,
        threadId: fixture.replacement.id,
        turnId: "root-turn",
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({ status: "started" });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
    });
  });

  it("does not settle for an accepted nested turn/started", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);

      const response = await postTurnStarted({
        harness,
        parentToolCallId: "delegated-call",
        sessionId: fixture.session.id,
        threadId: fixture.replacement.id,
        turnId: "nested-turn",
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toBeNull();
    });
  });

  it("does not settle for a stale root turn/started after interruption", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);
      seedThreadRuntimeState(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: "provider-replacement",
        sequenceStart: 1,
        threadId: fixture.replacement.id,
      });
      seedEvent(harness.deps, {
        data: { reason: "manual-stop" },
        environmentId: fixture.environment.id,
        scope: threadScope(),
        sequence: 3,
        threadId: fixture.replacement.id,
        type: "system/thread/interrupted",
      });

      const response = await postTurnStarted({
        harness,
        sessionId: fixture.session.id,
        threadId: fixture.replacement.id,
        turnId: "stale-root-turn",
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toBeNull();
    });
  });

  it("does not settle a root turn/started rejected for the wrong host", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);
      const { session: wrongSession } = seedHostSession(harness.deps, {
        id: "wrong-host",
      });
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness, { hostId: wrongSession.hostId }),
        body: JSON.stringify({
          sessionId: wrongSession.id,
          eventGroups: groupHostDaemonEvents([
            createTestDaemonEventEnvelope({
              event: {
                type: "turn/started",
                threadId: fixture.replacement.id,
                providerThreadId: "provider-replacement",
                scope: turnScope("rejected-root-turn"),
              },
            }),
          ]),
        }),
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toBeNull();
    });
  });

  it("settles a terminal provider exit as failed without archiving the source", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: fixture.session.id,
          eventGroups: groupHostDaemonEvents([
            createTestDaemonEventEnvelope({
              event: {
                type: "system/error",
                threadId: fixture.replacement.id,
                scope: threadScope(),
                code: "provider_process_exited",
                message: "Provider exited before startup completed",
              },
            }),
          ]),
        }),
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({
        status: "failed",
        failureCode: "provider_process_exited",
        failureMessage: "Provider exited before startup completed",
      });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toBeNull();
    });
  });

  it("lets a persisted qualifying root start outrank a later provider exit", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHandoff(harness);
      seedEvent(harness.deps, {
        data: { providerThreadId: "provider-replacement" },
        environmentId: fixture.environment.id,
        providerThreadId: "provider-replacement",
        scope: turnScope("persisted-root-turn"),
        sequence: 1,
        threadId: fixture.replacement.id,
        type: "turn/started",
      });

      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: fixture.session.id,
          eventGroups: groupHostDaemonEvents([
            createTestDaemonEventEnvelope({
              event: {
                type: "system/error",
                threadId: fixture.replacement.id,
                scope: threadScope(),
                code: "provider_process_exited",
                message: "Exit raced recovery",
              },
            }),
          ]),
        }),
      });

      expect(response.status).toBe(200);
      expect(
        getThreadHandoffByReplacementThreadId(
          harness.db,
          fixture.replacement.id,
        ),
      ).toMatchObject({ status: "started", failureCode: null });
      expect(getThread(harness.db, fixture.source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
    });
  });
});
