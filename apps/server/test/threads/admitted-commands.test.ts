import { eq } from "drizzle-orm";
import {
  createPendingInteraction,
  deleteQueuedThreadMessage,
  getThread,
  getThreadCommandAdmission,
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
  type Thread,
} from "@bb/domain";
import {
  admitInterruptThreadRequestSchema,
  admitSendMessageRequestSchema,
  admitSteerMessageRequestSchema,
  publicApiRoutes,
  threadCommandAdmissionLookupResponseSchema,
  threadCommandAdmissionReceiptSchema,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { admitQueueIfActiveSendMessage } from "../../src/services/threads/admitted-send.js";
import { admitExactSteerMessage } from "../../src/services/threads/admitted-steer.js";
import { admitExactInterrupt } from "../../src/services/threads/admitted-interrupt.js";
import { fingerprintMessageSteerRequest } from "../../src/services/threads/message-send-fingerprint.js";
import {
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../../src/services/threads/thread-lifecycle.js";
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
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

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

interface ThreadFixture {
  environment: Environment;
  thread: Thread;
}

function seedColdIdleThread(
  harness: TestAppHarness,
  value: number,
): ThreadFixture {
  const { host } = seedHostSession(harness.deps, {
    id: `host-admitted-cmd-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/admitted-cmd-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/admitted-cmd-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return { environment, thread };
}

function seedActiveThreadWithTurn(
  harness: TestAppHarness,
  value: number,
  turnId: string,
): ThreadFixture {
  const fixture = seedColdIdleThread(harness, value);
  seedThreadRuntimeState(harness.deps, {
    environmentId: fixture.environment.id,
    providerThreadId: `provider-cmd-${value}`,
    threadId: fixture.thread.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: fixture.environment.id,
    providerThreadId: `provider-cmd-${value}`,
    threadId: fixture.thread.id,
    turnId,
  });
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

function installTelemetryCaptureSpy(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = { capture };
  return capture;
}

function listAdmissions(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select()
    .from(threadCommandAdmissions)
    .where(eq(threadCommandAdmissions.threadId, threadId))
    .all()
    .sort((left, right) => left.admissionSequence - right.admissionSequence);
}

describe("deterministic command API contracts", () => {
  it("exposes strict route paths and request/response schemas", () => {
    expect(publicApiRoutes.threads.admitSend.path).toBe(
      "/threads/:id/commands/send",
    );
    expect(publicApiRoutes.threads.admitSteer.path).toBe(
      "/threads/:id/commands/steer",
    );
    expect(publicApiRoutes.threads.admitInterrupt.path).toBe(
      "/threads/:id/commands/interrupt",
    );
    expect(publicApiRoutes.threads.commandAdmission.path).toBe(
      "/threads/:id/command-admissions/:requestId",
    );

    const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
    expect(
      admitSendMessageRequestSchema.parse({
        requestId,
        input: [{ type: "text", text: "hi", mentions: [] }],
      }),
    ).toMatchObject({ requestId });
    expect(
      admitSendMessageRequestSchema.safeParse({
        requestId,
        input: [{ type: "text", text: "hi", mentions: [] }],
        mode: "auto",
      }).success,
    ).toBe(false);
    expect(
      admitSteerMessageRequestSchema.parse({
        requestId,
        expectedTurnId: "turn_abc",
        input: [{ type: "text", text: "steer", mentions: [] }],
      }),
    ).toMatchObject({ expectedTurnId: "turn_abc" });
    expect(
      admitSteerMessageRequestSchema.safeParse({
        requestId,
        expectedTurnId: "",
        input: [{ type: "text", text: "steer", mentions: [] }],
      }).success,
    ).toBe(false);
    expect(
      admitInterruptThreadRequestSchema.parse({
        requestId,
        expectedTurnId: "turn_abc",
      }),
    ).toEqual({ requestId, expectedTurnId: "turn_abc" });
    expect(
      admitInterruptThreadRequestSchema.safeParse({
        requestId,
        expectedTurnId: "turn_abc",
        input: [{ type: "text", text: "nope", mentions: [] }],
      }).success,
    ).toBe(false);

    expect(
      threadCommandAdmissionReceiptSchema.parse({
        kind: "accepted",
        requestId,
        commandKind: "message.send",
        admissionSequence: 1,
        result: { disposition: "started", eventSequence: 1 },
        createdAt: 1,
        completedAt: 1,
      }).kind,
    ).toBe("accepted");
    expect(
      threadCommandAdmissionReceiptSchema.safeParse({
        kind: "accepted",
        requestId,
        commandKind: "message.send",
        admissionSequence: 1,
        result: { disposition: "started", eventSequence: 1 },
        createdAt: 1,
        completedAt: 1,
        requestFingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionReceiptSchema.safeParse({
        kind: "accepted",
        requestId,
        commandKind: "message.send",
        admissionSequence: 1,
        result: {
          disposition: "interrupted",
          eventSequence: 1,
          expectedTurnId: "turn_abc",
        },
        createdAt: 1,
        completedAt: 1,
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionLookupResponseSchema.parse({ found: false }),
    ).toEqual({ found: false });
  });
});

describe("deterministic send + lookup", () => {
  it("accepts/replays a supplied request ID and looks up the receipt", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedColdIdleThread(harness, 1);
      seedThreadRuntimeState(harness.deps, {
        environmentId: getThread(harness.db, thread.id)!.environmentId,
        providerThreadId: "provider-send-lookup",
        threadId: thread.id,
      });
      const requestId = encodeClientTurnRequestIdNumber({ value: 1001 });

      const accepted = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            input: [{ type: "text", text: "deterministic send" }],
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      expect(accepted.status).toBe(200);
      const acceptedBody = await readJson(accepted);
      expect(acceptedBody).toMatchObject({
        kind: "accepted",
        requestId,
        commandKind: "message.send",
        admissionSequence: 1,
        result: { disposition: "started", eventSequence: expect.any(Number) },
      });
      expect(acceptedBody).not.toHaveProperty("requestFingerprint");

      // Once admitted, the ledger remains authoritative even if the runtime
      // environment is later detached from the thread.
      harness.db
        .update(threads)
        .set({ environmentId: null })
        .where(eq(threads.id, thread.id))
        .run();

      const replayed = await harness.app.request(
        `/api/v1/threads/${thread.id}/commands/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId,
            input: [{ type: "text", text: "deterministic send" }],
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      expect(replayed.status).toBe(200);
      await expect(readJson(replayed)).resolves.toMatchObject({
        kind: "replayed",
        requestId,
        admissionSequence: 1,
      });
      expect(listAdmissions(harness, thread.id)).toHaveLength(1);

      const lookup = await harness.app.request(
        `/api/v1/threads/${thread.id}/command-admissions/${requestId}`,
      );
      expect(lookup.status).toBe(200);
      await expect(readJson(lookup)).resolves.toMatchObject({
        found: true,
        admission: {
          requestId,
          commandKind: "message.send",
          admissionSequence: 1,
        },
      });

      const missing = await harness.app.request(
        `/api/v1/threads/${thread.id}/command-admissions/${encodeClientTurnRequestIdNumber({ value: 9999 })}`,
      );
      expect(missing.status).toBe(200);
      await expect(readJson(missing)).resolves.toEqual({ found: false });

      const malformed = await harness.app.request(
        `/api/v1/threads/${thread.id}/command-admissions/not-a-request-id`,
      );
      expect(malformed.status).toBe(400);
      await expect(readJson(malformed)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });
});

describe("admitExactSteerMessage", () => {
  it("accepts exact steer with event/ledger/host request identity agreement", async () => {
    await withTestHarness(async (harness) => {
      const capture = installTelemetryCaptureSpy(harness);
      const turnId = "turn_exact_steer_1";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        2,
        turnId,
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 2001 });
      const payload = {
        requestId,
        expectedTurnId: turnId,
        input: textInput("exact steer"),
        model: "gpt-5",
        permissionMode: "full" as const,
        reasoningLevel: "medium" as const,
        serviceTier: "default" as const,
      };
      const fingerprint = fingerprintMessageSteerRequest(payload);

      const result = await admitExactSteerMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload,
        thread,
      });

      expect(result.kind).toBe("accepted");
      expect(result.admission).toMatchObject({
        admissionSequence: 1,
        actor: ALICE,
        commandKind: "message.steer",
        requestFingerprint: fingerprint,
        requestId,
        result: {
          disposition: "steered",
          expectedTurnId: turnId,
          eventSequence: expect.any(Number),
        },
      });

      const eventRows = listEvents(harness.db, { threadId: thread.id }).filter(
        (event) => event.type === "client/turn/requested",
      );
      const steerEvent = eventRows[eventRows.length - 1]!;
      expect(steerEvent).toMatchObject({
        actorDisplayName: ALICE.displayName,
        actorPrincipalId: ALICE.principalId,
      });
      const eventData = turnRequestEventDataSchema.parse(
        JSON.parse(steerEvent.data),
      );
      expect(eventData.requestId).toBe(requestId);
      expect(eventData.admissionSequence).toBe(1);
      expect(eventData.requestFingerprint).toBe(fingerprint);
      expect(eventData.target).toEqual({
        kind: "steer",
        expectedTurnId: turnId,
      });

      const command = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === thread.id &&
          candidate.command.requestId === requestId,
      );
      expect(command.command).toMatchObject({
        type: "turn.submit",
        requestId,
        target: { mode: "exact-steer", expectedTurnId: turnId },
      });
      expect(capture).toHaveBeenCalledOnce();

      if (command.command.type !== "turn.submit") {
        throw new Error("Expected exact-steer turn.submit command");
      }
      const exactSteerCommand = command.command;
      const eventCountBeforeStaleSettlement = listEvents(harness.db, {
        threadId: thread.id,
      }).length;
      harness.db.transaction((tx) => {
        const sideEffects = settleTurnSubmitCommandResult({
          command: exactSteerCommand,
          deps: {
            ...harness.deps,
            db: tx,
            hub: harness.hub,
          },
          execution: {
            createdAt: command.row.createdAt,
            hostId: command.row.hostId,
            id: command.row.id,
          },
          report: {
            completedAt: Date.now(),
            errorCode: "stale_turn",
            errorMessage: "Expected turn is no longer active",
            executionId: command.row.id,
            ok: false,
            type: "turn.submit",
          },
        });
        expect(sideEffects.postCommitActions).toHaveLength(0);
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(
        eventCountBeforeStaleSettlement,
      );
    });
  });

  it("replays, conflicts, rejects pending interaction and turn mismatch without effects", async () => {
    await withTestHarness(async (harness) => {
      const turnId = "turn_exact_steer_2";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        3,
        turnId,
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 2002 });
      const payload = {
        requestId,
        expectedTurnId: turnId,
        input: textInput("steer once"),
        model: "gpt-5",
        permissionMode: "full" as const,
        reasoningLevel: "medium" as const,
        serviceTier: "default" as const,
      };

      const first = await admitExactSteerMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload,
        thread,
      });
      expect(first.kind).toBe("accepted");
      const eventCountAfterAccept = listEvents(harness.db, {
        threadId: thread.id,
      }).length;

      const replay = await admitExactSteerMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload,
        thread,
      });
      expect(replay.kind).toBe("replayed");
      expect(replay.admission.admissionSequence).toBe(
        first.admission.admissionSequence,
      );
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(
        eventCountAfterAccept,
      );

      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: BOB,
          environment,
          payload,
          thread,
        }),
      ).rejects.toMatchObject({
        body: { code: "thread_command_admission_conflict" },
      });

      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            ...payload,
            requestId: encodeClientTurnRequestIdNumber({ value: 2003 }),
            expectedTurnId: "turn_other",
          },
          thread,
        }),
      ).rejects.toMatchObject({
        body: { code: "expected_turn_mismatch" },
      });
      expect(listAdmissions(harness, thread.id)).toHaveLength(1);

      createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId,
        providerId: "codex",
        providerThreadId: "provider-pending-steer",
        providerRequestId: "request-pending-steer",
        payload: JSON.stringify(
          createCommandApprovalPayload({
            itemId: "item-pending-steer",
          }),
        ),
      });
      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            ...payload,
            requestId: encodeClientTurnRequestIdNumber({ value: 2004 }),
            input: textInput("blocked by pending"),
          },
          thread,
        }),
      ).rejects.toMatchObject({
        body: { code: "awaiting_user_interaction" },
      });
    });
  });

  it("rejects when the turn flips during preparation with no accepted-only effects", async () => {
    await withTestHarness(async (harness) => {
      const turnId = "turn_exact_steer_3";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        4,
        turnId,
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 2005 });

      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            requestId,
            expectedTurnId: turnId,
            input: textInput("flip during prepare"),
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          afterPrepared: () => {
            // A newer active turn appears before admit commits.
            seedTurnStarted(harness.deps, {
              environmentId: environment.id,
              providerThreadId: "provider-cmd-4",
              threadId: thread.id,
              turnId: "turn_exact_steer_newer",
            });
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "expected_turn_mismatch" },
      });

      expect(listAdmissions(harness, thread.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) =>
            event.type === "client/turn/requested" &&
            JSON.parse(event.data).requestId === requestId,
        ),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
    });
  });

  it("rolls back sticky recovery and safely exhausts concurrent override changes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-steer-override",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/steer-override",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/steer-override",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-steer-override",
        threadId: thread.id,
      });
      const turnId = "turn_exact_steer_override";
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-steer-override",
        threadId: thread.id,
        turnId,
      });
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, thread.id))
        .run();
      const activeThread = getThread(harness.db, thread.id)!;
      setThreadExecutionOverride(harness.db, {
        threadId: activeThread.id,
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: "max",
      });
      const beforeOverride = getThreadExecutionOverride(
        harness.db,
        activeThread.id,
      );
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
      harness.db.$client.exec(`
        CREATE TRIGGER fail_steer_ledger_insert
        BEFORE INSERT ON thread_command_admissions
        BEGIN
          SELECT RAISE(ABORT, 'forced steer admission failure');
        END;
      `);

      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            requestId: encodeClientTurnRequestIdNumber({ value: 2006 }),
            expectedTurnId: turnId,
            input: textInput("override rollback"),
            model: "claude-opus-4-8[1m]",
            executionInputSources: { model: "explicit" },
            permissionMode: "full",
            reasoningLevel: "high",
            serviceTier: "default",
          },
          thread: activeThread,
        }),
      ).rejects.toThrow(/forced steer admission failure/i);

      expect(getThreadExecutionOverride(harness.db, activeThread.id)).toEqual(
        beforeOverride,
      );
      expect(listAdmissions(harness, activeThread.id)).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", activeThread.id),
      ).toHaveLength(0);

      harness.db.$client.exec("DROP TRIGGER fail_steer_ledger_insert");
      const staleRequestId = encodeClientTurnRequestIdNumber({ value: 2007 });
      let preparationCount = 0;
      await expect(
        admitExactSteerMessage(harness.deps, {
          actor: ALICE,
          environment,
          payload: {
            requestId: staleRequestId,
            expectedTurnId: turnId,
            input: textInput("override changes every attempt"),
            model: "claude-opus-4-8[1m]",
            executionInputSources: { model: "explicit" },
            permissionMode: "full",
            reasoningLevel: "high",
            serviceTier: "default",
          },
          thread: activeThread,
          afterPrepared: () => {
            preparationCount += 1;
            setThreadExecutionOverride(harness.db, {
              threadId: activeThread.id,
              modelOverride: "claude-mythos-5",
              reasoningLevelOverride:
                preparationCount % 2 === 0 ? "max" : "low",
            });
          },
        }),
      ).rejects.toMatchObject({
        body: {
          code: "thread_command_admission_conflict",
          retryable: true,
        },
      });

      expect(preparationCount).toBe(8);
      expect(getThreadExecutionOverride(harness.db, activeThread.id)).toEqual(
        beforeOverride,
      );
      expect(listAdmissions(harness, activeThread.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: activeThread.id }).filter(
          (event) =>
            event.type === "client/turn/requested" &&
            JSON.parse(event.data).requestId === staleRequestId,
        ),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", activeThread.id),
      ).toHaveLength(0);
    });
  });
});

describe("admitExactInterrupt", () => {
  it("atomically applies lifecycle/event/ledger with actor and event sequence", async () => {
    await withTestHarness(async (harness) => {
      const turnId = "turn_interrupt_1";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        5,
        turnId,
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 3001 });

      const result = await admitExactInterrupt(harness.deps, {
        actor: ALICE,
        environment,
        payload: { requestId, expectedTurnId: turnId },
        thread,
      });

      expect(result.kind).toBe("accepted");
      expect(result.admission).toMatchObject({
        actor: ALICE,
        commandKind: "thread.interrupt",
        requestId,
        result: {
          disposition: "interrupted",
          expectedTurnId: turnId,
          eventSequence: expect.any(Number),
        },
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");

      const interrupted = listEvents(harness.db, { threadId: thread.id }).find(
        (event) => event.type === "system/thread/interrupted",
      );
      expect(interrupted).toMatchObject({
        actorDisplayName: ALICE.displayName,
        actorPrincipalId: ALICE.principalId,
        sequence:
          result.admission.result.disposition === "interrupted"
            ? result.admission.result.eventSequence
            : -1,
      });

      const stopCommand = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "thread.stop" &&
          candidate.command.threadId === thread.id,
      );
      expect(stopCommand.command).toMatchObject({
        type: "thread.stop",
        expectedTurnId: turnId,
      });
    });
  });

  it("replays/conflicts/mismatches and ledger failure leave no partial mutation", async () => {
    await withTestHarness(async (harness) => {
      const turnId = "turn_interrupt_2";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        6,
        turnId,
      );
      const requestId = encodeClientTurnRequestIdNumber({ value: 3002 });

      const first = await admitExactInterrupt(harness.deps, {
        actor: ALICE,
        environment,
        payload: { requestId, expectedTurnId: turnId },
        thread,
      });
      expect(first.kind).toBe("accepted");
      await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "thread.stop" &&
          candidate.command.threadId === thread.id &&
          candidate.command.expectedTurnId === turnId,
      );
      const stopCommandCountAfterAccept = listQueuedThreadCommands(
        harness,
        "thread.stop",
        thread.id,
      ).length;
      const eventsAfter = listEvents(harness.db, {
        threadId: thread.id,
      }).length;

      const replay = await admitExactInterrupt(harness.deps, {
        actor: ALICE,
        environment,
        payload: { requestId, expectedTurnId: turnId },
        thread,
      });
      expect(replay.kind).toBe("replayed");
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(
        eventsAfter,
      );
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toHaveLength(stopCommandCountAfterAccept);

      await expect(
        admitExactInterrupt(harness.deps, {
          actor: BOB,
          environment,
          payload: { requestId, expectedTurnId: turnId },
          thread,
        }),
      ).rejects.toMatchObject({
        body: { code: "thread_command_admission_conflict" },
      });

      const { environment: env2, thread: thread2 } = seedActiveThreadWithTurn(
        harness,
        7,
        "turn_interrupt_3",
      );
      await expect(
        admitExactInterrupt(harness.deps, {
          actor: ALICE,
          environment: env2,
          payload: {
            requestId: encodeClientTurnRequestIdNumber({ value: 3003 }),
            expectedTurnId: "turn_missing",
          },
          thread: thread2,
        }),
      ).rejects.toMatchObject({
        body: { code: "expected_turn_mismatch" },
      });
      expect(getThread(harness.db, thread2.id)?.status).toBe("active");
      expect(listAdmissions(harness, thread2.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: thread2.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(0);

      harness.db.$client.exec(`
        CREATE TRIGGER fail_interrupt_ledger
        BEFORE INSERT ON thread_command_admissions
        BEGIN
          SELECT RAISE(FAIL, 'forced ledger failure');
        END;
      `);
      const { environment: env3, thread: thread3 } = seedActiveThreadWithTurn(
        harness,
        8,
        "turn_interrupt_4",
      );
      await expect(
        admitExactInterrupt(harness.deps, {
          actor: ALICE,
          environment: env3,
          payload: {
            requestId: encodeClientTurnRequestIdNumber({ value: 3004 }),
            expectedTurnId: "turn_interrupt_4",
          },
          thread: thread3,
        }),
      ).rejects.toThrow(/forced ledger failure/i);
      expect(getThread(harness.db, thread3.id)?.status).toBe("active");
      expect(listAdmissions(harness, thread3.id)).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: thread3.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(0);
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread3.id),
      ).toHaveLength(0);
    });
  });

  it("allows interrupt while a pending interaction is open", async () => {
    await withTestHarness(async (harness) => {
      const turnId = "turn_interrupt_pending";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        9,
        turnId,
      );
      createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId,
        providerId: "codex",
        providerThreadId: "provider-pending-interrupt",
        providerRequestId: "request-pending-interrupt",
        payload: JSON.stringify(
          createCommandApprovalPayload({
            itemId: "item-pending-interrupt",
          }),
        ),
      });
      const result = await admitExactInterrupt(harness.deps, {
        actor: ALICE,
        environment,
        payload: {
          requestId: encodeClientTurnRequestIdNumber({ value: 3005 }),
          expectedTurnId: turnId,
        },
        thread,
      });
      expect(result.kind).toBe("accepted");
      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");
    });
  });
});

describe("command admission lookup durability", () => {
  it("returns the original receipt after its queued row is removed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        10,
        "turn_lookup_queue",
      );
      // Make thread active without needing the turn for queue-if-active send.
      const requestId = encodeClientTurnRequestIdNumber({ value: 4001 });
      const accepted = await admitQueueIfActiveSendMessage(harness.deps, {
        actor: ALICE,
        environment,
        payload: {
          input: textInput("queued for lookup"),
          mode: "queue-if-active",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        requestId,
        thread,
      });
      expect(accepted.admission.result.disposition).toBe("queued");
      const [queuedMessage] = listQueuedThreadMessages(harness.db, thread.id);
      expect(queuedMessage).toBeDefined();
      expect(
        deleteQueuedThreadMessage(harness.db, harness.hub, queuedMessage!.id),
      ).toBe(true);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);

      const found = getThreadCommandAdmission(harness.db, {
        threadId: thread.id,
        requestId,
      });
      expect(found).toMatchObject({
        requestId,
        commandKind: "message.send",
        admissionSequence: accepted.admission.admissionSequence,
        result: accepted.admission.result,
      });
    });
  });
});

describe("exact interrupt settlement", () => {
  it("does not finalize a different active turn after a stale exact stop", async () => {
    await withTestHarness(async (harness) => {
      const expectedTurnId = "turn_stop_settlement_old";
      const { environment, thread } = seedActiveThreadWithTurn(
        harness,
        11,
        expectedTurnId,
      );
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-cmd-11",
        threadId: thread.id,
        turnId: "turn_stop_settlement_new",
      });
      harness.db
        .update(threads)
        .set({ status: "stopping" })
        .where(eq(threads.id, thread.id))
        .run();
      const eventCountBeforeSettlement = listEvents(harness.db, {
        threadId: thread.id,
      }).length;

      harness.db.transaction((tx) => {
        const sideEffects = settleThreadStopCommandResult({
          command: {
            type: "thread.stop",
            environmentId: environment.id,
            threadId: thread.id,
            expectedTurnId,
          },
          deps: {
            ...harness.deps,
            db: tx,
            hub: harness.hub,
          },
          execution: {
            createdAt: Date.now(),
            hostId: environment.hostId,
            id: "rpc_exact_stop_stale",
          },
          report: {
            completedAt: Date.now(),
            executionId: "rpc_exact_stop_stale",
            ok: true,
            result: { outcome: "stale" },
            type: "thread.stop",
          },
        });
        expect(sideEffects.postCommitActions).toHaveLength(0);
      });

      expect(getThread(harness.db, thread.id)?.status).toBe("stopping");
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(
        eventCountBeforeSettlement,
      );
    });
  });
});
