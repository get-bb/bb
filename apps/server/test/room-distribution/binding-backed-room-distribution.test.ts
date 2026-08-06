import { randomUUID } from "node:crypto";

import {
  createEventId,
  createHostId,
  events,
  getLatestThreadSequence,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createBindingBackedRoomDistributionV1,
  type WorkTogetherRoomTaskProjectionPortV1,
} from "../../src/room-distribution/binding-backed-room-distribution.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
} from "../../src/room-distribution/room-distribution-port.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_room_reader",
  kind: "human",
  displayName: "Room Reader",
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

      const first = await distribution.events(context(launch.bindingId), "s.0");
      expect(first.changed).toBe(true);
      const cursor = first.cursor as string;
      await expect(
        distribution.events(context(launch.bindingId), cursor),
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
      const distribution = createBindingBackedRoomDistributionV1(harness.deps, {
        read: async () => ({ id: launch.taskId, title: "Task" }),
      });
      const emitted: unknown[] = [];
      const subscription = await distribution.subscribe(
        context(launch.bindingId),
        null,
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

  it("fails closed for unknown bindings, future cursors, and S4.4 commands", async () => {
    await withTestHarness(async (harness) => {
      const distribution = createBindingBackedRoomDistributionV1(harness.deps, {
        read: async () => ({ id: "task" }),
      });
      const missing = context(randomUUID());
      await expect(distribution.bootstrap(missing)).rejects.toMatchObject({
        name: RoomDistributionUnavailableError.name,
        kind: "not_found",
      });
      await expect(
        distribution.events(missing, "s.9999999999999999"),
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
      const distribution = createBindingBackedRoomDistributionV1(harness.deps, {
        read: async () => ({
          id: launch.taskId,
          assignee: { subject: "user_raw_identity" },
        }),
      });
      await expect(
        distribution.bootstrap(context(launch.bindingId)),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
  });
});
