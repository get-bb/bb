import { countProjectSources, getProject, setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function cloneSourceRequest(args: {
  hostId: string;
  projectId: string;
  remoteUrl?: string;
  targetPath?: string;
}) {
  return new Request(
    `http://localhost/api/v1/projects/${args.projectId}/sources`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "clone",
        hostId: args.hostId,
        ...(args.remoteUrl !== undefined ? { remoteUrl: args.remoteUrl } : {}),
        ...(args.targetPath !== undefined
          ? { targetPath: args.targetPath }
          : {}),
      }),
    },
  );
}

describe("project clone sources", () => {
  it("rejects an already-sourced host before dispatching clone", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-clone-conflict",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const response = await harness.app.fetch(
        cloneSourceRequest({
          projectId: project.id,
          hostId: host.id,
          remoteUrl: "ssh://git.example.test/team/repo.git",
        }),
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "project_source_host_conflict",
      });
      expect(listQueuedCommands(harness, "project.clone")).toEqual([]);
    });
  });

  it("creates resolved sources, anchors origin, and defaults later clones to it", async () => {
    await withTestHarness(async (harness) => {
      const first = seedHostSession(harness.deps, { id: "host-clone-first" });
      const second = seedHostSession(harness.deps, { id: "host-clone-second" });
      seedPrimaryHost(harness.deps, first.host.id);
      setExperiments(harness.db, {
        ...defaultExperiments,
        multiMachine: true,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: first.host.id,
        name: "Clone Me",
      });

      const firstResponsePromise = harness.app.fetch(
        cloneSourceRequest({
          projectId: project.id,
          hostId: second.host.id,
          remoteUrl: "ssh://git.example.test/team/repo.git",
        }),
      );
      const firstCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "project.clone",
      );
      expect(firstCommand.command).toEqual({
        type: "project.clone",
        projectSlug: "Clone Me",
        remoteUrl: "ssh://git.example.test/team/repo.git",
      });
      await reportQueuedCommandSuccess(harness, firstCommand, {
        path: "/remote/checkouts/clone-me",
        gitRemoteUrl: "ssh://git.example.test/team/repo.git",
      });
      const firstResponse = await firstResponsePromise;
      expect(firstResponse.status).toBe(201);
      await expect(readJson(firstResponse)).resolves.toMatchObject({
        type: "local_path",
        hostId: second.host.id,
        path: "/remote/checkouts/clone-me",
      });
      expect(getProject(harness.db, project.id)?.gitRemoteUrl).toBe(
        "ssh://git.example.test/team/repo.git",
      );

      const third = seedHostSession(harness.deps, { id: "host-clone-third" });
      const secondResponsePromise = harness.app.fetch(
        cloneSourceRequest({ projectId: project.id, hostId: third.host.id }),
      );
      const secondCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "project.clone" &&
          command.remoteUrl.includes("repo.git"),
      );
      expect(secondCommand.command).toMatchObject({
        remoteUrl: "ssh://git.example.test/team/repo.git",
      });
      await reportQueuedCommandSuccess(harness, secondCommand, {
        path: "/third/checkouts/clone-me",
        gitRemoteUrl: "ssh://git.example.test/team/repo.git",
      });
      expect((await secondResponsePromise).status).toBe(201);
    });
  });

  it("propagates structured clone failures and creates no source row", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-clone-primary",
      });
      const target = seedHostSession(harness.deps, { id: "host-clone-target" });
      seedPrimaryHost(harness.deps, primary.host.id);
      setExperiments(harness.db, {
        ...defaultExperiments,
        multiMachine: true,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: primary.host.id,
      });
      const before = countProjectSources(harness.db, { projectId: project.id });

      const missingRemoteResponse = await harness.app.fetch(
        cloneSourceRequest({
          projectId: project.id,
          hostId: target.host.id,
        }),
      );
      expect(missingRemoteResponse.status).toBe(400);
      await expect(readJson(missingRemoteResponse)).resolves.toMatchObject({
        code: "missing_git_remote",
      });

      const responsePromise = harness.app.fetch(
        cloneSourceRequest({
          projectId: project.id,
          hostId: target.host.id,
          remoteUrl: "ssh://git.example.test/team/repo.git",
        }),
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "project.clone",
      );
      await reportQueuedCommandError(harness, command, {
        errorCode: "target_not_empty",
        errorMessage: "Clone target is not empty: /target",
      });
      const response = await responsePromise;
      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "target_not_empty",
        message: "Clone target is not empty: /target",
      });
      expect(countProjectSources(harness.db, { projectId: project.id })).toBe(
        before,
      );
    });
  });

  it("discovers the daemon-local default path without cloning", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-path-discovery",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Path Project",
      });

      const responsePromise = harness.app.request(
        `/api/v1/hosts/${host.id}/clone-default-path?projectId=${project.id}`,
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "project.clone_default_path",
      );
      expect(command.command).toEqual({
        type: "project.clone_default_path",
        projectSlug: "Path Project",
      });
      await reportQueuedCommandSuccess(harness, command, {
        path: "/daemon-data/checkouts/path-project",
      });
      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        path: "/daemon-data/checkouts/path-project",
      });
    });
  });
});
