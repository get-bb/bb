import { randomUUID } from "node:crypto";

import {
  createHostId,
  getWorkTogetherRoomResourceReservation,
  listEvents,
  listProjects,
  listThreads,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  createWorkTogetherRoomResourceProvisioner,
  WorkTogetherRoomProvisioningConflictError,
  WorkTogetherRoomProvisioningUnavailableError,
  type WorkTogetherRoomResourceRegistry,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import {
  requireManagedWorktreeEnvironmentProvisionLiveCommand,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const PRINCIPAL = Object.freeze({
  id: "user_room_owner",
  kind: "human" as const,
  displayName: "Room Owner",
});

function registryFor(
  candidateHostId: string,
  providerRepositoryId: string,
  target: WorkTogetherRoomResourceTarget | null,
): WorkTogetherRoomResourceRegistry {
  return {
    resolve(input) {
      return input.candidateHostId === candidateHostId &&
        input.providerRepositoryId === providerRepositoryId
        ? target
        : null;
    },
  };
}

function launch(candidateHostId: string, providerRepositoryId: string) {
  return {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId,
    baseBranch: "main",
    generatedBranch: "rooms/exact-room-branch",
    candidateHostId,
    environmentTemplate: "managed-worktree" as const,
  };
}

describe("Work Together Room resource provisioner", () => {
  it("creates and replays exact reserved project, environment, thread and branch", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const providerRepositoryId = "42";
      const { host } = seedHostSession(harness.deps, {
        id: createHostId(),
      });
      const target = {
        bbHostId: host.id,
        projectName: "WT Room Repository",
        providerId: "codex",
        sourcePath: "/srv/work-together/repository",
      } satisfies WorkTogetherRoomResourceTarget;
      const provisioner = createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        registryFor(candidateHostId, providerRepositoryId, target),
      );
      const exactLaunch = launch(candidateHostId, providerRepositoryId);
      const projectCountBefore = listProjects(harness.db).length;

      const first = await provisioner.provision({
        principal: PRINCIPAL,
        launch: exactLaunch,
      });
      expect(first).toMatchObject({
        bindingId: exactLaunch.bindingId,
        state: "provisioning",
        failureReason: null,
      });
      expect(
        listEvents(harness.db, { threadId: first.primaryThreadId }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorDisplayName: PRINCIPAL.displayName,
            actorKind: PRINCIPAL.kind,
            actorPrincipalId: PRINCIPAL.id,
          }),
        ]),
      );
      const reservation = getWorkTogetherRoomResourceReservation(
        harness.db,
        exactLaunch.bindingId,
      );
      expect(first).toMatchObject({
        projectId: reservation?.projectId,
        environmentId: reservation?.environmentId,
        primaryThreadId: reservation?.primaryThreadId,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "environment.provision",
      );
      const managed =
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued);
      expect(managed.command).toMatchObject({
        branchName: exactLaunch.generatedBranch,
        environmentId: first.environmentId,
        sourcePath: target.sourcePath,
      });

      const replay = await provisioner.provision({
        principal: PRINCIPAL,
        launch: exactLaunch,
      });
      expect(replay).toEqual(first);
      expect(listProjects(harness.db)).toHaveLength(projectCountBefore + 1);
      expect(
        listThreads(harness.db, {
          includeHidden: true,
          projectId: first.projectId,
        }),
      ).toHaveLength(1);
    });
  });

  it("fails before reservation when no operator registry target exists", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const providerRepositoryId = "77";
      const exactLaunch = launch(candidateHostId, providerRepositoryId);
      const provisioner = createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        registryFor(candidateHostId, providerRepositoryId, null),
      );

      await expect(
        provisioner.provision({
          principal: PRINCIPAL,
          launch: exactLaunch,
        }),
      ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningUnavailableError);
      expect(
        getWorkTogetherRoomResourceReservation(
          harness.db,
          exactLaunch.bindingId,
        ),
      ).toBeNull();
    });
  });

  it("refuses changed operator source facts without duplicating resources", async () => {
    await withTestHarness(async (harness) => {
      const candidateHostId = randomUUID();
      const providerRepositoryId = "99";
      const { host } = seedHostSession(harness.deps, {
        id: createHostId(),
      });
      const exactLaunch = launch(candidateHostId, providerRepositoryId);
      const originalTarget = {
        bbHostId: host.id,
        projectName: "Stable Room Repository",
        providerId: "codex",
        sourcePath: "/srv/work-together/stable",
      } satisfies WorkTogetherRoomResourceTarget;
      const original = createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        registryFor(candidateHostId, providerRepositoryId, originalTarget),
      );
      const projectCountBefore = listProjects(harness.db).length;
      await original.provision({
        principal: PRINCIPAL,
        launch: exactLaunch,
      });

      const changed = createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        registryFor(candidateHostId, providerRepositoryId, {
          ...originalTarget,
          sourcePath: "/srv/work-together/changed",
        }),
      );
      await expect(
        changed.provision({
          principal: PRINCIPAL,
          launch: exactLaunch,
        }),
      ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningConflictError);
      expect(listProjects(harness.db)).toHaveLength(projectCountBefore + 1);
    });
  });
});
