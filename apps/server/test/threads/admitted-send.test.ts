import { eq } from "drizzle-orm";
import {
  createPendingInteraction,
  getThread,
  getThreadExecutionOverride,
  listEvents,
  listQueuedThreadMessages,
  setThreadExecutionOverride,
  threadCommandAdmissions,
  threads,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  turnRequestEventDataSchema,
  type ActorStamp,
  type Environment,
  type Principal,
  type Thread,
} from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { admitQueueIfActiveSendMessage } from "../../src/services/threads/admitted-send.js";
import { fingerprintMessageSendRequest } from "../../src/services/threads/message-send-fingerprint.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  startTestServer,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const ALICE: ActorStamp = {
  principalId: "human:alice",
  principalKind: "human",
  displayName: "Alice",
};

const BOB: ActorStamp = {
  principalId: "human:bob",
  principalKind: "human",
  displayName: "Bob",
};

const principals = {
  alice: {
    id: "user_alice",
    kind: "human",
    displayName: "Alice",
  },
  bob: {
    id: "user_bob",
    kind: "human",
    displayName: "Bob",
  },
} as const satisfies Record<string, Principal>;

function testPrincipalPolicy(): PrincipalPolicy {
  return {
    async resolve(request) {
      const selected = request.getHeader("x-test-user");
      const principal = selected === "bob" ? principals.bob : principals.alice;
      return {
        principal,
        expiresAtMs: Date.now() + 60_000,
        clientRealtimeScope: "scoped",
        async authorize() {
          return { allowed: true };
        },
      };
    },
  };
}

interface IdleThreadFixture {
  environment: Environment;
  thread: Thread;
}

function seedColdIdleThread(
  harness: TestAppHarness,
  value: number,
): IdleThreadFixture {
  const { host } = seedHostSession(harness.deps, {
    id: `host-admitted-send-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/admitted-send-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/admitted-send-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return { environment, thread };
}

function seedActiveThread(
  harness: TestAppHarness,
  value: number,
): IdleThreadFixture {
  const fixture = seedColdIdleThread(harness, value);
  harness.db
    .update(threads)
    .set({ status: "active" })
    .where(eq(threads.id, fixture.thread.id))
    .run();
  return {
    ...fixture,
    thread: getThread(harness.db, fixture.thread.id)!,
  };
}

function queueIfActivePayload(text: string, model = "gpt-5") {
  return {
    input: textInput(text),
    mode: "queue-if-active" as const,
    model,
    permissionMode: "full" as const,
    reasoningLevel: "medium" as const,
    serviceTier: "default" as const,
  };
}

function listAdmissions(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select()
    .from(threadCommandAdmissions)
    .where(eq(threadCommandAdmissions.threadId, threadId))
    .all()
    .sort((left, right) => left.admissionSequence - right.admissionSequence);
}

function installTelemetryCaptureSpy(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = { capture };
  return capture;
}

function forceThreadStatus(
  harness: TestAppHarness,
  threadId: string,
  status: "idle" | "active",
): void {
  harness.db
    .update(threads)
    .set({ status })
    .where(eq(threads.id, threadId))
    .run();
}

describe("admitQueueIfActiveSendMessage", () => {
  it("atomically starts an idle thread with ledger, event, run.started, and one host command", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const { environment, thread } = seedColdIdleThread(harness, 1);
      const requestId = encodeClientTurnRequestIdNumber({ value: 101 });
      const payload = queueIfActivePayload("idle start");
      const fingerprint = fingerprintMessageSendRequest(payload);

      const result = await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload,
        requestId,
        thread,
      });

      expect(result.kind).toBe("accepted");
      expect(result.admission).toMatchObject({
        admissionSequence: 1,
        actor: ALICE,
        commandKind: "message.send",
        requestFingerprint: fingerprint,
        requestId,
        result: { disposition: "started", eventSequence: 1 },
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);

      const eventRows = listEvents(harness.db, { threadId: thread.id });
      expect(eventRows).toHaveLength(1);
      expect(eventRows[0]).toMatchObject({
        actorDisplayName: ALICE.displayName,
        actorKind: ALICE.principalKind,
        actorPrincipalId: ALICE.principalId,
        type: "client/turn/requested",
      });
      const eventData = turnRequestEventDataSchema.parse(
        JSON.parse(eventRows[0]!.data),
      );
      expect(eventData.requestId).toBe(requestId);
      expect(eventData.admissionSequence).toBe(1);
      expect(eventData.requestFingerprint).toBe(fingerprint);

      const startedCommand = await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "thread.start" ||
            candidate.command.type === "turn.submit") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === thread.id &&
          "requestId" in candidate.command &&
          candidate.command.requestId === requestId,
      );
      expect(startedCommand.command).toMatchObject({ requestId });
      expect(capture).toHaveBeenCalledOnce();
      expect(capture.mock.calls[0]![0]).toMatchObject({
        name: "user_message_sent",
        properties: { message_source: "thread_send" },
      });
    });
  });

  it("atomically queues against an active thread with ledger row and no host command", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const { environment, thread } = seedActiveThread(harness, 2);
      const requestId = encodeClientTurnRequestIdNumber({ value: 202 });
      const payload = queueIfActivePayload("active queue");
      const fingerprint = fingerprintMessageSendRequest(payload);

      const result = await admitQueueIfActiveSendMessage(harness.deps, {
        actor: BOB,
        environment,
        payload,
        requestId,
        thread,
      });

      expect(result.kind).toBe("accepted");
      expect(result.admission).toMatchObject({
        admissionSequence: 1,
        actor: BOB,
        requestId,
        requestFingerprint: fingerprint,
        result: {
          disposition: "queued",
          queuedMessageId: expect.stringMatching(/^qmsg_/u),
        },
      });
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);

      const queued = listQueuedThreadMessages(harness.db, thread.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        actorDisplayName: BOB.displayName,
        actorKind: BOB.principalKind,
        actorPrincipalId: BOB.principalId,
        admissionSequence: 1,
        requestFingerprint: fingerprint,
        requestId,
      });
      expect(capture).toHaveBeenCalledOnce();
      expect(capture.mock.calls[0]![0]).toMatchObject({
        name: "user_message_sent",
        properties: { message_source: "queued_message" },
      });
    });
  });

  it("serializes two concurrent idle admits into one started and one queued", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedColdIdleThread(harness, 3);
      const requestIdAlice = encodeClientTurnRequestIdNumber({ value: 301 });
      const requestIdBob = encodeClientTurnRequestIdNumber({ value: 302 });
      const payloadAlice = queueIfActivePayload("alice concurrent");
      const payloadBob = queueIfActivePayload("bob concurrent");

      const [aliceResult, bobResult] = await Promise.all([
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: payloadAlice,
          requestId: requestIdAlice,
          thread,
        }),
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: BOB,
          environment,
          payload: payloadBob,
          requestId: requestIdBob,
          thread,
        }),
      ]);

      const admissions = listAdmissions(harness, thread.id);
      expect(admissions.map((row) => row.admissionSequence)).toEqual([1, 2]);
      expect(admissions.map((row) => row.resultDisposition).sort()).toEqual([
        "queued",
        "started",
      ]);

      const started = [aliceResult, bobResult].find(
        (result) => result.admission.result.disposition === "started",
      );
      const queued = [aliceResult, bobResult].find(
        (result) => result.admission.result.disposition === "queued",
      );
      expect(started).toBeDefined();
      expect(queued).toBeDefined();
      expect(started!.admission.actor).toEqual(
        started!.admission.requestId === requestIdAlice ? ALICE : BOB,
      );
      expect(queued!.admission.actor).toEqual(
        queued!.admission.requestId === requestIdAlice ? ALICE : BOB,
      );

      await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "thread.start" ||
            candidate.command.type === "turn.submit") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === thread.id &&
          "requestId" in candidate.command &&
          candidate.command.requestId === started!.admission.requestId,
      );
      const commands = [
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ];
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        requestId: started!.admission.requestId,
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(1);
    });
  });

  it("replays identical admissions without duplicate side effects", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const notifySpy = vi.spyOn(harness.hub, "notifyThread");
      const { environment, thread } = seedColdIdleThread(harness, 4);
      const requestId = encodeClientTurnRequestIdNumber({ value: 404 });
      const payload = queueIfActivePayload("replay me");
      const args = {
        actor: ALICE,
        environment,
        payload,
        requestId,
        thread,
      };

      const first = await admitQueueIfActiveSendMessage(harness.deps, args);
      expect(first.kind).toBe("accepted");
      await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "thread.start" ||
            candidate.command.type === "turn.submit") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === thread.id,
      );
      const commandsAfterFirst = [
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ];
      expect(commandsAfterFirst).toHaveLength(1);
      const notifyCountAfterFirst = notifySpy.mock.calls.length;
      const captureCountAfterFirst = capture.mock.calls.length;

      forceThreadStatus(harness, thread.id, "active");

      const second = await admitQueueIfActiveSendMessage(harness.deps, {
        ...args,
        afterBranchPrepared: () => {
          throw new Error("Replay must not prepare an admission branch");
        },
      });
      expect(second).toEqual({
        kind: "replayed",
        admission: first.admission,
      });
      expect(listAdmissions(harness, thread.id)).toHaveLength(1);
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      expect([
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ]).toHaveLength(1);
      expect(notifySpy.mock.calls.length).toBe(notifyCountAfterFirst);
      expect(capture.mock.calls.length).toBe(captureCountAfterFirst);
    });
  });

  it("conflicts when fingerprint or actor changes for the same request id", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedColdIdleThread(harness, 5);
      const requestId = encodeClientTurnRequestIdNumber({ value: 505 });
      const payload = queueIfActivePayload("identity");

      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload,
        requestId,
        thread,
      });
      await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "thread.start" ||
            candidate.command.type === "turn.submit") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === thread.id,
      );
      const admissionsBefore = listAdmissions(harness, thread.id);
      const eventsBefore = listEvents(harness.db, { threadId: thread.id });
      const queuedBefore = listQueuedThreadMessages(harness.db, thread.id);
      const commandsBefore = [
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ];
      expect(commandsBefore).toHaveLength(1);

      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: queueIfActivePayload("identity changed"),
          requestId,
          thread: getThread(harness.db, thread.id)!,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "thread_command_admission_conflict" },
      });

      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: BOB,
          environment,
          payload,
          requestId,
          thread: getThread(harness.db, thread.id)!,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "thread_command_admission_conflict" },
      });

      expect(listAdmissions(harness, thread.id)).toEqual(admissionsBefore);
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual(
        eventsBefore,
      );
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual(
        queuedBefore,
      );
      expect([
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ]).toEqual(commandsBefore);
    });
  });

  it("retries into the opposite branch after a forced status flip without a sequence gap", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedColdIdleThread(harness, 6);
      const requestId = encodeClientTurnRequestIdNumber({ value: 606 });
      let flips = 0;

      const result = await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload: queueIfActivePayload("flip then queue"),
        requestId,
        thread,
        afterBranchPrepared: (branch) => {
          if (flips > 0) {
            return;
          }
          flips += 1;
          expect(branch).toBe("start");
          forceThreadStatus(harness, thread.id, "active");
        },
      });

      expect(flips).toBe(1);
      expect(result.kind).toBe("accepted");
      expect(result.admission).toMatchObject({
        admissionSequence: 1,
        result: { disposition: "queued" },
      });
      expect(listAdmissions(harness, thread.id)).toHaveLength(1);
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(0);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect([
        ...listQueuedThreadCommands(harness, "thread.start", thread.id),
        ...listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ]).toHaveLength(0);
    });
  });

  it("leaves no partial state for pending interaction, prep failure, or retry exhaustion", async () => {
    await withTestHarness(async (harness) => {
      const pendingFixture = seedActiveThread(harness, 7);
      createPendingInteraction(harness.db, {
        threadId: pendingFixture.thread.id,
        turnId: "turn-pending-block",
        providerId: "codex",
        providerThreadId: "provider-pending-block",
        providerRequestId: "request-pending-block",
        payload: JSON.stringify(
          createCommandApprovalPayload({
            itemId: "item-pending-block",
          }),
        ),
      });

      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment: pendingFixture.environment,
          payload: queueIfActivePayload("blocked"),
          requestId: encodeClientTurnRequestIdNumber({ value: 701 }),
          thread: pendingFixture.thread,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "awaiting_user_interaction" },
      });
      expect(listAdmissions(harness, pendingFixture.thread.id)).toHaveLength(0);
      expect(
        listQueuedThreadMessages(harness.db, pendingFixture.thread.id),
      ).toHaveLength(0);

      const { host } = seedHostSession(harness.deps, {
        id: "host-admitted-send-prep-fail",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/admitted-send-prep-fail",
      });
      const brokenEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: null,
        status: "error",
      });
      const brokenThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: brokenEnvironment.id,
        status: "idle",
      });
      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment: brokenEnvironment,
          payload: queueIfActivePayload("prep fails"),
          requestId: encodeClientTurnRequestIdNumber({ value: 702 }),
          thread: brokenThread,
        }),
      ).rejects.toMatchObject({
        status: expect.any(Number),
      });
      expect(listAdmissions(harness, brokenThread.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: brokenThread.id }),
      ).toHaveLength(0);

      const oscillating = seedColdIdleThread(harness, 8);
      setThreadExecutionOverride(harness.db, {
        threadId: oscillating.thread.id,
        modelOverride: "gpt-5",
      });
      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment: oscillating.environment,
          payload: queueIfActivePayload("oscillate", "gpt-5"),
          requestId: encodeClientTurnRequestIdNumber({ value: 703 }),
          thread: oscillating.thread,
          afterBranchPrepared: (branch) => {
            forceThreadStatus(
              harness,
              oscillating.thread.id,
              branch === "start" ? "active" : "idle",
            );
          },
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "thread_command_admission_conflict" },
      });
      expect(listAdmissions(harness, oscillating.thread.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: oscillating.thread.id }),
      ).toHaveLength(0);
      expect(
        listQueuedThreadMessages(harness.db, oscillating.thread.id),
      ).toHaveLength(0);
      expect(
        getThreadExecutionOverride(harness.db, oscillating.thread.id),
      ).toEqual({
        modelOverride: "gpt-5",
        reasoningLevelOverride: null,
      });
    });
  });

  it("rolls back callback mutations when terminal ledger persistence fails", async () => {
    await withTestHarness(async (harness) => {
      const idle = seedColdIdleThread(harness, 11);
      const active = seedActiveThread(harness, 12);
      harness.db.$client.exec(`
        CREATE TRIGGER fail_admitted_send_ledger_insert
        BEFORE INSERT ON thread_command_admissions
        BEGIN
          SELECT RAISE(ABORT, 'forced admitted-send ledger failure');
        END;
      `);

      try {
        await expect(
          admitQueueIfActiveSendMessage(harness.deps, {
            actor: ALICE,
            environment: idle.environment,
            payload: queueIfActivePayload("rollback started branch"),
            requestId: encodeClientTurnRequestIdNumber({ value: 711 }),
            thread: idle.thread,
          }),
        ).rejects.toThrow(/forced admitted-send ledger failure/u);
        expect(listAdmissions(harness, idle.thread.id)).toHaveLength(0);
        expect(
          listEvents(harness.db, { threadId: idle.thread.id }),
        ).toHaveLength(0);
        expect(
          listQueuedThreadMessages(harness.db, idle.thread.id),
        ).toHaveLength(0);
        expect(getThread(harness.db, idle.thread.id)?.status).toBe("idle");
        expect([
          ...listQueuedThreadCommands(harness, "thread.start", idle.thread.id),
          ...listQueuedThreadCommands(harness, "turn.submit", idle.thread.id),
        ]).toHaveLength(0);

        await expect(
          admitQueueIfActiveSendMessage(harness.deps, {
            actor: BOB,
            environment: active.environment,
            payload: queueIfActivePayload("rollback queued branch"),
            requestId: encodeClientTurnRequestIdNumber({ value: 712 }),
            thread: active.thread,
          }),
        ).rejects.toThrow(/forced admitted-send ledger failure/u);
        expect(listAdmissions(harness, active.thread.id)).toHaveLength(0);
        expect(
          listEvents(harness.db, { threadId: active.thread.id }),
        ).toHaveLength(0);
        expect(
          listQueuedThreadMessages(harness.db, active.thread.id),
        ).toHaveLength(0);
      } finally {
        harness.db.$client.exec(
          "DROP TRIGGER IF EXISTS fail_admitted_send_ledger_insert",
        );
      }
    });
  });

  it("does not persist sticky model override recovery before accepted start admission", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-admitted-override",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/admitted-override",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/admitted-override",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: "high",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [
                  availableModelFixture({
                    model: "claude-opus-4-8[1m]",
                    reasoningLevels: ["low", "medium", "high"],
                  }),
                ],
                selectedOnlyModels: [],
              },
            };
          }
          if (request.command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (request.command.type === "host.read_file") {
            return {
              ok: false,
              errorCode: "ENOENT",
              errorMessage: `Path does not exist: ${request.command.path}`,
            };
          }
          if (request.command.type === "host.list_branches") {
            return {
              ok: true,
              result: {
                branches: ["main"],
                branchesTruncated: false,
                checkout: {
                  kind: "branch",
                  branchName: "main",
                  headSha: "abc123",
                },
                defaultBranch: "main",
                defaultBranchRelation: "equal",
                hasUncommittedChanges: false,
                operation: { kind: "none" },
                originDefaultBranch: "origin/main",
                remoteBranches: ["origin/main"],
                remoteBranchesTruncated: false,
                selectedBranch: null,
              },
            };
          }
          throw new Error(
            `Unexpected provider RPC command ${request.command.type}`,
          );
        },
      });

      let flipped = false;
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload: {
          ...queueIfActivePayload("recover model", "claude-opus-4-8[1m]"),
          executionInputSources: { model: "explicit" },
        },
        requestId: encodeClientTurnRequestIdNumber({ value: 808 }),
        thread,
        afterBranchPrepared: (branch) => {
          if (flipped || branch !== "start") {
            return;
          }
          flipped = true;
          forceThreadStatus(harness, thread.id, "active");
        },
      });

      expect(flipped).toBe(true);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: "high",
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(0);

      const acceptedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: acceptedThread.id,
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: "max",
      });
      const acceptedRequestId = encodeClientTurnRequestIdNumber({ value: 809 });
      harness.db.$client.exec(`
        CREATE TRIGGER fail_model_recovery_admission_insert
        BEFORE INSERT ON thread_command_admissions
        BEGIN
          SELECT RAISE(ABORT, 'forced model-recovery admission failure');
        END;
      `);
      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            input: textInput("recover model on accepted start"),
            mode: "queue-if-active",
            model: "claude-opus-4-8[1m]",
            executionInputSources: { model: "explicit" },
            permissionMode: "full",
            serviceTier: "default",
          },
          requestId: acceptedRequestId,
          thread: acceptedThread,
        }),
      ).rejects.toThrow(/forced model-recovery admission failure/u);
      expect(getThreadExecutionOverride(harness.db, acceptedThread.id)).toEqual(
        {
          modelOverride: "claude-mythos-5",
          reasoningLevelOverride: "max",
        },
      );
      expect(listAdmissions(harness, acceptedThread.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: acceptedThread.id }),
      ).toHaveLength(0);
      expect(getThread(harness.db, acceptedThread.id)?.status).toBe("idle");
      harness.db.$client.exec(
        "DROP TRIGGER IF EXISTS fail_model_recovery_admission_insert",
      );

      const accepted = await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload: {
          input: textInput("recover model on accepted start"),
          mode: "queue-if-active",
          model: "claude-opus-4-8[1m]",
          executionInputSources: { model: "explicit" },
          permissionMode: "full",
          serviceTier: "default",
        },
        requestId: acceptedRequestId,
        thread: acceptedThread,
      });
      expect(accepted.admission.result.disposition).toBe("started");
      expect(accepted.admission.admissionSequence).toBe(1);
      expect(getThreadExecutionOverride(harness.db, acceptedThread.id)).toEqual(
        {
          modelOverride: "claude-opus-4-8[1m]",
          reasoningLevelOverride: "high",
        },
      );
      const acceptedEvent = listEvents(harness.db, {
        threadId: acceptedThread.id,
      }).find((event) => event.type === "client/turn/requested");
      expect(acceptedEvent).toBeDefined();
      expect(
        turnRequestEventDataSchema.parse(JSON.parse(acceptedEvent!.data))
          .execution,
      ).toMatchObject({
        model: "claude-opus-4-8[1m]",
        reasoningLevel: "high",
      });
    });
  });
});

describe("queue-if-active route admission wiring", () => {
  it("uses the admission service for queue-if-active while legacy modes stay compatible", async () => {
    await withTestHarness(async (harness) => {
      const { thread: activeThread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const activeResponse = await harness.app.request(
        `/api/v1/threads/${activeThread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "route queue" }],
            mode: "queue-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      expect(activeResponse.status).toBe(200);
      await expect(readJson(activeResponse)).resolves.toEqual({ ok: true });
      expect(listAdmissions(harness, activeThread.id)).toHaveLength(1);
      expect(
        listQueuedThreadMessages(harness.db, activeThread.id)[0],
      ).toMatchObject({
        admissionSequence: 1,
        requestId: expect.stringMatching(/^creq_/u),
      });

      const { environment, thread: idleThread } = seedColdIdleThread(
        harness,
        9,
      );
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-route-idle",
        threadId: idleThread.id,
      });
      const idleResponse = await harness.app.request(
        `/api/v1/threads/${idleThread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "route start" }],
            mode: "queue-if-active",
          }),
        },
      );
      expect(idleResponse.status).toBe(200);
      await expect(readJson(idleResponse)).resolves.toEqual({ ok: true });
      expect(listAdmissions(harness, idleThread.id)).toHaveLength(1);
      expect(listAdmissions(harness, idleThread.id)[0]?.resultDisposition).toBe(
        "started",
      );
      await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "turn.submit" ||
            candidate.command.type === "thread.start") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === idleThread.id,
      );

      const { environment: legacyEnvironment, thread: legacyThread } =
        seedColdIdleThread(harness, 10);
      const legacyStart = await harness.app.request(
        `/api/v1/threads/${legacyThread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "legacy start" }],
            mode: "start",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      if (legacyStart.status !== 200) {
        throw new Error(
          `legacy start failed: ${legacyStart.status} ${await legacyStart.text()} env=${legacyEnvironment.id}`,
        );
      }
      await expect(readJson(legacyStart)).resolves.toEqual({ ok: true });
      expect(listAdmissions(harness, legacyThread.id)).toHaveLength(0);

      const createQueued = await harness.app.request(
        `/api/v1/threads/${activeThread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "explicit queue" }],
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      expect(createQueued.status).toBe(201);
      const explicitRows = listQueuedThreadMessages(
        harness.db,
        activeThread.id,
      );
      const explicit = explicitRows.find(
        (row) => JSON.parse(row.content)[0]?.text === "explicit queue",
      );
      expect(explicit).toMatchObject({
        admissionSequence: null,
        requestFingerprint: null,
        requestId: null,
      });
    });
  });

  it("retains distinct human actors for concurrent route sends", async () => {
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: testPrincipalPolicy(),
      },
    );
    try {
      const { host } = seedHostSession(server.deps, {
        id: "host-admitted-route-concurrent",
      });
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/admitted-route-concurrent",
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/admitted-route-concurrent",
        status: "ready",
      });
      const thread = seedThread(server.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const [aliceResponse, bobResponse] = await Promise.all([
        server.app.request(`/api/v1/threads/${thread.id}/send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "alice",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "alice route" }],
            mode: "queue-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        }),
        server.app.request(`/api/v1/threads/${thread.id}/send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "bob",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "bob route" }],
            mode: "queue-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        }),
      ]);
      if (aliceResponse.status !== 200 || bobResponse.status !== 200) {
        throw new Error(
          `concurrent route failed alice=${aliceResponse.status} ${await aliceResponse.text()} bob=${bobResponse.status} ${await bobResponse.text()}`,
        );
      }

      const admissions = listAdmissions(server, thread.id);
      expect(admissions).toHaveLength(2);
      expect(admissions.map((row) => row.actorPrincipalId).sort()).toEqual([
        "user_alice",
        "user_bob",
      ]);
      expect(admissions.map((row) => row.resultDisposition).sort()).toEqual([
        "queued",
        "started",
      ]);
    } finally {
      await server.cleanup();
    }
  });
});
