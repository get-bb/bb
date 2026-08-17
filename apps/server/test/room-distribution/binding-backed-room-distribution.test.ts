import { randomUUID } from "node:crypto";

import {
  createEventId,
  createHostId,
  environments,
  events,
  getLatestThreadSequence,
  getThreadCommandAdmission,
  listTimelineSegmentAnchorsDescending,
  threads,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Principal,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  createBindingBackedRoomDistributionV1,
  type WorkTogetherRoomTaskProjectionPortV1,
} from "../../src/room-distribution/binding-backed-room-distribution.js";
import type {
  WorkTogetherRoomChildAttachmentPortV1,
  WorkTogetherRoomChildAttachmentV1,
} from "../../src/room-distribution/work-together-room-child-attachments.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
} from "../../src/room-distribution/room-distribution-port.js";
import { deriveWorkTogetherRoomPublicTurnId } from "../../src/room-distribution/work-together-room-timeline-projection.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import {
  seedEvent,
  seedHostSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { withTestHarness } from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_room_reader",
  kind: "human",
  displayName: "Room Reader",
});
const PRINCIPAL_B: Principal = Object.freeze({
  id: "user_room_reader_b",
  kind: "human",
  displayName: "Room Reader B",
});
const NO_CHILDREN: WorkTogetherRoomChildAttachmentPortV1 = Object.freeze({
  attach: async () => {
    throw new Error("unexpected child attachment");
  },
  list: async () => Object.freeze([]),
});
const MEMBER_AUTHORITY = Object.freeze({
  read: async () =>
    Object.freeze({ role: "member" as const, isTaskAssignee: false }),
});
const PRIMARY_STREAM = Object.freeze({ kind: "primary" as const });

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

function seedMessageTurn(
  deps: Parameters<typeof seedEvent>[0],
  args: {
    environmentId: string;
    firstTurn?: boolean;
    requestId: number;
    startSequence: number;
    text: string;
    threadId: string;
    turnId: string;
  },
): void {
  const clientRequestId = encodeClientTurnRequestIdNumber({
    value: args.requestId,
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.startSequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: clientRequestId,
      input: [{ type: "text", text: args.text, mentions: [] }],
      target: args.firstTurn ? { kind: "thread-start" } : { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-room-timeline",
    scope: turnScope(args.turnId),
    sequence: args.startSequence + 1,
    type: "turn/started",
    data: {},
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-room-timeline",
    scope: turnScope(args.turnId),
    sequence: args.startSequence + 2,
    type: "turn/input/accepted",
    data: { clientRequestId },
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-room-timeline",
    scope: turnScope(args.turnId),
    sequence: args.startSequence + 3,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: `${args.turnId}-assistant`,
        text: `${args.text} — answered.`,
      },
    },
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-room-timeline",
    scope: turnScope(args.turnId),
    sequence: args.startSequence + 4,
    type: "turn/completed",
    data: { status: "completed" },
  });
}

function assertNoPrivateTimelineLeak(
  wire: string,
  ids: {
    environmentId: string;
    principalIds?: readonly string[];
    primaryThreadId: string;
    projectId: string;
  },
): void {
  expect(wire).not.toContain(ids.primaryThreadId);
  expect(wire).not.toContain(ids.environmentId);
  expect(wire).not.toContain(ids.projectId);
  expect(wire).not.toContain("anchorId");
  expect(wire).not.toMatch(/:in-turn:|:byte-window:/u);
  for (const principalId of ids.principalIds ?? []) {
    expect(wire).not.toContain(principalId);
  }
}

describe("binding-backed Work Together Room distribution", () => {
  it("combines canonical WT task data with a sanitized bounded BB timeline", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const providerRepositoryId = "42";
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const target = {
        bbHostId: host.id,
        projectName: "Room Distribution Repository",
        providerId: "codex",
        sourcePath: "/srv/work-together/distribution",
      } satisfies WorkTogetherRoomResourceTarget;
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 3,
        providerRepositoryId,
        baseBranch: "main",
        generatedBranch: "rooms/distribution-room",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioner = createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve(input) {
            return input.candidateHostId === candidateHostId &&
              input.providerRepositoryId === providerRepositoryId
              ? target
              : null;
          },
        },
      );
      const provisioned = await provisioner.provision({
        principal: PRINCIPAL,
        launch,
      });
      const taskProjection: WorkTogetherRoomTaskProjectionPortV1 = {
        read: vi.fn(async () => ({
          id: launch.taskId,
          title: "Canonical task",
          accountableParticipant: {
            principalId: PRINCIPAL.id,
            principalKind: PRINCIPAL.kind,
            displayName: PRINCIPAL.displayName,
          },
        })),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        taskProjection,
        NO_CHILDREN,
        MEMBER_AUTHORITY,
      );

      const bootstrap = await distribution.bootstrap(context(launch.bindingId));
      expect(bootstrap).toMatchObject({
        schemaVersion: 2,
        binding: { id: launch.bindingId, state: "active" },
        cell: { connection: "ready" },
        task: { id: launch.taskId, title: "Canonical task" },
        repository: {
          bindingId: launch.repositoryBindingId,
          bindingVersion: 3,
          generatedBranch: launch.generatedBranch,
        },
        capabilities: ["read.mark"],
        subagents: [],
      });
      const ownerDistribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        taskProjection,
        NO_CHILDREN,
        { read: async () => ({ role: "owner", isTaskAssignee: false }) },
      );
      await expect(
        ownerDistribution.bootstrap(context(launch.bindingId)),
      ).resolves.toMatchObject({
        capabilities: ["agent.interrupt", "read.mark"],
      });
      expect(taskProjection.read).toHaveBeenCalledWith({
        bindingId: launch.bindingId,
        workspaceId: launch.workspaceId,
        taskId: launch.taskId,
        principal: PRINCIPAL,
      });
      const wire = JSON.stringify(bootstrap);
      expect(wire).not.toContain(provisioned.primaryThreadId);
      expect(wire).not.toContain(provisioned.environmentId);
      expect(wire).not.toContain(provisioned.projectId);
      expect(wire).not.toContain(PRINCIPAL.id);
      expect(wire).toContain("participant_");

      const first = await distribution.events(context(launch.bindingId), {
        subagentId: null,
        cursor: "s.0",
      });
      expect(first.changed).toBe(true);
      expect(first.timeline).toEqual(bootstrap.timeline);
      const cursor = first.cursor as string;
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: null,
          cursor,
        }),
      ).resolves.toMatchObject({ changed: false, timeline: null, cursor });
    });
  });

  it("emits cursor invalidations only for the bound primary thread and stops cleanly", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const providerRepositoryId = "77";
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId,
        baseBranch: "main",
        generatedBranch: "rooms/subscription-room",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Subscription Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/subscription",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: launch.taskId, title: "Task" }),
        },
        NO_CHILDREN,
        MEMBER_AUTHORITY,
      );
      const emitted: unknown[] = [];
      const subscription = await distribution.subscribe(
        context(launch.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      expect(emitted).toEqual([
        expect.objectContaining({ type: "ready", cursor: expect.any(String) }),
        {
          type: "collaboration",
          collaboration: {
            control: { mode: "shared" },
            presenceCount: 1,
          },
        },
      ]);

      harness.hub.notifyThread("thr_zzzzzzzzzz", ["events-appended"]);
      expect(emitted).toHaveLength(2);
      const sequence =
        getLatestThreadSequence(harness.db, {
          threadId: provisioned.primaryThreadId,
        }) + 1;
      harness.db
        .insert(events)
        .values({
          id: createEventId(),
          threadId: provisioned.primaryThreadId,
          environmentId: provisioned.environmentId,
          scopeKind: "thread",
          turnId: null,
          providerThreadId: null,
          sequence,
          type: "system/error",
          itemId: null,
          itemKind: null,
          actorPrincipalId: null,
          actorKind: null,
          actorDisplayName: null,
          data: JSON.stringify({ message: "bounded test event" }),
          createdAt: Date.now(),
        })
        .run();
      harness.hub.notifyThread(provisioned.primaryThreadId, [
        "events-appended",
      ]);
      expect(emitted).toEqual([
        expect.objectContaining({ type: "ready" }),
        {
          type: "collaboration",
          collaboration: {
            control: { mode: "shared" },
            presenceCount: 1,
          },
        },
        { type: "changed", cursor: `s.${sequence}` },
      ]);

      subscription.close();
      harness.hub.notifyThread(provisioned.primaryThreadId, [
        "events-appended",
      ]);
      expect(emitted).toHaveLength(3);
    });
  });

  it("admits an active Room send once with the verified human actor and replays its receipt", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "79",
        baseBranch: "main",
        generatedBranch: "rooms/command-room",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Command Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/commands",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      const turnId = "turn_room_command";
      seedThreadRuntimeState(harness.deps, {
        environmentId: provisioned.environmentId,
        providerThreadId: "provider-room-command",
        threadId: provisioned.primaryThreadId,
      });
      seedTurnStarted(harness.deps, {
        environmentId: provisioned.environmentId,
        providerThreadId: "provider-room-command",
        threadId: provisioned.primaryThreadId,
        turnId,
      });
      harness.db
        .update(environments)
        .set({ path: "/tmp/room-command", status: "ready" })
        .where(eq(environments.id, provisioned.environmentId))
        .run();
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, provisioned.primaryThreadId))
        .run();
      let policyFacts = {
        role: "member" as "member" | "owner",
        isTaskAssignee: false,
      };
      const commandAuthority = {
        read: vi.fn(async () => ({ ...policyFacts })),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        commandAuthority,
      );
      const command = {
        kind: "message.send",
        requestId: "creq_23456789ab",
        text: "Queue this exact message",
        stream: PRIMARY_STREAM,
      } as const;

      const activeBootstrap = await distribution.bootstrap(
        context(launch.bindingId),
      );
      expect(activeBootstrap).toMatchObject({
        capabilities: ["message.send", "message.steer", "read.mark"],
        timeline: {
          activeTurnId: expect.stringMatching(/^turn_[A-Za-z0-9_-]{43}$/u),
          working: true,
        },
      });
      expect(JSON.stringify(activeBootstrap)).not.toContain(turnId);
      const publicTurnId = (
        activeBootstrap.timeline as { activeTurnId: string }
      ).activeTurnId;

      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "message.steer",
          requestId: "creq_23456789ag",
          expectedTurnId: turnId,
          text: "Reject a private turn identifier",
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      const accepted = await distribution.execute(
        context(launch.bindingId),
        command,
      );
      expect(accepted).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          requestId: command.requestId,
          commandKind: "message.send",
          admissionSequence: 1,
          result: { disposition: "queued" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(accepted.body.result).toEqual({ disposition: "queued" });
      expect(JSON.stringify(accepted.body)).not.toContain("qmsg_");
      const replayed = await distribution.execute(
        context(launch.bindingId),
        command,
      );
      expect(replayed).toMatchObject({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "already-accepted",
          requestId: command.requestId,
          admissionSequence: 1,
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: provisioned.primaryThreadId,
          requestId: command.requestId,
        }),
      ).toMatchObject({
        actor: {
          principalId: PRINCIPAL.id,
          principalKind: PRINCIPAL.kind,
          displayName: PRINCIPAL.displayName,
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "message.steer",
          requestId: "creq_23456789ad",
          expectedTurnId: publicTurnId,
          text: "Steer this exact turn",
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "message.steer",
          result: { disposition: "steered" },
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: provisioned.primaryThreadId,
          requestId: "creq_23456789ad",
        }),
      ).toMatchObject({
        result: { disposition: "steered", expectedTurnId: turnId },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "message.steer",
          requestId: "creq_23456789af",
          expectedTurnId: deriveWorkTogetherRoomPublicTurnId({
            bindingId: launch.bindingId,
            privateTurnId: turnId,
            publicStreamId: "wrong_child_stream",
          }),
          text: "Do not leak the active turn",
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toEqual({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          requestId: "creq_23456789af",
          commandKind: "message.steer",
          reason: "turn_mismatch",
          stream: PRIMARY_STREAM,
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          text: "Conflicting message",
        }),
      ).resolves.toEqual({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          requestId: command.requestId,
          commandKind: "message.send",
          reason: "request_identity_conflict",
          stream: PRIMARY_STREAM,
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "agent.interrupt",
          requestId: "creq_23456789ac",
          expectedTurnId: publicTurnId,
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: provisioned.primaryThreadId,
          requestId: "creq_23456789ac",
        }),
      ).toBeNull();
      policyFacts = { role: "owner", isTaskAssignee: false };
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "agent.interrupt",
          requestId: "creq_23456789ae",
          expectedTurnId: publicTurnId,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "agent.interrupt",
          result: { disposition: "interrupted" },
          stream: PRIMARY_STREAM,
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "agent.interrupt",
          requestId: "creq_23456789ae",
          expectedTurnId: publicTurnId,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "already-accepted",
          commandKind: "agent.interrupt",
          stream: PRIMARY_STREAM,
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "agent.interrupt",
          requestId: "creq_23456789ae",
          expectedTurnId: `turn_${"B".repeat(43)}`,
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          reason: "request_identity_conflict",
          commandKind: "agent.interrupt",
          stream: PRIMARY_STREAM,
        },
      });
      // Replay and identity-conflict paths resolve from the durable ledger
      // without re-reading current Room authority.
      expect(commandAuthority.read).toHaveBeenCalledTimes(6);

      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          actor: "user_spoofed",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "message.send",
          requestId: "creq_23456789ah",
          text: "V1 body without stream",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          stream: null,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          stream: { kind: "primary", extra: true },
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          stream: { kind: "subagent" },
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "thread.interrupt",
          requestId: "creq_23456789ai",
          expectedTurnId: publicTurnId,
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  it("publishes exact direct and nested Subagents while keeping each on its own authorized stream", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "177",
        baseBranch: "main",
        generatedBranch: "rooms/child-streams",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Child Stream Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/child-streams",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      const child = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: provisioned.primaryThreadId,
        title: "Direct worker",
      });
      const grandchild = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: child.id,
        status: "active",
        title: "Nested worker",
      });
      seedMessageTurn(harness.deps, {
        environmentId: provisioned.environmentId,
        firstTurn: true,
        requestId: 901,
        startSequence: 1,
        text: "Direct result",
        threadId: child.id,
        turnId: "turn_direct_result",
      });
      seedMessageTurn(harness.deps, {
        environmentId: provisioned.environmentId,
        requestId: 901,
        startSequence:
          getLatestThreadSequence(harness.db, {
            threadId: provisioned.primaryThreadId,
          }) + 1,
        text: "Direct result",
        threadId: provisioned.primaryThreadId,
        turnId: "turn_direct_result",
      });
      const grandchildTurnId = "turn_nested_question";
      seedTurnStarted(harness.deps, {
        environmentId: provisioned.environmentId,
        threadId: grandchild.id,
        turnId: grandchildTurnId,
      });
      const pendingQuestion =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: grandchild.id,
            turnId: grandchildTurnId,
            providerId: "codex",
            providerThreadId: "provider-nested-question",
            providerRequestId: "request-nested-question",
            payload: createUserQuestionPayload(),
          },
        });
      expect(pendingQuestion.outcome).toBe("created");
      const ids = new Map([
        [child.id, randomUUID()],
        [grandchild.id, randomUUID()],
      ]);
      const attached: WorkTogetherRoomChildAttachmentV1[] = [];
      const childAuthority: WorkTogetherRoomChildAttachmentPortV1 = {
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
      const commandAuthority = {
        read: vi.fn(async () =>
          Object.freeze({ role: "member" as const, isTaskAssignee: false }),
        ),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        childAuthority,
        commandAuthority,
      );

      const bootstrap = await distribution.bootstrap(context(launch.bindingId));
      expect(bootstrap).toMatchObject({ schemaVersion: 2 });
      expect(bootstrap.subagents).toEqual([
        {
          schemaVersion: 1,
          id: ids.get(child.id),
          parent: { kind: "primary", id: launch.bindingId },
          label: "Direct worker",
          summary: "Direct result — answered.",
          lifecycle: "completed",
          attention: { kind: "none" },
          capabilities: ["message.send"],
        },
        {
          schemaVersion: 1,
          id: ids.get(grandchild.id),
          parent: { kind: "subagent", id: ids.get(child.id) },
          label: "Nested worker",
          summary: null,
          lifecycle: "running",
          attention: { kind: "question" },
          capabilities: ["message.send", "message.steer", "interaction.answer"],
        },
      ]);
      expect(commandAuthority.read).toHaveBeenCalledTimes(1);
      expect(childAuthority.attach).toHaveBeenNthCalledWith(1, {
        bindingId: launch.bindingId,
        workspaceId: launch.workspaceId,
        parentThreadId: provisioned.primaryThreadId,
        childThreadId: child.id,
      });
      expect(childAuthority.attach).toHaveBeenNthCalledWith(2, {
        bindingId: launch.bindingId,
        workspaceId: launch.workspaceId,
        parentThreadId: child.id,
        childThreadId: grandchild.id,
      });
      const wire = JSON.stringify(bootstrap);
      expect(wire).not.toContain(child.id);
      expect(wire).not.toContain(grandchild.id);
      expect(wire).not.toContain(provisioned.environmentId);
      expect(wire).not.toContain(provisioned.projectId);
      expect(wire).not.toContain('"children"');

      const initialChildEvents = await distribution.events(
        context(launch.bindingId),
        {
          subagentId: ids.get(child.id)!,
          cursor: null,
        },
      );
      expect(initialChildEvents).toMatchObject({
        schemaVersion: 1,
        changed: true,
        timeline: { rows: expect.any(Array) },
      });
      const childEvents = await distribution.events(context(launch.bindingId), {
        subagentId: ids.get(child.id)!,
        cursor: "s.0",
      });
      expect(childEvents.timeline).toEqual(initialChildEvents.timeline);
      const childEventsWire = JSON.stringify(childEvents);
      expect(childEventsWire).not.toContain(child.id);
      expect(childEventsWire).not.toContain("turn_direct_result");
      const primaryRowIds = new Set(
        (bootstrap.timeline as { rows: Array<{ id: string }> }).rows.map(
          (row) => row.id,
        ),
      );
      const childRows = (
        initialChildEvents.timeline as { rows: Array<{ id: string }> }
      ).rows;
      expect(childRows.length).toBeGreaterThan(0);
      expect(childRows.every((row) => !primaryRowIds.has(row.id))).toBe(true);
      expect(
        deriveWorkTogetherRoomPublicTurnId({
          bindingId: launch.bindingId,
          privateTurnId: "turn_direct_result",
          publicStreamId: ids.get(child.id)!,
        }),
      ).not.toBe(
        deriveWorkTogetherRoomPublicTurnId({
          bindingId: launch.bindingId,
          privateTurnId: "turn_direct_result",
          publicStreamId: launch.bindingId,
        }),
      );
      const wrongAncestryAttachmentId = randomUUID();
      attached.push(
        Object.freeze({
          id: wrongAncestryAttachmentId,
          childThreadId: child.id,
          parentThreadId: grandchild.id,
        }),
      );
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: wrongAncestryAttachmentId,
          cursor: null,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(attached.pop()?.id).toBe(wrongAncestryAttachmentId);
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: randomUUID(),
          cursor: null,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      const otherPrimary = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
      });
      const crossRoomChild = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: otherPrimary.id,
      });
      const crossRoomAttachmentId = randomUUID();
      attached.push(
        Object.freeze({
          id: crossRoomAttachmentId,
          childThreadId: crossRoomChild.id,
          parentThreadId: otherPrimary.id,
        }),
      );
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: crossRoomAttachmentId,
          cursor: null,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      const emptySubagent = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: provisioned.primaryThreadId,
        title: "Created worker",
      });
      const emptySubagentId = randomUUID();
      attached.push(
        Object.freeze({
          id: emptySubagentId,
          childThreadId: emptySubagent.id,
          parentThreadId: provisioned.primaryThreadId,
        }),
      );
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: emptySubagentId,
          cursor: null,
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        cursor: "s.0",
        changed: true,
        timeline: {
          rows: [],
          working: false,
          activeTurnId: null,
          hasOlder: false,
          olderCursor: null,
        },
      });
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: emptySubagentId,
          cursor: "s.0",
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        cursor: "s.0",
        changed: false,
        timeline: null,
      });
      expect(attached.pop()?.id).toBe(emptySubagentId);
      harness.db
        .update(threads)
        .set({ deletedAt: Date.now() })
        .where(eq(threads.id, emptySubagent.id))
        .run();

      const emitted: unknown[] = [];
      const subscription = await distribution.subscribe(
        context(launch.bindingId),
        { subagentId: ids.get(child.id)!, cursor: null },
        (event) => emitted.push(event),
      );
      harness.hub.notifyThread(provisioned.primaryThreadId, [
        "events-appended",
      ]);
      expect(emitted).toHaveLength(1);
      const sequence =
        getLatestThreadSequence(harness.db, { threadId: child.id }) + 1;
      harness.db
        .insert(events)
        .values({
          id: createEventId(),
          threadId: child.id,
          environmentId: provisioned.environmentId,
          scopeKind: "thread",
          turnId: null,
          providerThreadId: null,
          sequence,
          type: "system/error",
          itemId: null,
          itemKind: null,
          actorPrincipalId: null,
          actorKind: null,
          actorDisplayName: null,
          data: JSON.stringify({ message: "child event" }),
          createdAt: Date.now(),
        })
        .run();
      harness.hub.notifyThread(child.id, ["events-appended"]);
      expect(emitted).toHaveLength(2);
      subscription.close();

      attached.push(
        Object.freeze({
          id: randomUUID(),
          childThreadId: "missing-orphan-thread",
          parentThreadId: "missing-parent-thread",
        }),
      );
      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).rejects.toMatchObject({ kind: "unavailable" });
      attached.splice(2);

      for (let index = 0; index < 63; index += 1) {
        attached.push(
          Object.freeze({
            id: randomUUID(),
            childThreadId: `missing-overflow-thread-${index}`,
            parentThreadId: provisioned.primaryThreadId,
          }),
        );
      }
      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).rejects.toMatchObject({ kind: "unavailable" });
      attached.splice(2);

      const unresolvedAttachmentId = randomUUID();
      attached.push(
        Object.freeze({
          id: unresolvedAttachmentId,
          childThreadId: "missing-local-thread",
          parentThreadId: provisioned.primaryThreadId,
        }),
      );
      const unresolvedBootstrap = await distribution.bootstrap(
        context(launch.bindingId),
      );
      expect(unresolvedBootstrap.subagents).toEqual([
        {
          schemaVersion: 1,
          id: ids.get(child.id),
          parent: { kind: "primary", id: launch.bindingId },
          label: "Direct worker",
          summary: "Direct result — answered.",
          lifecycle: "completed",
          attention: { kind: "none" },
          capabilities: ["message.send"],
        },
        {
          schemaVersion: 1,
          id: ids.get(grandchild.id),
          parent: { kind: "subagent", id: ids.get(child.id) },
          label: "Nested worker",
          summary: null,
          lifecycle: "running",
          attention: { kind: "question" },
          capabilities: ["message.send", "message.steer", "interaction.answer"],
        },
        {
          schemaVersion: 1,
          id: unresolvedAttachmentId,
          parent: { kind: "primary", id: launch.bindingId },
          label: "Untitled subagent",
          summary: null,
          lifecycle: "unavailable",
          attention: { kind: "none" },
          capabilities: [],
        },
      ]);
      attached.pop();

      const malformedTurnId = "turn_malformed_root_outcome";
      seedTurnStarted(harness.deps, {
        environmentId: provisioned.environmentId,
        threadId: child.id,
        turnId: malformedTurnId,
      });
      harness.db
        .insert(events)
        .values({
          id: createEventId(),
          threadId: child.id,
          environmentId: provisioned.environmentId,
          scopeKind: "turn",
          turnId: malformedTurnId,
          providerThreadId: "provider-malformed-root-outcome",
          sequence:
            getLatestThreadSequence(harness.db, { threadId: child.id }) + 1,
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
      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });

  it("fails closed for unknown bindings, future cursors, and S4.4 commands", async () => {
    await withTestHarness(async (harness) => {
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: "task" }),
        },
        NO_CHILDREN,
        MEMBER_AUTHORITY,
      );
      const missing = context(randomUUID());
      await expect(distribution.bootstrap(missing)).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      await expect(
        distribution.events(missing, {
          subagentId: null,
          cursor: "s.9999999999999999",
        }),
      ).rejects.toBeInstanceOf(RoomDistributionUnavailableError);
      await expect(
        distribution.execute(missing, { type: "send" }),
      ).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });

  it("rejects task projections that accidentally expose raw identity fields", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "88",
        baseBranch: "main",
        generatedBranch: "rooms/identity-fence",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolve: () => ({
          bbHostId: host.id,
          projectName: "Identity Fence Repository",
          providerId: "codex",
          sourcePath: "/srv/work-together/identity-fence",
        }),
      }).provision({ principal: PRINCIPAL, launch });
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({
            id: launch.taskId,
            assignee: { subject: "user_raw_identity" },
          }),
        },
        NO_CHILDREN,
        MEMBER_AUTHORITY,
      );
      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });

  it("projects shared control and unique primary presence without viewer identity", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "91",
        baseBranch: "main",
        generatedBranch: "rooms/collaboration",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Collaboration Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/collaboration",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      const child = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: provisioned.primaryThreadId,
        title: "Worker",
      });
      const subagentId = randomUUID();
      const childAttachments: WorkTogetherRoomChildAttachmentPortV1 = {
        attach: async () =>
          Object.freeze({
            id: subagentId,
            childThreadId: child.id,
            parentThreadId: provisioned.primaryThreadId,
          }),
        list: async () =>
          Object.freeze([
            {
              id: subagentId,
              childThreadId: child.id,
              parentThreadId: provisioned.primaryThreadId,
            },
          ]),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        childAttachments,
        MEMBER_AUTHORITY,
      );

      const emptyBootstrap = await distribution.bootstrap(
        context(launch.bindingId),
      );
      expect(emptyBootstrap.collaboration).toEqual({
        control: { mode: "shared" },
        presenceCount: 0,
      });
      const emptyWire = JSON.stringify(emptyBootstrap);
      expect(emptyWire).not.toContain(PRINCIPAL.id);
      expect(emptyWire).not.toContain(PRINCIPAL.displayName);
      expect(emptyWire).not.toMatch(/lease|controllerId|viewer/iu);

      const aliceEvents: unknown[] = [];
      const aliceA = await distribution.subscribe(
        context(launch.bindingId, PRINCIPAL),
        { subagentId: null, cursor: null },
        (event) => aliceEvents.push(event),
      );
      expect(aliceEvents).toContainEqual({
        type: "collaboration",
        collaboration: {
          control: { mode: "shared" },
          presenceCount: 1,
        },
      });

      const aliceBEvents: unknown[] = [];
      const aliceB = await distribution.subscribe(
        context(launch.bindingId, PRINCIPAL),
        { subagentId: null, cursor: null },
        (event) => aliceBEvents.push(event),
      );
      // Same principal, two sockets: still unique count 1.
      expect(aliceBEvents).toContainEqual({
        type: "collaboration",
        collaboration: {
          control: { mode: "shared" },
          presenceCount: 1,
        },
      });
      expect(
        (await distribution.bootstrap(context(launch.bindingId))).collaboration,
      ).toEqual({ control: { mode: "shared" }, presenceCount: 1 });

      const bobEvents: unknown[] = [];
      const bob = await distribution.subscribe(
        context(launch.bindingId, PRINCIPAL_B),
        { subagentId: null, cursor: null },
        (event) => bobEvents.push(event),
      );
      expect(bobEvents).toContainEqual({
        type: "collaboration",
        collaboration: {
          control: { mode: "shared" },
          presenceCount: 2,
        },
      });
      // Existing primary peers receive the updated count.
      expect(aliceEvents.at(-1)).toEqual({
        type: "collaboration",
        collaboration: {
          control: { mode: "shared" },
          presenceCount: 2,
        },
      });
      expect(
        (await distribution.bootstrap(context(launch.bindingId))).collaboration,
      ).toEqual({ control: { mode: "shared" }, presenceCount: 2 });

      const childEvents: unknown[] = [];
      const childSub = await distribution.subscribe(
        context(launch.bindingId, PRINCIPAL_B),
        { subagentId, cursor: null },
        (event) => childEvents.push(event),
      );
      expect(
        childEvents.every((event) => {
          return (
            typeof event === "object" &&
            event !== null &&
            (event as { type?: unknown }).type !== "collaboration"
          );
        }),
      ).toBe(true);
      expect(
        (await distribution.bootstrap(context(launch.bindingId))).collaboration,
      ).toEqual({ control: { mode: "shared" }, presenceCount: 2 });

      bob.close();
      bob.close(); // idempotent cleanup
      expect(aliceEvents.at(-1)).toEqual({
        type: "collaboration",
        collaboration: {
          control: { mode: "shared" },
          presenceCount: 1,
        },
      });
      expect(
        (await distribution.bootstrap(context(launch.bindingId))).collaboration,
      ).toEqual({ control: { mode: "shared" }, presenceCount: 1 });

      aliceA.close();
      aliceB.close();
      childSub.close();
      expect(
        (await distribution.bootstrap(context(launch.bindingId))).collaboration,
      ).toEqual({ control: { mode: "shared" }, presenceCount: 0 });

      for (const batch of [aliceEvents, aliceBEvents, bobEvents, childEvents]) {
        assertNoPrivateTimelineLeak(JSON.stringify(batch), {
          environmentId: provisioned.environmentId,
          principalIds: [PRINCIPAL.id, PRINCIPAL_B.id],
          primaryThreadId: provisioned.primaryThreadId,
          projectId: provisioned.projectId,
        });
      }
    });
  });

  it("exposes public older timeline pages through the same sanitizer", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "92",
        baseBranch: "main",
        generatedBranch: "rooms/older-pages",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Older Pages Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/older-pages",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      // Room latest window is 20 segments; 22 turns forces a public older cursor
      // even if provisioning already created one non-page segment anchor.
      const baseSequence =
        getLatestThreadSequence(harness.db, {
          threadId: provisioned.primaryThreadId,
        }) + 1;
      for (let turn = 1; turn <= 22; turn += 1) {
        seedMessageTurn(harness.deps, {
          environmentId: provisioned.environmentId,
          firstTurn: turn === 1 && baseSequence === 1,
          requestId: 200 + turn,
          startSequence: baseSequence + (turn - 1) * 5,
          text: `Turn message ${turn}`,
          threadId: provisioned.primaryThreadId,
          turnId: `turn-room-${turn}`,
        });
      }
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        NO_CHILDREN,
        MEMBER_AUTHORITY,
      );

      const anchors = listTimelineSegmentAnchorsDescending(harness.db, {
        threadId: provisioned.primaryThreadId,
        limit: 30,
      });
      expect(anchors.length).toBeGreaterThan(20);

      const bootstrap = await distribution.bootstrap(context(launch.bindingId));
      const liveCursor = bootstrap.cursor as string;
      const latestTimeline = bootstrap.timeline as {
        hasOlder: boolean;
        olderCursor: string | null;
        rows: Array<{ kind: string; text?: string }>;
        activeTurnId: string | null;
      };
      expect(latestTimeline.hasOlder).toBe(true);
      expect(latestTimeline.olderCursor).toMatch(/^p\.[1-9][0-9]*$/u);
      expect(JSON.stringify(bootstrap)).not.toContain("hasOlderRows");
      assertNoPrivateTimelineLeak(JSON.stringify(bootstrap), {
        environmentId: provisioned.environmentId,
        principalIds: [PRINCIPAL.id],
        primaryThreadId: provisioned.primaryThreadId,
        projectId: provisioned.projectId,
      });

      const events = await distribution.events(context(launch.bindingId), {
        subagentId: null,
        cursor: "s.0",
      });
      expect(events.cursor).toBe(liveCursor);
      expect(events.timeline).toMatchObject({
        hasOlder: true,
        olderCursor: latestTimeline.olderCursor,
      });

      const older = await distribution.timeline(context(launch.bindingId), {
        subagentId: null,
        before: latestTimeline.olderCursor!,
      });
      expect(older).toMatchObject({
        schemaVersion: 1,
        timeline: {
          hasOlder: expect.any(Boolean),
          activeTurnId: null,
          working: false,
        },
      });
      const olderTimeline = older.timeline as {
        hasOlder: boolean;
        olderCursor: string | null;
        rows: Array<{ kind: string; text?: string }>;
      };
      expect(
        olderTimeline.olderCursor === null ||
          /^p\.[1-9][0-9]*$/u.test(olderTimeline.olderCursor),
      ).toBe(true);
      expect(olderTimeline.hasOlder).toBe(olderTimeline.olderCursor !== null);
      // Older pages must not rewrite the live high-water cursor field.
      expect(older).not.toHaveProperty("cursor");
      expect(older).not.toHaveProperty("changed");
      const olderTexts = olderTimeline.rows
        .filter((row) => row.kind === "conversation" && row.text !== undefined)
        .map((row) => row.text as string);
      expect(olderTexts.some((text) => /Turn message \d+/u.test(text))).toBe(
        true,
      );
      // Latest window holds the newest turns; the older page must not.
      expect(
        olderTexts.some(
          (text) =>
            text.includes("Turn message 22") ||
            text.includes("Turn message 21"),
        ),
      ).toBe(false);
      assertNoPrivateTimelineLeak(JSON.stringify(older), {
        environmentId: provisioned.environmentId,
        principalIds: [PRINCIPAL.id],
        primaryThreadId: provisioned.primaryThreadId,
        projectId: provisioned.projectId,
      });

      // Live high-water remains unchanged after older reads.
      await expect(
        distribution.events(context(launch.bindingId), {
          subagentId: null,
          cursor: liveCursor,
        }),
      ).resolves.toMatchObject({
        changed: false,
        timeline: null,
        cursor: liveCursor,
      });

      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: null,
          before: "p.0",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: null,
          before: "s.1",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: null,
          before: "p.999999999",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: null,
          before: "not-a-cursor",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  it("pages Subagent older history on the current attachment stream", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const { host } = seedHostSession(harness.deps, { id: createHostId() });
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "204",
        baseBranch: "main",
        generatedBranch: "rooms/subagent-older-pages",
        candidateHostId,
        environmentTemplate: "managed-worktree" as const,
      };
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolve: () => ({
            bbHostId: host.id,
            projectName: "Subagent Older Pages Repository",
            providerId: "codex",
            sourcePath: "/srv/work-together/subagent-older-pages",
          }),
        },
      ).provision({ principal: PRINCIPAL, launch });
      const child = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: provisioned.primaryThreadId,
        title: "Older worker",
      });
      const grandchild = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: child.id,
        title: "Nested older worker",
      });
      const childBaseSequence =
        getLatestThreadSequence(harness.db, { threadId: child.id }) + 1;
      for (let turn = 1; turn <= 22; turn += 1) {
        seedMessageTurn(harness.deps, {
          environmentId: provisioned.environmentId,
          firstTurn: turn === 1 && childBaseSequence === 1,
          requestId: 300 + turn,
          startSequence: childBaseSequence + (turn - 1) * 5,
          text:
            turn === 1
              ? `Child older ${turn} ${child.id}`
              : `Child older ${turn}`,
          threadId: child.id,
          turnId: `turn_subagent_older_${turn}`,
        });
      }
      const primaryBaseSequence =
        getLatestThreadSequence(harness.db, {
          threadId: provisioned.primaryThreadId,
        }) + 1;
      seedMessageTurn(harness.deps, {
        environmentId: provisioned.environmentId,
        firstTurn: primaryBaseSequence === 1,
        requestId: 400,
        startSequence: primaryBaseSequence,
        text: "Primary overlap probe",
        threadId: provisioned.primaryThreadId,
        turnId: "turn_subagent_older_1",
      });
      const subagentId = randomUUID();
      const nestedId = randomUUID();
      const attached: WorkTogetherRoomChildAttachmentV1[] = [
        Object.freeze({
          id: subagentId,
          childThreadId: child.id,
          parentThreadId: provisioned.primaryThreadId,
        }),
        Object.freeze({
          id: nestedId,
          childThreadId: grandchild.id,
          parentThreadId: child.id,
        }),
      ];
      const childAuthority: WorkTogetherRoomChildAttachmentPortV1 = {
        attach: vi.fn(async () => {
          throw new Error("older reads must not reconcile attachments");
        }),
        list: vi.fn(async () => Object.freeze([...attached])),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        childAuthority,
        MEMBER_AUTHORITY,
      );

      const latest = await distribution.events(context(launch.bindingId), {
        subagentId,
        cursor: null,
      });
      const latestTimeline = latest.timeline as {
        hasOlder: boolean;
        olderCursor: string | null;
        rows: Array<{ id: string; kind: string; text?: string }>;
        activeTurnId: string | null;
      };
      expect(latestTimeline.hasOlder).toBe(true);
      expect(latestTimeline.olderCursor).toMatch(/^p\.[1-9][0-9]*$/u);
      const latestRowIds = latestTimeline.rows.map((row) => row.id);
      expect(latestRowIds.length).toBeGreaterThan(0);
      expect(childAuthority.list).toHaveBeenCalledTimes(1);

      const older = await distribution.timeline(context(launch.bindingId), {
        subagentId,
        before: latestTimeline.olderCursor!,
      });
      expect(childAuthority.list).toHaveBeenCalledTimes(2);
      expect(older).toMatchObject({
        schemaVersion: 1,
        timeline: {
          hasOlder: expect.any(Boolean),
          activeTurnId: null,
          working: false,
        },
      });
      expect(older).not.toHaveProperty("cursor");
      expect(older).not.toHaveProperty("changed");
      const olderTimeline = older.timeline as {
        hasOlder: boolean;
        olderCursor: string | null;
        rows: Array<{ id: string; kind: string; text?: string }>;
      };
      const olderRowIds = olderTimeline.rows.map((row) => row.id);
      expect(olderRowIds.length).toBeGreaterThan(0);
      expect(olderRowIds.some((id) => latestRowIds.includes(id))).toBe(false);
      const olderTexts = olderTimeline.rows
        .filter((row) => row.kind === "conversation" && row.text !== undefined)
        .map((row) => row.text as string);
      expect(olderTexts.some((text) => text.includes(subagentId))).toBe(true);
      expect(
        olderTexts.some(
          (text) =>
            text.includes("Child older 22") || text.includes("Child older 21"),
        ),
      ).toBe(false);
      const olderWire = JSON.stringify(older);
      expect(olderWire).not.toContain(child.id);
      expect(olderWire).not.toContain(grandchild.id);
      expect(olderWire).not.toContain("turn_subagent_older_");
      expect(olderWire).not.toContain("work-together-room-older-page");
      assertNoPrivateTimelineLeak(olderWire, {
        environmentId: provisioned.environmentId,
        principalIds: [PRINCIPAL.id],
        primaryThreadId: provisioned.primaryThreadId,
        projectId: provisioned.projectId,
      });
      const primaryLatest = await distribution.events(
        context(launch.bindingId),
        { subagentId: null, cursor: null },
      );
      const primaryRowIds = (
        primaryLatest.timeline as { rows: Array<{ id: string }> }
      ).rows.map((row) => row.id);
      expect(olderRowIds.some((id) => primaryRowIds.includes(id))).toBe(false);
      expect(
        deriveWorkTogetherRoomPublicTurnId({
          bindingId: launch.bindingId,
          privateTurnId: "turn_subagent_older_1",
          publicStreamId: subagentId,
        }),
      ).not.toBe(
        deriveWorkTogetherRoomPublicTurnId({
          bindingId: launch.bindingId,
          privateTurnId: "turn_subagent_older_1",
          publicStreamId: launch.bindingId,
        }),
      );

      seedMessageTurn(harness.deps, {
        environmentId: provisioned.environmentId,
        requestId: 323,
        startSequence:
          getLatestThreadSequence(harness.db, { threadId: child.id }) + 1,
        text: "Child older 23",
        threadId: child.id,
        turnId: "turn_subagent_older_23",
      });
      const olderAfterTail = await distribution.timeline(
        context(launch.bindingId),
        { subagentId, before: latestTimeline.olderCursor! },
      );
      expect(childAuthority.list).toHaveBeenCalledTimes(3);
      const olderAfterTailTimeline = olderAfterTail.timeline as {
        rows: Array<{ id: string; kind: string; text?: string }>;
      };
      expect(olderAfterTailTimeline.rows.map((row) => row.id)).toEqual(
        olderRowIds,
      );
      expect(
        olderAfterTailTimeline.rows.some((row) =>
          latestRowIds.includes(row.id),
        ),
      ).toBe(false);
      expect(
        olderAfterTailTimeline.rows.some(
          (row) => row.kind === "conversation" && row.text === "Child older 23",
        ),
      ).toBe(false);

      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId,
          before: "p.999999999",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId,
          before: "s.1",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: randomUUID(),
          before: latestTimeline.olderCursor!,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      const wrongAncestryAttachmentId = randomUUID();
      attached.push(
        Object.freeze({
          id: wrongAncestryAttachmentId,
          childThreadId: child.id,
          parentThreadId: grandchild.id,
        }),
      );
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: wrongAncestryAttachmentId,
          before: latestTimeline.olderCursor!,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(attached.pop()?.id).toBe(wrongAncestryAttachmentId);

      const otherPrimary = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
      });
      const crossRoomChild = seedThread(harness.deps, {
        projectId: provisioned.projectId,
        environmentId: provisioned.environmentId,
        parentThreadId: otherPrimary.id,
      });
      const crossRoomAttachmentId = randomUUID();
      attached.push(
        Object.freeze({
          id: crossRoomAttachmentId,
          childThreadId: crossRoomChild.id,
          parentThreadId: otherPrimary.id,
        }),
      );
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId: crossRoomAttachmentId,
          before: latestTimeline.olderCursor!,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(attached.pop()?.id).toBe(crossRoomAttachmentId);

      attached[0] = Object.freeze({
        id: subagentId,
        childThreadId: child.id,
        parentThreadId: grandchild.id,
      });
      await expect(
        distribution.timeline(context(launch.bindingId), {
          subagentId,
          before: latestTimeline.olderCursor!,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });
});
