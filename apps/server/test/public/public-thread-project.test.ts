import {
  archiveThread,
  createThreadSection,
  getEnvironmentProvisionRequest,
  getEnvironment,
  getThread,
  getThreadExecutionOverride,
  markThreadDeleted,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { acquireThreadOperation } from "../../src/services/threads/thread-operation-lock.js";
import { resumeManagedWorkspaceProvisioning } from "../../src/services/threads/thread-project.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { listQueuedEnvironmentCommands } from "../helpers/commands.js";

async function patchThreadProject(
  harness: TestAppHarness,
  threadId: string,
  projectId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...extra }),
  });
}

describe("public thread project updates", () => {
  it("moves a root thread and its child hierarchy together", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-hierarchy",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Target Project",
        path: "/tmp/project-move-target",
      });
      const root = seedThread(harness.deps, {
        projectId: sourceProject.id,
        environmentId: null,
      });
      const child = seedThread(harness.deps, {
        parentThreadId: root.id,
        projectId: sourceProject.id,
        environmentId: null,
      });

      const response = await patchThreadProject(
        harness,
        root.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      expect(getThread(harness.db, root.id)?.projectId).toBe(targetProject.id);
      expect(getThread(harness.db, child.id)?.projectId).toBe(targetProject.id);
    });
  });

  it("transfers an exclusive unmanaged workspace with its thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-workspace",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-workspace-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Workspace Target",
        path: "/tmp/project-move-workspace-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/unmanaged-project-move",
        projectId: sourceProject.id,
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        targetProject.id,
      );
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        environment.id,
      );
      expect(getEnvironment(harness.db, environment.id)?.projectId).toBe(
        targetProject.id,
      );
    });
  });

  it("rejects a move while the thread is active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-active",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-active-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Active Target",
        path: "/tmp/project-move-active-target",
      });
      const thread = seedThread(harness.deps, {
        projectId: sourceProject.id,
        status: "active",
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      const body = await readJson(response);
      expect(body).toMatchObject({ code: "invalid_request" });
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("rejects moving a workspace-less project thread into personal", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-workspace-less-personal",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Workspace-less Source",
        path: "/tmp/project-move-workspace-less-source",
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        PERSONAL_PROJECT_ID,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("rejects moving a child without changing its project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-child",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-child-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Child Target",
        path: "/tmp/project-move-child-target",
      });
      const root = seedThread(harness.deps, {
        projectId: sourceProject.id,
        environmentId: null,
      });
      const child = seedThread(harness.deps, {
        parentThreadId: root.id,
        projectId: sourceProject.id,
        environmentId: null,
      });

      const response = await patchThreadProject(
        harness,
        child.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, child.id)?.projectId).toBe(sourceProject.id);
    });
  });

  it("rejects a root move when a child is still active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-active-child",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-active-child-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Active Child Target",
        path: "/tmp/project-move-active-child-target",
      });
      const root = seedThread(harness.deps, {
        projectId: sourceProject.id,
        environmentId: null,
      });
      seedThread(harness.deps, {
        parentThreadId: root.id,
        projectId: sourceProject.id,
        environmentId: null,
        status: "active",
      });

      const response = await patchThreadProject(
        harness,
        root.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, root.id)?.projectId).toBe(sourceProject.id);
    });
  });

  it("rejects a managed workspace move when the destination has no source", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-missing-source",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-missing-source",
      });
      const { host: otherHost } = seedHostSession(harness.deps, {
        id: "host-project-move-missing-source-target",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        name: "No Source Target",
        path: "/tmp/project-move-no-source-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-managed",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("moves root metadata with the hierarchy while leaving child metadata unchanged", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-metadata",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-metadata-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Metadata Target",
        path: "/tmp/project-move-metadata-target",
      });
      const sectionResult = createThreadSection(harness.db, harness.hub, {
        name: "Moved section",
      });
      if (sectionResult.status !== "created") {
        throw new Error("Expected a new thread section");
      }
      const root = seedThread(harness.deps, {
        projectId: sourceProject.id,
        title: "Original root",
        environmentId: null,
      });
      const child = seedThread(harness.deps, {
        parentThreadId: root.id,
        projectId: sourceProject.id,
        title: "Original child",
        environmentId: null,
      });

      const response = await patchThreadProject(
        harness,
        root.id,
        targetProject.id,
        {
          title: "Moved root",
          sectionId: sectionResult.section.id,
          visibility: "hidden",
        },
      );

      expect(response.status, await response.text()).toBe(200);
      expect(getThread(harness.db, root.id)).toMatchObject({
        projectId: targetProject.id,
        title: "Moved root",
        sectionId: sectionResult.section.id,
        visibility: "hidden",
      });
      expect(getThread(harness.db, child.id)).toMatchObject({
        projectId: targetProject.id,
        title: "Original child",
        sectionId: null,
        visibility: "visible",
      });
    });
  });

  it("reuses a compatible destination workspace at the same path", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-same-path-compatible",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-same-path-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Same Path Target",
        path: "/tmp/project-move-same-path-target",
      });
      const sourceEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/shared-project-move-path",
        workspaceProvisionType: "unmanaged",
      });
      const targetEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: targetProject.id,
        path: "/tmp/shared-project-move-path",
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        environmentId: sourceEnvironment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        targetEnvironment.id,
      );
      expect(getEnvironment(harness.db, sourceEnvironment.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("rejects an incompatible destination workspace at the same path", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-same-path-incompatible",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-same-path-incompatible-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Incompatible Target",
        path: "/tmp/project-move-same-path-incompatible-target",
      });
      const sourceEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/incompatible-project-move-path",
        workspaceProvisionType: "unmanaged",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: targetProject.id,
        path: "/tmp/incompatible-project-move-path",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        environmentId: sourceEnvironment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        sourceEnvironment.id,
      );
    });
  });

  it("rejects attaching a project move to a managed path owned by another project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-foreign-managed-path",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-foreign-path-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Foreign Path Target",
        path: "/tmp/project-move-foreign-path-target",
      });
      const { project: ownerProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Foreign Path Owner",
        path: "/tmp/project-move-foreign-path-owner",
      });
      const sourceEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-foreign-managed-workspace",
        workspaceProvisionType: "unmanaged",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: ownerProject.id,
        path: "/tmp/project-move-foreign-managed-workspace",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        environmentId: sourceEnvironment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        projectId: sourceProject.id,
        environmentId: sourceEnvironment.id,
      });
      expect(getEnvironment(harness.db, sourceEnvironment.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("clones an unmanaged workspace shared with a live external thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-shared-unmanaged",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-shared-unmanaged-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Shared Unmanaged Target",
        path: "/tmp/project-move-shared-unmanaged-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/shared-unmanaged-project-move",
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });
      const external = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      const movedEnvironmentId = getThread(
        harness.db,
        thread.id,
      )?.environmentId;
      expect(response.status, await response.text()).toBe(200);
      expect(movedEnvironmentId).not.toBe(environment.id);
      expect(getThread(harness.db, external.id)?.environmentId).toBe(
        environment.id,
      );
      expect(getEnvironment(harness.db, environment.id)?.projectId).toBe(
        sourceProject.id,
      );
      expect(
        getEnvironment(harness.db, movedEnvironmentId ?? "")?.projectId,
      ).toBe(targetProject.id);
    });
  });

  it("rejects moving a thread with a project workspace into personal", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-personal-target",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-personal-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-personal-workspace",
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        PERSONAL_PROJECT_ID,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("rejects moving a personal workspace thread into the personal project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-personal-workspace",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-personal-workspace-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: "/tmp/personal-project-move-workspace",
        workspaceProvisionType: "personal",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        PERSONAL_PROJECT_ID,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        projectId: sourceProject.id,
        environmentId: environment.id,
      });
      expect(getEnvironment(harness.db, environment.id)?.projectId).toBe(
        PERSONAL_PROJECT_ID,
      );
    });
  });

  it("provisions a managed worktree when moving a personal thread into a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-personal-to-project",
      });
      const { project: targetProject, source } = seedProjectWithSource(
        harness.deps,
        {
          hostId: host.id,
          name: "Personal Thread Target",
          path: "/tmp/project-move-personal-to-project-target",
        },
      );
      const personalEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: "/tmp/project-move-personal-to-project-workspace",
        isGitRepo: false,
        isWorktree: false,
        managed: true,
        workspaceProvisionType: "personal",
      });
      const thread = seedThread(harness.deps, {
        environmentId: personalEnvironment.id,
        projectId: PERSONAL_PROJECT_ID,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      const movedThread = getThread(harness.db, thread.id);
      expect(movedThread?.projectId).toBe(targetProject.id);
      expect(movedThread?.environmentId).not.toBe(personalEnvironment.id);

      const movedEnvironment = getEnvironment(
        harness.db,
        movedThread?.environmentId ?? "",
      );
      expect(movedEnvironment).toMatchObject({
        hostId: host.id,
        managed: true,
        path: null,
        projectId: targetProject.id,
        status: "provisioning",
        workspaceProvisionType: "managed-worktree",
      });
      const durableProvisionRequest = getEnvironmentProvisionRequest(
        harness.db,
        movedEnvironment?.id ?? "",
      );
      expect(durableProvisionRequest?.requestJson).toContain(
        movedEnvironment?.id ?? "",
      );
      expect(durableProvisionRequest?.requestJson).toContain(source.path);
      expect(getEnvironment(harness.db, personalEnvironment.id)).toMatchObject({
        path: "/tmp/project-move-personal-to-project-workspace",
        projectId: PERSONAL_PROJECT_ID,
        status: "destroying",
        workspaceProvisionType: "personal",
      });

      await expect(
        resumeManagedWorkspaceProvisioning(harness.deps, {
          environmentId: movedEnvironment?.id ?? "",
        }),
      ).resolves.toBe(true);

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      const provisionCommands = listQueuedEnvironmentCommands(
        harness,
        "environment.provision",
        movedEnvironment?.id ?? "",
      );
      expect(provisionCommands).toHaveLength(1);
      expect(provisionCommands[0]).toMatchObject({
        baseBranch: null,
        environmentId: movedEnvironment?.id,
        initiator: { threadId: thread.id },
        sourcePath: source.path,
        workspaceProvisionType: "managed-worktree",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          personalEnvironment.id,
        ),
      ).toHaveLength(1);
    });
  });

  it("does not persist an execution override when the project move is rejected", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-move-override-atomic",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-override-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Override Target",
        path: "/tmp/project-move-override-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
        providerId: "claude-code",
        status: "active",
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [
              {
                id: "claude-opus-4-8",
                model: "claude-opus-4-8",
                displayName: "Opus 4.8",
                description: "",
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "" },
                ],
                defaultReasoningEffort: "medium",
                isDefault: true,
              },
            ],
            selectedOnlyModels: [],
          },
        },
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
        { model: "claude-opus-4-8" },
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    });
  });

  it("does not transfer a workspace with archived or deleted associations", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-stale-owners",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-stale-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Stale Owner Target",
        path: "/tmp/project-move-stale-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-stale-workspace",
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });
      const archived = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });
      const deleted = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });
      archiveThread(harness.db, harness.hub, archived.id);
      markThreadDeleted(harness.db, harness.hub, { threadId: deleted.id });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      const movedEnvironmentId = getThread(
        harness.db,
        thread.id,
      )?.environmentId;
      expect(movedEnvironmentId).not.toBe(environment.id);
      expect(movedEnvironmentId).not.toBeNull();
      expect(
        getEnvironment(harness.db, movedEnvironmentId ?? "")?.projectId,
      ).toBe(targetProject.id);
      expect(getEnvironment(harness.db, environment.id)?.projectId).toBe(
        sourceProject.id,
      );
      expect(getThread(harness.db, archived.id)?.environmentId).toBe(
        environment.id,
      );
      expect(getThread(harness.db, deleted.id)?.environmentId).toBe(
        environment.id,
      );
    });
  });

  it("rejects moving one thread out of a shared managed workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-shared-managed",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-shared-managed-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Shared Managed Target",
        path: "/tmp/project-move-shared-managed-target",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-shared-managed-workspace",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(
        sourceProject.id,
      );
      expect(getEnvironment(harness.db, environment.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });

  it("rejects a project move while a send holds the thread operation", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-operation-lock",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-lock-source",
      });
      const { project: targetProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Operation Lock Target",
        path: "/tmp/project-move-lock-target",
      });
      const thread = seedThread(harness.deps, {
        projectId: sourceProject.id,
        environmentId: null,
      });
      const release = await acquireThreadOperation(thread.id);

      try {
        const response = await patchThreadProject(
          harness,
          thread.id,
          targetProject.id,
        );
        expect(response.status).toBe(409);
        expect(getThread(harness.db, thread.id)?.projectId).toBe(
          sourceProject.id,
        );
      } finally {
        release();
      }
    });
  });

  it("provisions a new managed workspace when project roots differ", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-move-managed-different-root",
      });
      const { project: sourceProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-move-managed-source-root",
      });
      const { project: targetProject, source: targetSource } =
        seedProjectWithSource(harness.deps, {
          hostId: host.id,
          name: "Managed Different Root Target",
          path: "/tmp/project-move-managed-target-root",
        });
      const sourceEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: sourceProject.id,
        path: "/tmp/project-move-managed-source-worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        environmentId: sourceEnvironment.id,
        projectId: sourceProject.id,
      });

      const response = await patchThreadProject(
        harness,
        thread.id,
        targetProject.id,
      );

      expect(response.status, await response.text()).toBe(200);
      const movedThread = getThread(harness.db, thread.id);
      expect(movedThread?.projectId).toBe(targetProject.id);
      expect(movedThread?.environmentId).not.toBe(sourceEnvironment.id);
      const movedEnvironment = getEnvironment(
        harness.db,
        movedThread?.environmentId ?? "",
      );
      expect(movedEnvironment).toMatchObject({
        managed: true,
        path: null,
        projectId: targetProject.id,
        status: "provisioning",
        workspaceProvisionType: "managed-worktree",
      });
      expect(
        getEnvironmentProvisionRequest(harness.db, movedEnvironment?.id ?? "")
          ?.requestJson,
      ).toContain(targetSource.path);
      expect(getEnvironment(harness.db, sourceEnvironment.id)?.projectId).toBe(
        sourceProject.id,
      );
    });
  });
});
