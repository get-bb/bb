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
import type { Principal } from "@bb/domain";
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
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import {
  seedHostSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_room_reader",
  kind: "human",
  displayName: "Room Reader",
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

function context(bindingId: string): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal: PRINCIPAL,
    authorize: async () => ({ allowed: true as const }),
  });
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
        schemaVersion: 1,
        binding: { id: launch.bindingId, state: "active" },
        cell: { connection: "ready" },
        task: { id: launch.taskId, title: "Canonical task" },
        repository: {
          bindingId: launch.repositoryBindingId,
          bindingVersion: 3,
          generatedBranch: launch.generatedBranch,
        },
        capabilities: [],
      });
      const ownerDistribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        taskProjection,
        NO_CHILDREN,
        { read: async () => ({ role: "owner", isTaskAssignee: false }) },
      );
      await expect(
        ownerDistribution.bootstrap(context(launch.bindingId)),
      ).resolves.toMatchObject({ capabilities: ["thread.interrupt"] });
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
        childAttachmentId: null,
        cursor: "s.0",
      });
      expect(first.changed).toBe(true);
      const cursor = first.cursor as string;
      await expect(
        distribution.events(context(launch.bindingId), {
          childAttachmentId: null,
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
        { childAttachmentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      expect(emitted).toEqual([
        expect.objectContaining({ type: "ready", cursor: expect.any(String) }),
      ]);

      harness.hub.notifyThread("thr_zzzzzzzzzz", ["events-appended"]);
      expect(emitted).toHaveLength(1);
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
        { type: "changed", cursor: `s.${sequence}` },
      ]);

      subscription.close();
      harness.hub.notifyThread(provisioned.primaryThreadId, [
        "events-appended",
      ]);
      expect(emitted).toHaveLength(2);
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
      } as const;

      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).resolves.toMatchObject({
        capabilities: ["message.send", "message.steer"],
      });

      const accepted = await distribution.execute(
        context(launch.bindingId),
        command,
      );
      expect(accepted).toMatchObject({
        status: 202,
        body: {
          outcome: "accepted",
          requestId: command.requestId,
          commandKind: "message.send",
          admissionSequence: 1,
          result: { disposition: "queued" },
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
          outcome: "already-accepted",
          requestId: command.requestId,
          admissionSequence: 1,
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
          expectedTurnId: turnId,
          text: "Steer this exact turn",
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          outcome: "accepted",
          commandKind: "message.steer",
          result: { disposition: "steered" },
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "message.steer",
          requestId: "creq_23456789af",
          expectedTurnId: "turn_wrong",
          text: "Do not leak the active turn",
        }),
      ).resolves.toEqual({
        status: 200,
        body: {
          schemaVersion: 1,
          outcome: "rejected",
          requestId: "creq_23456789af",
          commandKind: "message.steer",
          reason: "turn_mismatch",
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
          schemaVersion: 1,
          outcome: "rejected",
          requestId: command.requestId,
          commandKind: "message.send",
          reason: "request_identity_conflict",
        },
      });
      await expect(
        distribution.execute(context(launch.bindingId), {
          kind: "thread.interrupt",
          requestId: "creq_23456789ac",
          expectedTurnId: "turn_exact",
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
          kind: "thread.interrupt",
          requestId: "creq_23456789ae",
          expectedTurnId: turnId,
        }),
      ).resolves.toMatchObject({
        status: 202,
        body: {
          outcome: "accepted",
          commandKind: "thread.interrupt",
          result: { disposition: "interrupted" },
        },
      });
      expect(commandAuthority.read).toHaveBeenCalledTimes(8);

      await expect(
        distribution.execute(context(launch.bindingId), {
          ...command,
          actor: "user_spoofed",
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  it("reconciles opaque child attachments and keeps each child on its own authorized stream", async () => {
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
        title: "Nested worker",
      });
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
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ id: launch.taskId, title: "Task" }) },
        childAuthority,
        MEMBER_AUTHORITY,
      );

      const bootstrap = await distribution.bootstrap(context(launch.bindingId));
      expect(bootstrap.children).toEqual([
        expect.objectContaining({
          id: ids.get(child.id),
          parentId: null,
          stream: { child: ids.get(child.id) },
        }),
        expect.objectContaining({
          id: ids.get(grandchild.id),
          parentId: ids.get(child.id),
          stream: { child: ids.get(grandchild.id) },
        }),
      ]);
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

      const childEvents = await distribution.events(context(launch.bindingId), {
        childAttachmentId: ids.get(child.id)!,
        cursor: "s.0",
      });
      expect(JSON.stringify(childEvents)).not.toContain(child.id);
      await expect(
        distribution.events(context(launch.bindingId), {
          childAttachmentId: randomUUID(),
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
          childAttachmentId: crossRoomAttachmentId,
          cursor: null,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      const emitted: unknown[] = [];
      const subscription = await distribution.subscribe(
        context(launch.bindingId),
        { childAttachmentId: ids.get(child.id)!, cursor: null },
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
          childAttachmentId: null,
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
});
