import { randomUUID } from "node:crypto";

import {
  createHostId,
  environments,
  getPendingInteraction,
  getThread,
  getThreadCommandAdmission,
  getThreadPrincipalReadStateRow,
  threads,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import type { WorkTogetherRoomChildAttachmentPortV1 } from "../../src/room-distribution/work-together-room-child-attachments.js";
import type { RoomDistributionContextV1 } from "../../src/room-distribution/room-distribution-port.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import {
  createAllowOnceResolution,
  createCommandApprovalPayload,
  createDenyResolution,
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import {
  seedHostSession,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ALICE: Principal = Object.freeze({
  id: "user_alice_room",
  kind: "human",
  displayName: "Alice",
});
const BOB: Principal = Object.freeze({
  id: "user_bob_room",
  kind: "human",
  displayName: "Bob",
});
const NO_CHILDREN: WorkTogetherRoomChildAttachmentPortV1 = Object.freeze({
  attach: async () => {
    throw new Error("unexpected child attachment");
  },
  list: async () => Object.freeze([]),
});
const PRIMARY_STREAM = Object.freeze({ kind: "primary" as const });

function contextFor(
  bindingId: string,
  principal: Principal,
): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal,
    authorize: async () => ({ allowed: true as const }),
  });
}

async function provisionActiveRoom(
  harness: TestAppHarness,
  args: {
    principal: Principal;
    seed: number;
  },
) {
  const candidateHostId = randomUUID();
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  const launch = {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: String(args.seed),
    baseBranch: "main",
    baseRevision: "a".repeat(40),
    generatedBranch: `rooms/interaction-${args.seed}`,
    candidateHostId,
    environmentTemplate: "managed-worktree" as const,
  };
  const target = {
    bbHostId: host.id,
    projectName: `Room Interaction ${args.seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/interaction-${args.seed}`,
  } satisfies WorkTogetherRoomResourceTarget;
  const provisioned = await createWorkTogetherRoomResourceProvisioner(
    harness.deps,
    {
      resolve: () => target,
    },
  ).provision({ principal: args.principal, launch });

  seedThreadRuntimeState(harness.deps, {
    environmentId: provisioned.environmentId,
    providerThreadId: `provider-interaction-${args.seed}`,
    threadId: provisioned.primaryThreadId,
  });
  seedTurnStarted(harness.deps, {
    environmentId: provisioned.environmentId,
    providerThreadId: `provider-interaction-${args.seed}`,
    threadId: provisioned.primaryThreadId,
    turnId: `turn_interaction_${args.seed}`,
  });
  harness.db
    .update(environments)
    .set({ path: `/tmp/room-interaction-${args.seed}`, status: "ready" })
    .where(eq(environments.id, provisioned.environmentId))
    .run();
  harness.db
    .update(threads)
    .set({ status: "active" })
    .where(eq(threads.id, provisioned.primaryThreadId))
    .run();

  return {
    launch,
    provisioned,
    thread: getThread(harness.db, provisioned.primaryThreadId)!,
  };
}

function registerUserQuestion(
  harness: TestAppHarness,
  threadId: string,
  seed: number,
) {
  const turnId = `turn_question_${seed}`;
  const providerThreadId = `provider-question-${seed}`;
  seedTurnStarted(harness.deps, {
    threadId,
    turnId,
    providerThreadId,
  });
  const registered =
    harness.deps.pendingInteractions.registerPendingInteraction({
      interaction: {
        threadId,
        turnId,
        providerId: "codex",
        providerThreadId,
        providerRequestId: `request-question-${seed}`,
        payload: createUserQuestionPayload(),
      },
    });
  if (registered.outcome === "rejected") {
    throw new Error(
      `Expected user-question registration: ${registered.reason}`,
    );
  }
  return registered.interaction;
}

function registerApproval(
  harness: TestAppHarness,
  threadId: string,
  seed: number,
) {
  const turnId = `turn_approval_${seed}`;
  const providerThreadId = `provider-approval-${seed}`;
  seedTurnStarted(harness.deps, {
    threadId,
    turnId,
    providerThreadId,
  });
  const registered =
    harness.deps.pendingInteractions.registerPendingInteraction({
      interaction: {
        threadId,
        turnId,
        providerId: "codex",
        providerThreadId,
        providerRequestId: `request-approval-${seed}`,
        payload: createCommandApprovalPayload({
          itemId: `item-${seed}`,
          reason: "Approve command",
          command: "git push",
          cwd: "/tmp/project",
        }),
      },
    });
  if (registered.outcome === "rejected") {
    throw new Error(`Expected approval registration: ${registered.reason}`);
  }
  return registered.interaction;
}

describe("Room interaction.answer / interaction.approve / read.mark commands", () => {
  it("attributes answer and read.mark to each human principal independently", async () => {
    await withTestHarness(async (harness) => {
      const aliceRoom = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 401,
      });
      const bobRoom = await provisionActiveRoom(harness, {
        principal: BOB,
        seed: 402,
      });
      const aliceQuestion = registerUserQuestion(
        harness,
        aliceRoom.thread.id,
        401,
      );
      const bobQuestion = registerUserQuestion(harness, bobRoom.thread.id, 402);

      const authority = {
        read: async () =>
          Object.freeze({ role: "member" as const, isTaskAssignee: false }),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: aliceRoom.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        authority,
      );

      const aliceAnswer = await distribution.execute(
        contextFor(aliceRoom.launch.bindingId, ALICE),
        {
          kind: "interaction.answer",
          requestId: "creq_23456789aa",
          interactionId: aliceQuestion.id,
          value: createUserAnswerResolution().answers,
          stream: PRIMARY_STREAM,
        },
      );
      expect(aliceAnswer).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "interaction.answer",
          result: { disposition: "answered" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: aliceRoom.thread.id,
          requestId: "creq_23456789aa",
        }),
      ).toMatchObject({
        actor: {
          principalId: ALICE.id,
          principalKind: ALICE.kind,
          displayName: ALICE.displayName,
        },
        result: {
          disposition: "answered",
          interactionId: aliceQuestion.id,
        },
      });
      expect(getPendingInteraction(harness.db, aliceQuestion.id)?.status).toBe(
        "resolving",
      );

      const bobAnswer = await distribution.execute(
        contextFor(bobRoom.launch.bindingId, BOB),
        {
          kind: "interaction.answer",
          requestId: "creq_23456789ab",
          interactionId: bobQuestion.id,
          value: createUserAnswerResolution().answers,
          stream: PRIMARY_STREAM,
        },
      );
      expect(bobAnswer).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "interaction.answer",
          result: { disposition: "answered" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: bobRoom.thread.id,
          requestId: "creq_23456789ab",
        }),
      ).toMatchObject({
        actor: {
          principalId: BOB.id,
          principalKind: BOB.kind,
        },
      });

      const aliceMark = await distribution.execute(
        contextFor(aliceRoom.launch.bindingId, ALICE),
        {
          kind: "read.mark",
          requestId: "creq_23456789ac",
          eventCursor: "s.42",
          stream: PRIMARY_STREAM,
        },
      );
      expect(aliceMark).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "read.mark",
          result: { disposition: "marked" },
          stream: PRIMARY_STREAM,
        },
      });
      const bobMark = await distribution.execute(
        contextFor(bobRoom.launch.bindingId, BOB),
        {
          kind: "read.mark",
          requestId: "creq_23456789ad",
          eventCursor: "s.99",
          stream: PRIMARY_STREAM,
        },
      );
      expect(bobMark).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "read.mark",
          result: { disposition: "marked" },
          stream: PRIMARY_STREAM,
        },
      });

      expect(
        getThreadPrincipalReadStateRow(harness.db, {
          threadId: aliceRoom.thread.id,
          principalId: ALICE.id,
        }),
      ).toMatchObject({ readCursor: "s.42" });
      expect(
        getThreadPrincipalReadStateRow(harness.db, {
          threadId: aliceRoom.thread.id,
          principalId: BOB.id,
        }),
      ).toBeNull();
      expect(
        getThreadPrincipalReadStateRow(harness.db, {
          threadId: bobRoom.thread.id,
          principalId: BOB.id,
        }),
      ).toMatchObject({ readCursor: "s.99" });
      expect(
        getThreadPrincipalReadStateRow(harness.db, {
          threadId: bobRoom.thread.id,
          principalId: ALICE.id,
        }),
      ).toBeNull();
    });
  });

  it("denies interaction.approve for member and non-owner assignee; allows owner", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 411,
      });
      const approval = registerApproval(harness, room.thread.id, 411);
      let policyFacts = {
        role: "member" as "member" | "owner",
        isTaskAssignee: false,
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        { read: async () => ({ ...policyFacts }) },
      );

      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.approve",
          requestId: "creq_23456789ba",
          interactionId: approval.id,
          resolution: createAllowOnceResolution(),
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(getPendingInteraction(harness.db, approval.id)?.status).toBe(
        "pending",
      );

      policyFacts = { role: "member", isTaskAssignee: true };
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.approve",
          requestId: "creq_23456789bb",
          interactionId: approval.id,
          resolution: createAllowOnceResolution(),
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(getPendingInteraction(harness.db, approval.id)?.status).toBe(
        "pending",
      );

      policyFacts = { role: "owner", isTaskAssignee: false };
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.approve",
          requestId: "creq_23456789bc",
          interactionId: approval.id,
          resolution: createAllowOnceResolution(),
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "interaction.approve",
          result: { disposition: "approved" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(getPendingInteraction(harness.db, approval.id)?.status).toBe(
        "resolving",
      );
    });
  });

  it("rejects answer on approval interaction and approve on user-question", async () => {
    await withTestHarness(async (harness) => {
      const questionRoom = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 421,
      });
      const approvalRoom = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 422,
      });
      const question = registerUserQuestion(
        harness,
        questionRoom.thread.id,
        421,
      );
      const approval = registerApproval(harness, approvalRoom.thread.id, 422);
      const ownerAuthority = {
        read: async () =>
          Object.freeze({ role: "owner" as const, isTaskAssignee: false }),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({
            id: questionRoom.launch.taskId,
            title: "Task",
          }),
        },
        NO_CHILDREN,
        ownerAuthority,
      );

      // answer capability only when a user-question is pending
      await expect(
        distribution.execute(contextFor(approvalRoom.launch.bindingId, ALICE), {
          kind: "interaction.answer",
          requestId: "creq_23456789ca",
          interactionId: approval.id,
          value: createUserAnswerResolution().answers,
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(getPendingInteraction(harness.db, approval.id)?.status).toBe(
        "pending",
      );

      // approve capability only when an approval is pending
      await expect(
        distribution.execute(contextFor(questionRoom.launch.bindingId, ALICE), {
          kind: "interaction.approve",
          requestId: "creq_23456789cb",
          interactionId: question.id,
          resolution: createDenyResolution(),
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(getPendingInteraction(harness.db, question.id)?.status).toBe(
        "pending",
      );
    });
  });

  it("replays identical answer request once and dispatches host resolve once", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 431,
      });
      const question = registerUserQuestion(harness, room.thread.id, 431);
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        {
          read: async () =>
            Object.freeze({ role: "member" as const, isTaskAssignee: false }),
        },
      );
      const command = {
        kind: "interaction.answer" as const,
        requestId: "creq_23456789da" as const,
        interactionId: question.id,
        value: createUserAnswerResolution().answers,
        stream: PRIMARY_STREAM,
      };

      const accepted = await distribution.execute(
        contextFor(room.launch.bindingId, ALICE),
        command,
      );
      expect(accepted).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          admissionSequence: 1,
          result: { disposition: "answered" },
          stream: PRIMARY_STREAM,
        },
      });
      const replayed = await distribution.execute(
        contextFor(room.launch.bindingId, ALICE),
        command,
      );
      expect(replayed).toMatchObject({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "already-accepted",
          admissionSequence: 1,
          result: { disposition: "answered" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(JSON.stringify(replayed.body)).not.toContain(question.id);
      expect(getPendingInteraction(harness.db, question.id)?.status).toBe(
        "resolving",
      );

      const queued = await waitForQueuedCommand(
        harness,
        ({ command: hostCommand }) =>
          hostCommand.type === "interactive.resolve" &&
          hostCommand.interactionId === question.id,
      );
      expect(queued.command).toMatchObject({
        type: "interactive.resolve",
        interactionId: question.id,
      });
      // Second identical admission must not queue another host resolve.
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command: hostCommand, row }) =>
            hostCommand.type === "interactive.resolve" &&
            hostCommand.interactionId === question.id &&
            row.id !== queued.row.id,
          200,
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects identity conflict without mutating state", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 441,
      });
      const question = registerUserQuestion(harness, room.thread.id, 441);
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        {
          read: async () =>
            Object.freeze({ role: "member" as const, isTaskAssignee: false }),
        },
      );
      const requestId = "creq_23456789ea";
      await distribution.execute(contextFor(room.launch.bindingId, ALICE), {
        kind: "interaction.answer",
        requestId,
        interactionId: question.id,
        value: createUserAnswerResolution({ selected: ["staging"] }).answers,
        stream: PRIMARY_STREAM,
      });

      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.answer",
          requestId,
          interactionId: question.id,
          value: createUserAnswerResolution({ selected: ["production"] })
            .answers,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toEqual({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          requestId,
          commandKind: "interaction.answer",
          reason: "request_identity_conflict",
          stream: PRIMARY_STREAM,
        },
      });

      // Different actor, same requestId/input also conflicts.
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, BOB), {
          kind: "interaction.answer",
          requestId,
          interactionId: question.id,
          value: createUserAnswerResolution({ selected: ["staging"] }).answers,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toEqual({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          requestId,
          commandKind: "interaction.answer",
          reason: "request_identity_conflict",
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.thread.id,
          requestId,
        }),
      ).toMatchObject({
        actor: { principalId: ALICE.id },
      });
    });
  });

  it("rolls back pending→resolving and read-state when ledger persistence fails", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 451,
      });
      const question = registerUserQuestion(harness, room.thread.id, 451);
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        {
          read: async () =>
            Object.freeze({ role: "member" as const, isTaskAssignee: false }),
        },
      );
      harness.db.$client.exec(`
        CREATE TRIGGER fail_room_interaction_ledger_insert
        BEFORE INSERT ON thread_command_admissions
        BEGIN
          SELECT RAISE(ABORT, 'forced room interaction ledger failure');
        END;
      `);

      try {
        await expect(
          distribution.execute(contextFor(room.launch.bindingId, ALICE), {
            kind: "interaction.answer",
            requestId: "creq_23456789fa",
            interactionId: question.id,
            value: createUserAnswerResolution().answers,
            stream: PRIMARY_STREAM,
          }),
        ).resolves.toMatchObject({
          status: 200,
          body: {
            schemaVersion: 2,
            outcome: "indeterminate",
            requestId: "creq_23456789fa",
            commandKind: "interaction.answer",
            stream: PRIMARY_STREAM,
          },
        });
        expect(getPendingInteraction(harness.db, question.id)?.status).toBe(
          "pending",
        );
        expect(
          getThreadCommandAdmission(harness.db, {
            threadId: room.thread.id,
            requestId: "creq_23456789fa",
          }),
        ).toBeNull();

        const readRowBefore = getThreadPrincipalReadStateRow(harness.db, {
          threadId: room.thread.id,
          principalId: ALICE.id,
        });
        await expect(
          distribution.execute(contextFor(room.launch.bindingId, ALICE), {
            kind: "read.mark",
            requestId: "creq_23456789fb",
            eventCursor: "s.7",
            stream: PRIMARY_STREAM,
          }),
        ).resolves.toMatchObject({
          status: 200,
          body: {
            schemaVersion: 2,
            outcome: "indeterminate",
            requestId: "creq_23456789fb",
            commandKind: "read.mark",
            stream: PRIMARY_STREAM,
          },
        });
        const readRowAfter = getThreadPrincipalReadStateRow(harness.db, {
          threadId: room.thread.id,
          principalId: ALICE.id,
        });
        // Ledger failure rolls back the cursor write; pre-existing rows may
        // remain, but must not advance to the attempted cursor.
        expect(readRowAfter?.readCursor ?? null).toBe(
          readRowBefore?.readCursor ?? null,
        );
        expect(readRowAfter?.readCursor ?? null).not.toBe("s.7");
        expect(
          getThreadCommandAdmission(harness.db, {
            threadId: room.thread.id,
            requestId: "creq_23456789fb",
          }),
        ).toBeNull();
      } finally {
        harness.db.$client.exec(
          "DROP TRIGGER IF EXISTS fail_room_interaction_ledger_insert",
        );
      }

      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "interactive.resolve" &&
            command.interactionId === question.id,
          200,
        ),
      ).rejects.toThrow();
    });
  });

  it("persists read.mark cursor on caller principal row without touching global column", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 461,
      });
      const globalBefore = getThread(harness.db, room.thread.id)!.lastReadAt;
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        {
          read: async () =>
            Object.freeze({ role: "member" as const, isTaskAssignee: false }),
        },
      );

      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "read.mark",
          requestId: "creq_23456789ga",
          eventCursor: "s.123",
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "read.mark",
          result: { disposition: "marked" },
          stream: PRIMARY_STREAM,
        },
      });

      expect(
        getThreadPrincipalReadStateRow(harness.db, {
          threadId: room.thread.id,
          principalId: ALICE.id,
        }),
      ).toMatchObject({
        principalId: ALICE.id,
        readCursor: "s.123",
      });
      expect(getThread(harness.db, room.thread.id)!.lastReadAt).toBe(
        globalBefore,
      );
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.thread.id,
          requestId: "creq_23456789ga",
        }),
      ).toMatchObject({
        actor: { principalId: ALICE.id },
        result: { disposition: "marked", readCursor: "s.123" },
      });
      expect(
        JSON.stringify(
          (
            await distribution.execute(
              contextFor(room.launch.bindingId, ALICE),
              {
                kind: "read.mark",
                requestId: "creq_23456789ga",
                eventCursor: "s.123",
                stream: PRIMARY_STREAM,
              },
            )
          ).body,
        ),
      ).not.toContain("s.123");
    });
  });

  it("capability projection matches execution authority and execute rechecks authority", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionActiveRoom(harness, {
        principal: ALICE,
        seed: 471,
      });
      const question = registerUserQuestion(harness, room.thread.id, 471);
      let policyFacts = {
        role: "member" as "member" | "owner",
        isTaskAssignee: false,
      };
      const authority = {
        read: vi.fn(async () => ({ ...policyFacts })),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        authority,
      );

      await expect(
        distribution.bootstrap(contextFor(room.launch.bindingId, ALICE)),
      ).resolves.toMatchObject({
        capabilities: [
          "message.send",
          "message.steer",
          "interaction.answer",
          "read.mark",
        ],
      });

      policyFacts = { role: "owner", isTaskAssignee: false };
      // Still user-question pending: owner sees answer + read.mark, not approve.
      await expect(
        distribution.bootstrap(contextFor(room.launch.bindingId, ALICE)),
      ).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          "interaction.answer",
          "read.mark",
          "agent.interrupt",
        ]),
      });
      const ownerBootstrap = await distribution.bootstrap(
        contextFor(room.launch.bindingId, ALICE),
      );
      expect(ownerBootstrap.capabilities).not.toContain("interaction.approve");

      // Force approval pending and project owner approve.
      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId: question.id,
        reason: "test-swap",
      });
      const approval = registerApproval(harness, room.thread.id, 472);
      await expect(
        distribution.bootstrap(contextFor(room.launch.bindingId, ALICE)),
      ).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          "interaction.approve",
          "read.mark",
        ]),
      });
      const ownerWithApproval = await distribution.bootstrap(
        contextFor(room.launch.bindingId, ALICE),
      );
      expect(ownerWithApproval.capabilities).not.toContain(
        "interaction.answer",
      );

      // Stale projection: demote to member then direct execute still rechecks.
      policyFacts = { role: "member", isTaskAssignee: true };
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.approve",
          requestId: "creq_23456789ha",
          interactionId: approval.id,
          resolution: createAllowOnceResolution(),
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(getPendingInteraction(harness.db, approval.id)?.status).toBe(
        "pending",
      );

      // Assignee member may answer ordinary questions.
      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId: approval.id,
        reason: "test-swap-back",
      });
      const secondQuestion = registerUserQuestion(harness, room.thread.id, 473);
      policyFacts = { role: "member", isTaskAssignee: true };
      await expect(
        distribution.bootstrap(contextFor(room.launch.bindingId, ALICE)),
      ).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          "interaction.answer",
          "read.mark",
          "agent.interrupt",
        ]),
      });
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "interaction.answer",
          requestId: "creq_23456789hb",
          interactionId: secondQuestion.id,
          value: createUserAnswerResolution().answers,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "interaction.answer",
          stream: PRIMARY_STREAM,
        },
      });
    });
  });
});
