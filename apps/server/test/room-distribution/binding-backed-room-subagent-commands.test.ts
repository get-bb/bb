import { randomUUID } from "node:crypto";

import {
  createEventId,
  createHostId,
  environments,
  events,
  getLatestThreadSequence,
  getThreadCommandAdmission,
  threads,
} from "@bb/db";
import { turnScope, type Principal } from "@bb/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import type {
  WorkTogetherRoomChildAttachmentPortV1,
  WorkTogetherRoomChildAttachmentV1,
} from "../../src/room-distribution/work-together-room-child-attachments.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
  type RoomJsonObject,
} from "../../src/room-distribution/room-distribution-port.js";
import { deriveWorkTogetherRoomPublicTurnId } from "../../src/room-distribution/work-together-room-timeline-projection.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import {
  createAllowOnceResolution,
  createUserAnswerResolution,
  createUserQuestionPayload,
  createCommandApprovalPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEvent,
  seedHostSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_room_subagent_commands",
  kind: "human",
  displayName: "Room Subagent Commander",
});
const PRIMARY_STREAM = Object.freeze({ kind: "primary" as const });
const ACCEPTED_RECEIPT_KEYS = [
  "schemaVersion",
  "outcome",
  "requestId",
  "commandKind",
  "admissionSequence",
  "result",
  "createdAt",
  "completedAt",
  "stream",
] as const;
const REJECTED_RECEIPT_KEYS = [
  "schemaVersion",
  "outcome",
  "requestId",
  "commandKind",
  "reason",
  "stream",
] as const;

function context(
  bindingId: string,
  principal: Principal = PRINCIPAL,
): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal,
    authorize: async () => ({ allowed: true as const }),
  });
}

function subagentStream(id: string) {
  return Object.freeze({ kind: "subagent" as const, id });
}

function assertExactAcceptedReceipt(
  body: RoomJsonObject,
  expected: {
    commandKind: string;
    outcome: "accepted" | "already-accepted";
    requestId: string;
    stream: { kind: "primary" } | { kind: "subagent"; id: string };
  },
) {
  expect(Object.keys(body)).toEqual([...ACCEPTED_RECEIPT_KEYS]);
  expect(body.schemaVersion).toBe(2);
  expect(body.outcome).toBe(expected.outcome);
  expect(body.requestId).toBe(expected.requestId);
  expect(body.commandKind).toBe(expected.commandKind);
  expect(body.stream).toEqual(expected.stream);
}

function assertExactRejectedReceipt(
  body: RoomJsonObject,
  expected: {
    commandKind: string;
    reason: string;
    requestId: string;
    stream: { kind: "primary" } | { kind: "subagent"; id: string };
  },
) {
  expect(Object.keys(body)).toEqual([...REJECTED_RECEIPT_KEYS]);
  expect(body).toEqual({
    schemaVersion: 2,
    outcome: "rejected",
    requestId: expected.requestId,
    commandKind: expected.commandKind,
    reason: expected.reason,
    stream: expected.stream,
  });
}

function assertNoPrivateCommandLeak(
  body: RoomJsonObject,
  ids: {
    childThreadIds: readonly string[];
    environmentId: string;
    primaryThreadId: string;
    privateTurnIds?: readonly string[];
    projectId: string;
  },
) {
  const wire = JSON.stringify(body);
  expect(wire).not.toContain(ids.primaryThreadId);
  expect(wire).not.toContain(ids.environmentId);
  expect(wire).not.toContain(ids.projectId);
  for (const threadId of ids.childThreadIds) {
    expect(wire).not.toContain(threadId);
  }
  for (const turnId of ids.privateTurnIds ?? []) {
    expect(wire).not.toContain(turnId);
  }
}

async function provisionRoom(harness: TestAppHarness, seed: number) {
  const candidateHostId = randomUUID();
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  const launch = {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: String(seed),
    baseBranch: "main",
    baseRevision: "a".repeat(40),
    generatedBranch: `rooms/subagent-commands-${seed}`,
    candidateHostId,
    environmentTemplate: "managed-worktree" as const,
  };
  const target = {
    bbHostId: host.id,
    projectName: `Room Subagent Commands ${seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/subagent-commands-${seed}`,
  } satisfies WorkTogetherRoomResourceTarget;
  const provisioned = await createWorkTogetherRoomResourceProvisioner(
    harness.deps,
    { resolve: () => target },
  ).provision({ principal: PRINCIPAL, launch });
  harness.db
    .update(environments)
    .set({ path: `/tmp/room-subagent-commands-${seed}`, status: "ready" })
    .where(eq(environments.id, provisioned.environmentId))
    .run();
  return { launch, provisioned };
}

function attachChildren(ids: ReadonlyMap<string, string>) {
  const attached: WorkTogetherRoomChildAttachmentV1[] = [];
  const port: WorkTogetherRoomChildAttachmentPortV1 = {
    attach: vi.fn(async (input) => {
      const id = ids.get(input.childThreadId);
      if (id === undefined) throw new Error("unexpected child");
      const existing = attached.find(
        (entry) => entry.childThreadId === input.childThreadId,
      );
      if (existing !== undefined) return existing;
      const entry = Object.freeze({
        id,
        childThreadId: input.childThreadId,
        parentThreadId: input.parentThreadId,
      });
      attached.push(entry);
      return entry;
    }),
    list: vi.fn(async () => Object.freeze([...attached])),
  };
  return { attached, port };
}

function seedRootTurnOutcome(
  deps: Parameters<typeof seedEvent>[0],
  args: {
    environmentId: string;
    startSequence: number;
    status: "completed" | "failed" | "interrupted";
    threadId: string;
    turnId: string;
  },
) {
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.turnId}`,
    scope: turnScope(args.turnId),
    sequence: args.startSequence,
    type: "turn/started",
    data: {},
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.turnId}`,
    scope: turnScope(args.turnId),
    sequence: args.startSequence + 1,
    type: "turn/completed",
    data: { status: args.status },
  });
}

function prepareActiveThread(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    seed: string;
    threadId: string;
    turnId: string;
  },
) {
  seedThreadRuntimeState(harness.deps, {
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.seed}`,
    threadId: args.threadId,
  });
  seedTurnStarted(harness.deps, {
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.seed}`,
    threadId: args.threadId,
    turnId: args.turnId,
  });
  harness.db
    .update(threads)
    .set({ status: "active" })
    .where(eq(threads.id, args.threadId))
    .run();
}

describe("Room Subagent command contract", () => {
  it("admits selected Subagent send/steer/interrupt onto that private thread and public stream", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 601);
      const direct = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Direct worker",
      });
      const nested = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: direct.id,
        title: "Nested worker",
      });
      seedRootTurnOutcome(harness.deps, {
        environmentId: room.provisioned.environmentId,
        startSequence: 1,
        status: "completed",
        threadId: direct.id,
        turnId: "turn_direct_completed",
      });
      const nestedTurnId = "turn_nested_live";
      prepareActiveThread(harness, {
        environmentId: room.provisioned.environmentId,
        seed: "nested-live",
        threadId: nested.id,
        turnId: nestedTurnId,
      });
      prepareActiveThread(harness, {
        environmentId: room.provisioned.environmentId,
        seed: "primary-live",
        threadId: room.provisioned.primaryThreadId,
        turnId: "turn_primary_live",
      });
      const ids = new Map([
        [direct.id, randomUUID()],
        [nested.id, randomUUID()],
      ]);
      const { attached, port } = attachChildren(ids);
      const commandAuthority = {
        read: vi.fn(async () =>
          Object.freeze({ role: "owner" as const, isTaskAssignee: false }),
        ),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        port,
        commandAuthority,
      );
      await distribution.bootstrap(context(room.launch.bindingId));
      const nestedStream = subagentStream(ids.get(nested.id)!);
      const nestedPublicTurnId = deriveWorkTogetherRoomPublicTurnId({
        bindingId: room.launch.bindingId,
        privateTurnId: nestedTurnId,
        publicStreamId: ids.get(nested.id)!,
      });
      const leakIds = {
        childThreadIds: [direct.id, nested.id],
        environmentId: room.provisioned.environmentId,
        primaryThreadId: room.provisioned.primaryThreadId,
        privateTurnIds: [
          nestedTurnId,
          "turn_direct_completed",
          "turn_primary_live",
        ],
        projectId: room.provisioned.projectId,
      };

      const send = {
        kind: "message.send" as const,
        requestId: "creq_23456789sa",
        text: "Work on the nested stream",
        stream: nestedStream,
      };
      const acceptedSend = await distribution.execute(
        context(room.launch.bindingId),
        send,
      );
      expect(acceptedSend.status).toBe(202);
      expect(acceptedSend.body.result).toEqual({ disposition: "queued" });
      assertExactAcceptedReceipt(acceptedSend.body, {
        commandKind: "message.send",
        outcome: "accepted",
        requestId: send.requestId,
        stream: nestedStream,
      });
      assertNoPrivateCommandLeak(acceptedSend.body, leakIds);
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: send.requestId,
        }),
      ).toMatchObject({ commandKind: "message.send" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.provisioned.primaryThreadId,
          requestId: send.requestId,
        }),
      ).toBeNull();
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: direct.id,
          requestId: send.requestId,
        }),
      ).toBeNull();

      const replayedSend = await distribution.execute(
        context(room.launch.bindingId),
        send,
      );
      expect(replayedSend.status).toBe(200);
      assertExactAcceptedReceipt(replayedSend.body, {
        commandKind: "message.send",
        outcome: "already-accepted",
        requestId: send.requestId,
        stream: nestedStream,
      });

      const primarySameRequest = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "message.send",
          requestId: send.requestId,
          text: "Primary uses the same request id independently",
          stream: PRIMARY_STREAM,
        },
      );
      expect(primarySameRequest.status).toBe(202);
      assertExactAcceptedReceipt(primarySameRequest.body, {
        commandKind: "message.send",
        outcome: "accepted",
        requestId: send.requestId,
        stream: PRIMARY_STREAM,
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.provisioned.primaryThreadId,
          requestId: send.requestId,
        }),
      ).toMatchObject({ commandKind: "message.send" });

      const steered = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "message.steer",
          requestId: "creq_23456789sb",
          expectedTurnId: nestedPublicTurnId,
          text: "Steer only the nested turn",
          stream: nestedStream,
        },
      );
      expect(steered.status).toBe(202);
      assertExactAcceptedReceipt(steered.body, {
        commandKind: "message.steer",
        outcome: "accepted",
        requestId: "creq_23456789sb",
        stream: nestedStream,
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: "creq_23456789sb",
        }),
      ).toMatchObject({
        result: { disposition: "steered", expectedTurnId: nestedTurnId },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.provisioned.primaryThreadId,
          requestId: "creq_23456789sb",
        }),
      ).toBeNull();

      const wrongTurn = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "message.steer",
          requestId: "creq_23456789sc",
          expectedTurnId: deriveWorkTogetherRoomPublicTurnId({
            bindingId: room.launch.bindingId,
            privateTurnId: nestedTurnId,
            publicStreamId: room.launch.bindingId,
          }),
          text: "Reject a Primary-hashed turn id",
          stream: nestedStream,
        },
      );
      expect(wrongTurn.status).toBe(200);
      assertExactRejectedReceipt(wrongTurn.body, {
        commandKind: "message.steer",
        reason: "turn_mismatch",
        requestId: "creq_23456789sc",
        stream: nestedStream,
      });
      assertNoPrivateCommandLeak(wrongTurn.body, leakIds);

      const interrupted = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "agent.interrupt",
          requestId: "creq_23456789sd",
          expectedTurnId: nestedPublicTurnId,
          stream: nestedStream,
        },
      );
      expect(interrupted.status).toBe(202);
      assertExactAcceptedReceipt(interrupted.body, {
        commandKind: "agent.interrupt",
        outcome: "accepted",
        requestId: "creq_23456789sd",
        stream: nestedStream,
      });
      expect(JSON.stringify(interrupted.body)).not.toContain(
        "thread.interrupt",
      );
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: "creq_23456789sd",
        }),
      ).toMatchObject({
        commandKind: "thread.interrupt",
        result: { disposition: "interrupted", expectedTurnId: nestedTurnId },
      });
      expect(attached.map((entry) => entry.id)).toEqual([
        ids.get(direct.id),
        ids.get(nested.id),
      ]);
    });
  });

  it("admits nested question and approval against the selected Subagent only", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 602);
      const direct = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Direct worker",
      });
      const nested = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: direct.id,
        title: "Nested worker",
      });
      prepareActiveThread(harness, {
        environmentId: room.provisioned.environmentId,
        seed: "direct-approval",
        threadId: direct.id,
        turnId: "turn_direct_approval",
      });
      prepareActiveThread(harness, {
        environmentId: room.provisioned.environmentId,
        seed: "nested-question",
        threadId: nested.id,
        turnId: "turn_nested_question",
      });
      const question =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: nested.id,
            turnId: "turn_nested_question",
            providerId: "codex",
            providerThreadId: "provider-nested-question",
            providerRequestId: "request-nested-question",
            payload: createUserQuestionPayload(),
          },
        });
      if (question.outcome === "rejected") {
        throw new Error(`Expected nested question: ${question.reason}`);
      }
      const approval =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: direct.id,
            turnId: "turn_direct_approval",
            providerId: "codex",
            providerThreadId: "provider-direct-approval",
            providerRequestId: "request-direct-approval",
            payload: createCommandApprovalPayload({
              itemId: "item-direct",
              reason: "Approve direct command",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
        });
      if (approval.outcome === "rejected") {
        throw new Error(`Expected direct approval: ${approval.reason}`);
      }
      const ids = new Map([
        [direct.id, randomUUID()],
        [nested.id, randomUUID()],
      ]);
      const { port } = attachChildren(ids);
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        port,
        {
          read: async () =>
            Object.freeze({ role: "owner" as const, isTaskAssignee: false }),
        },
      );
      await distribution.bootstrap(context(room.launch.bindingId));
      const nestedStream = subagentStream(ids.get(nested.id)!);

      const answered = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "interaction.answer",
          requestId: "creq_23456789se",
          interactionId: question.interaction.id,
          value: createUserAnswerResolution().answers,
          stream: nestedStream,
        },
      );
      expect(answered.status).toBe(202);
      assertExactAcceptedReceipt(answered.body, {
        commandKind: "interaction.answer",
        outcome: "accepted",
        requestId: "creq_23456789se",
        stream: nestedStream,
      });
      expect(JSON.stringify(answered.body)).not.toContain(
        question.interaction.id,
      );
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: "creq_23456789se",
        }),
      ).toMatchObject({
        result: {
          disposition: "answered",
          interactionId: question.interaction.id,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.provisioned.primaryThreadId,
          requestId: "creq_23456789se",
        }),
      ).toBeNull();

      const directStream = subagentStream(ids.get(direct.id)!);
      const approved = await distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "interaction.approve",
          requestId: "creq_23456789sf",
          interactionId: approval.interaction.id,
          resolution: createAllowOnceResolution(),
          stream: directStream,
        },
      );
      expect(approved.status).toBe(202);
      assertExactAcceptedReceipt(approved.body, {
        commandKind: "interaction.approve",
        outcome: "accepted",
        requestId: "creq_23456789sf",
        stream: directStream,
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: direct.id,
          requestId: "creq_23456789sf",
        }),
      ).toMatchObject({ commandKind: "interaction.approve" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: "creq_23456789sf",
        }),
      ).toBeNull();
    });
  });

  it("denies Subagent read.mark and branch.publish, failed idle send, and re-reads authority", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 603);
      const failed = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Failed worker",
      });
      const nested = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: failed.id,
        title: "Nested worker",
      });
      seedRootTurnOutcome(harness.deps, {
        environmentId: room.provisioned.environmentId,
        startSequence: 1,
        status: "failed",
        threadId: failed.id,
        turnId: "turn_failed_idle",
      });
      const nestedTurnId = "turn_nested_authority";
      prepareActiveThread(harness, {
        environmentId: room.provisioned.environmentId,
        seed: "nested-authority",
        threadId: nested.id,
        turnId: nestedTurnId,
      });
      const ids = new Map([
        [failed.id, randomUUID()],
        [nested.id, randomUUID()],
      ]);
      const { attached, port } = attachChildren(ids);
      let policyFacts = {
        role: "owner" as "member" | "owner",
        isTaskAssignee: false,
      };
      const commandAuthority = {
        read: vi.fn(async () => ({ ...policyFacts })),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        port,
        commandAuthority,
      );
      const bootstrap = await distribution.bootstrap(
        context(room.launch.bindingId),
      );
      expect(bootstrap.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: ids.get(failed.id),
            lifecycle: "failed",
            capabilities: [],
          }),
          expect.objectContaining({
            id: ids.get(nested.id),
            capabilities: expect.arrayContaining(["agent.interrupt"]),
          }),
        ]),
      );
      const failedStream = subagentStream(ids.get(failed.id)!);
      const nestedStream = subagentStream(ids.get(nested.id)!);

      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "read.mark",
          requestId: "creq_23456789sg",
          eventCursor: "s.1",
          stream: failedStream,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "branch.publish",
          requestId: "creq_23456789sh",
          stream: nestedStream,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "message.send",
          requestId: "creq_23456789si",
          text: "Failed idle cannot send",
          stream: failedStream,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: failed.id,
          requestId: "creq_23456789si",
        }),
      ).toBeNull();

      policyFacts = { role: "member", isTaskAssignee: false };
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "agent.interrupt",
          requestId: "creq_23456789sj",
          expectedTurnId: deriveWorkTogetherRoomPublicTurnId({
            bindingId: room.launch.bindingId,
            privateTurnId: nestedTurnId,
            publicStreamId: ids.get(nested.id)!,
          }),
          stream: nestedStream,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: nested.id,
          requestId: "creq_23456789sj",
        }),
      ).toBeNull();
      expect(commandAuthority.read.mock.calls.length).toBeGreaterThan(1);

      const corrupt = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Corrupt worker",
      });
      const corruptTurnId = "turn_corrupt_root_outcome";
      seedTurnStarted(harness.deps, {
        environmentId: room.provisioned.environmentId,
        threadId: corrupt.id,
        turnId: corruptTurnId,
      });
      harness.db
        .insert(events)
        .values({
          id: createEventId(),
          threadId: corrupt.id,
          environmentId: room.provisioned.environmentId,
          scopeKind: "turn",
          turnId: corruptTurnId,
          providerThreadId: "provider-corrupt-root-outcome",
          sequence:
            getLatestThreadSequence(harness.db, { threadId: corrupt.id }) + 1,
          type: "turn/completed",
          itemId: null,
          itemKind: null,
          actorPrincipalId: null,
          actorKind: null,
          actorDisplayName: null,
          data: JSON.stringify({ status: "corrupt" }),
          createdAt: Date.now(),
        })
        .run();
      const corruptId = randomUUID();
      attached.push(
        Object.freeze({
          id: corruptId,
          childThreadId: corrupt.id,
          parentThreadId: room.provisioned.primaryThreadId,
        }),
      );
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "message.send",
          requestId: "creq_23456789sp",
          text: "Malformed outcome is unavailable",
          stream: subagentStream(corruptId),
        }),
      ).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
    });
  });

  it("fails unknown, cross-Room, and wrong-ancestry targets the same as a malformed body", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 604);
      const direct = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Direct worker",
      });
      const nested = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: direct.id,
        title: "Nested worker",
      });
      const ids = new Map([
        [direct.id, randomUUID()],
        [nested.id, randomUUID()],
      ]);
      const { attached, port } = attachChildren(ids);
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: room.launch.taskId, title: "Task" }) },
        port,
        {
          read: async () =>
            Object.freeze({ role: "owner" as const, isTaskAssignee: false }),
        },
      );
      await distribution.bootstrap(context(room.launch.bindingId));
      const malformed = distribution.execute(context(room.launch.bindingId), {
        kind: "message.send",
        requestId: "creq_23456789sk",
        text: "Missing stream",
      });
      await expect(malformed).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      const extraStreamKey = distribution.execute(
        context(room.launch.bindingId),
        {
          kind: "message.send",
          requestId: "creq_23456789st",
          text: "Extra stream key",
          stream: { kind: "primary", id: room.launch.bindingId },
        },
      );
      await expect(extraStreamKey).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      const unknown = distribution.execute(context(room.launch.bindingId), {
        kind: "message.send",
        requestId: "creq_23456789sm",
        text: "Unknown subagent",
        stream: subagentStream(randomUUID()),
      });
      await expect(unknown).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });

      const wrongAncestryId = randomUUID();
      attached.push(
        Object.freeze({
          id: wrongAncestryId,
          childThreadId: direct.id,
          parentThreadId: nested.id,
        }),
      );
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "message.send",
          requestId: "creq_23456789sn",
          text: "Wrong ancestry",
          stream: subagentStream(wrongAncestryId),
        }),
      ).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      expect(attached.pop()?.id).toBe(wrongAncestryId);

      const otherPrimary = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
      });
      const crossRoomChild = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: otherPrimary.id,
      });
      const crossRoomId = randomUUID();
      attached.push(
        Object.freeze({
          id: crossRoomId,
          childThreadId: crossRoomChild.id,
          parentThreadId: otherPrimary.id,
        }),
      );
      await expect(
        distribution.execute(context(room.launch.bindingId), {
          kind: "message.send",
          requestId: "creq_23456789su",
          text: "Cross room",
          stream: subagentStream(crossRoomId),
        }),
      ).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: crossRoomChild.id,
          requestId: "creq_23456789su",
        }),
      ).toBeNull();
    });
  });
});
