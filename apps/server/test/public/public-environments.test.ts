import { describe, expect, it } from "vitest";
import { getEnvironment } from "@bb/db";
import {
  registerTestHostRpcCapture,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public environments", () => {
  it("lists cached branch options while remotes refresh in the background", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-environment-branch-options",
      });
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        queueBranchOptions: true,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/branch-options-env",
        environmentProviderId: "git-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/branches?query=feature&selectedBranch=origin%2Fmain&limit=10`,
      );
      const branchOptionsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_branch_options",
      );
      expect(branchOptionsCommand.command).toEqual({
        type: "host.list_branch_options",
        path: "/tmp/branch-options-env",
        query: "feature",
        selectedBranch: "origin/main",
        limit: 10,
        remoteRefresh: "background",
      });
      await reportQueuedCommandSuccess(harness, branchOptionsCommand, {
        branches: ["feature/local"],
        branchesTruncated: false,
        remoteBranches: ["origin/feature/remote"],
        remoteBranchesTruncated: false,
        selectedBranch: { kind: "remote", name: "origin/main" },
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        branches: ["feature/local"],
        branchesTruncated: false,
        remoteBranches: ["origin/feature/remote"],
        remoteBranchesTruncated: false,
        selectedBranch: { kind: "remote", name: "origin/main" },
      });
    });
  });

  it("propagates a bounded truncated diff table of contents", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-truncated-diff",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/truncated-diff-env",
        environmentProviderId: "git-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/files?target=uncommitted`,
      );
      const overlappingResponse = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/files?target=uncommitted`,
      );
      const diffFilesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffFiles" &&
          command.environmentId === environment.id,
      );
      expect(diffFilesCommand.command).toMatchObject({
        maxFiles: 500,
        ignoreWhitespace: false,
      });
      await reportQueuedCommandSuccess(harness, diffFilesCommand, {
        outcome: "available",
        files: [
          {
            path: "large.bin",
            previousPath: null,
            statusLetter: "A",
            additions: 0,
            deletions: 0,
            binary: true,
            origin: "untracked",
            revision: "000000:0000:100644:abcd",
          },
        ],
        shortstat: "1 file changed",
        mergeBaseRef: null,
        truncated: true,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect((await overlappingResponse).status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        truncated: true,
        files: [
          {
            path: "large.bin",
            origin: "untracked",
            loadMode: "on_demand",
            revision: "000000:0000:100644:abcd",
          },
        ],
      });
    });
  });

  it("stores viewed files per environment and diff target", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-diff-viewed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/diff-viewed-env",
        environmentProviderId: "git-worktree",
      });
      const other = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/diff-viewed-other-env",
        environmentProviderId: "git-worktree",
      });
      const viewedUrl = (id: string) =>
        `/api/v1/environments/${id}/diff/viewed`;
      const send = (
        id: string,
        method: "PUT" | "DELETE" | "POST",
        body: unknown,
      ) =>
        harness.app.request(viewedUrl(id), {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const list = async (id: string, query: string) =>
        readJson(await harness.app.request(`${viewedUrl(id)}?${query}`));

      const uncommitted = { type: "uncommitted" };
      await send(environment.id, "PUT", {
        target: uncommitted,
        path: "a.ts",
        revision: "rev-1",
      });
      await send(environment.id, "PUT", {
        target: uncommitted,
        path: "b.ts",
        revision: "rev-b",
      });
      const remarked = await send(environment.id, "PUT", {
        target: uncommitted,
        path: "a.ts",
        revision: "rev-2",
      });
      await expect(readJson(remarked)).resolves.toEqual({ ok: true });
      await expect(list(environment.id, "target=uncommitted")).resolves.toEqual(
        {
          files: [
            { path: "a.ts", revision: "rev-2" },
            { path: "b.ts", revision: "rev-b" },
          ],
        },
      );
      await expect(
        readJson(
          await send(environment.id, "POST", {
            target: "uncommitted",
            paths: ["b.ts", "missing.ts", "b.ts"],
          }),
        ),
      ).resolves.toEqual({ files: [{ path: "b.ts", revision: "rev-b" }] });
      await expect(
        readJson(
          await send(environment.id, "POST", {
            target: "uncommitted",
            paths: [],
          }),
        ),
      ).resolves.toEqual({ files: [] });
      expect(
        (
          await send(environment.id, "POST", {
            target: "uncommitted",
            paths: Array.from({ length: 501 }, (_, i) => `${i}.ts`),
          })
        ).status,
      ).toBe(400);
      await send(environment.id, "PUT", {
        target: { type: "commit", sha: "ABCDEF1" },
        path: "a.ts",
        revision: "rev-commit",
      });

      await expect(
        list(environment.id, "target=commit&sha=abcdef1"),
      ).resolves.toEqual({ files: [{ path: "a.ts", revision: "rev-commit" }] });
      await expect(list(other.id, "target=uncommitted")).resolves.toEqual({
        files: [],
      });

      await expect(
        readJson(
          await send(environment.id, "DELETE", {
            target: uncommitted,
            path: "a.ts",
          }),
        ),
      ).resolves.toEqual({ ok: true });
      await expect(list(environment.id, "target=uncommitted")).resolves.toEqual(
        { files: [{ path: "b.ts", revision: "rev-b" }] },
      );
      await send(environment.id, "DELETE", { target: uncommitted });
      await expect(list(environment.id, "target=uncommitted")).resolves.toEqual(
        { files: [] },
      );
      await expect(
        list(environment.id, "target=commit&sha=abcdef1"),
      ).resolves.toEqual({ files: [{ path: "a.ts", revision: "rev-commit" }] });

      const invalid = await send(environment.id, "PUT", {
        target: uncommitted,
        path: "",
        revision: "rev",
      });
      expect(invalid.status).toBe(400);
      const missing = await send("env_missing", "PUT", {
        target: uncommitted,
        path: "a.ts",
        revision: "rev",
      });
      expect(missing.status).toBe(404);
    });
  });

  it("forwards ignoreWhitespace to the daemon diff file list and patches", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-ignore-whitespace",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/ignore-whitespace-env",
        environmentProviderId: "git-worktree",
      });

      const filesPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/files?target=uncommitted&ignoreWhitespace=true`,
      );
      const filesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffFiles" &&
          command.environmentId === environment.id,
      );
      expect(filesCommand.command).toMatchObject({ ignoreWhitespace: true });
      await reportQueuedCommandSuccess(harness, filesCommand, {
        outcome: "available",
        files: [
          {
            path: "a.ts",
            previousPath: null,
            statusLetter: "M",
            additions: 0,
            deletions: 0,
            binary: false,
            origin: "tracked",
            revision: "100644:aaaa:100644:bbbb",
          },
        ],
        shortstat: "1 file changed",
        mergeBaseRef: null,
        truncated: false,
      });
      const initialPatchCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffPatch" &&
          command.environmentId === environment.id,
      );
      expect(initialPatchCommand.command).toMatchObject({
        paths: ["a.ts"],
        ignoreWhitespace: true,
      });
      await reportQueuedCommandSuccess(harness, initialPatchCommand, {
        outcome: "available",
        patches: [{ path: "a.ts", patch: "", truncated: false }],
      });
      await expect(readJson(await filesPromise)).resolves.toMatchObject({
        files: [{ path: "a.ts", revision: "100644:aaaa:100644:bbbb" }],
        initialPatches: [{ path: "a.ts", patch: "" }],
      });

      const patchPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/patch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { type: "uncommitted" },
            paths: ["a.ts"],
            ignoreWhitespace: true,
          }),
        },
      );
      const patchCommand = await waitForQueuedCommandAfter(
        harness,
        initialPatchCommand.row.cursor,
        ({ command }) =>
          command.type === "workspace.diffPatch" &&
          command.environmentId === environment.id,
      );
      expect(patchCommand.command).toMatchObject({ ignoreWhitespace: true });
      await reportQueuedCommandSuccess(harness, patchCommand, {
        outcome: "available",
        patches: [{ path: "a.ts", patch: "", truncated: false }],
      });
      expect((await patchPromise).status).toBe(200);
    });
  });

  it("remaps a daemon file-read failure on diff/file to its HTTP status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-diff-file-enoent",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/diff-file-env",
        environmentProviderId: "git-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/file?target=uncommitted&side=new&path=missing.md`,
      );
      const readCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.read_file",
      );
      expect(readCommand.command).toMatchObject({
        path: "/tmp/diff-file-env/missing.md",
        rootPath: "/tmp/diff-file-env",
      });
      await reportQueuedCommandError(harness, readCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: /tmp/diff-file-env/missing.md",
      });

      const response = await responsePromise;
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("remaps an oversized daemon file read on diff/file to 413", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-diff-file-too-large",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/diff-file-large-env",
        environmentProviderId: "git-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/file?target=uncommitted&side=new&path=huge.bin`,
      );
      const readCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.read_file",
      );
      await reportQueuedCommandError(harness, readCommand, {
        errorCode: "file_too_large",
        errorMessage: "File is too large to read",
      });

      const response = await responsePromise;
      expect(response.status).toBe(413);
    });
  });

  it("keeps stored branch metadata unchanged when reading workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-current-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "feature/observed",
        defaultBranch: "main",
        path: "/tmp/current-branch-env",
        environmentProviderId: "git-worktree",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).toMatchObject({
        maxUntrackedLineStatFiles: 50,
        maxUntrackedLineStatBytes: 8 * 1024 * 1024,
      });
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
            fileCount: 0,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: "feature/current",
            defaultBranch: "trunk",
          },
          checkout: {
            kind: "branch",
            branchName: "feature/current",
            headSha: null,
          },
          mergeBase: null,
        },
      });

      const response = await statusPromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        workspace: {
          branch: {
            currentBranch: "feature/current",
            defaultBranch: "trunk",
          },
        },
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/observed",
        defaultBranch: "main",
      });
    });
  });

  it("keeps the stored branch when reading detached workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-detached-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "feature/observed",
        defaultBranch: "main",
        path: "/tmp/detached-branch-env",
        environmentProviderId: "git-worktree",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
            fileCount: 0,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: null,
            defaultBranch: "main",
          },
          checkout: {
            kind: "detached",
            headSha: "0123456789abcdef0123456789abcdef01234567",
          },
          mergeBase: null,
        },
      });

      const response = await statusPromise;
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/observed",
        defaultBranch: "main",
      });
    });
  });

  it("renames an environment through the public update route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        environmentProviderId: "git-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "  Review workspace  " }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: environment.id,
        name: "Review workspace",
      });
    });
  });

  it("rejects empty environment updates", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/environments/env_missing",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("lists workspace paths via host.list_paths for a personal-workspace environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/personal-workspace",
        environmentProviderId: "personal-workspace",
        isGitRepo: false,
      });

      const pathsPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );
      const pathsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === "/tmp/personal-workspace",
      );
      expect(pathsCommand.command).toMatchObject({
        path: "/tmp/personal-workspace",
        query: "app",
        includeFiles: true,
        includeDirectories: false,
        includeHidden: true,
        respectGitIgnore: true,
        excludeNames: [
          "node_modules",
          ".pnpm-store",
          ".claude/worktrees",
          ".venv",
          "venv",
          ".turbo",
          ".next",
          ".cache",
          "__pycache__",
          ".DS_Store",
        ],
      });
      await reportQueuedCommandSuccess(harness, pathsCommand, {
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });

      const pathsResponse = await pathsPromise;
      expect(pathsResponse.status).toBe(200);
      await expect(readJson(pathsResponse)).resolves.toEqual({
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });
    });
  });

  it("returns not-ready for workspace path search on an unprovisioned environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths-pending",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );

      expect(response.status).toBe(409);
    });
  });
});

describe("environment list and delete", () => {
  it("lists non-destroyed environments, scoped to a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-list" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const { project: other } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/env-list-other",
      });
      const mine = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-list-a",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: other.id,
        path: "/tmp/env-list-b",
      });

      const scoped = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(scoped.map((environment) => environment.id)).toEqual([mine.id]);

      const everything = (await readJson(
        await harness.app.request("/api/v1/environments"),
      )) as Array<{ id: string }>;
      expect(everything.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("pages the list with limit and offset", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-page" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const ids = ["a", "b", "c"].map(
        (suffix) =>
          seedEnvironment(harness.deps, {
            hostId: host.id,
            projectId: project.id,
            path: `/tmp/env-page-${suffix}`,
          }).id,
      );

      const firstPage = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&limit=2`,
        ),
      )) as Array<{ id: string }>;
      expect(firstPage).toHaveLength(2);

      const secondPage = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&limit=2&offset=2`,
        ),
      )) as Array<{ id: string }>;
      expect(secondPage).toHaveLength(1);
      expect([...firstPage, ...secondPage].map((row) => row.id).sort()).toEqual(
        [...ids].sort(),
      );

      const rejected = await harness.app.request(
        `/api/v1/environments?projectId=${project.id}&limit=0`,
      );
      expect(rejected.status).toBe(400);
    });
  });

  it("narrows the list by provider, machine and status in one query", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-filter" });
      const { host: otherHost } = seedHostSession(harness.deps, {
        id: "host-env-filter-other",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const worktree = seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: host.id,
        path: "/tmp/env-filter-worktree",
        projectId: project.id,
      });
      seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: otherHost.id,
        path: "/tmp/env-filter-elsewhere",
        projectId: project.id,
      });
      seedEnvironment(harness.deps, {
        environmentProviderId: "personal-workspace",
        hostId: host.id,
        path: "/tmp/env-filter-personal",
        projectId: project.id,
      });
      const broken = seedEnvironment(harness.deps, {
        environmentProviderId: "git-worktree",
        hostId: host.id,
        path: "/tmp/env-filter-broken",
        projectId: project.id,
        status: "error",
      });

      const byProviderAndHost = (await readJson(
        await harness.app.request(
          `/api/v1/environments?environmentProviderId=git-worktree&hostId=${host.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(
        byProviderAndHost.map((environment) => environment.id).sort(),
      ).toEqual([broken.id, worktree.id].sort());

      const byStatus = (await readJson(
        await harness.app.request(
          `/api/v1/environments?environmentProviderId=git-worktree&status=error`,
        ),
      )) as Array<{ id: string }>;
      expect(byStatus.map((environment) => environment.id)).toEqual([
        broken.id,
      ]);
    });
  });

  it("returns destroyed rows only when the caller names that status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-env-destroyed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const gone = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: null,
        projectId: project.id,
        status: "destroyed",
      });

      expect(
        (await readJson(
          await harness.app.request(
            `/api/v1/environments?projectId=${project.id}`,
          ),
        )) as unknown[],
      ).toEqual([]);
      const destroyed = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}&status=destroyed`,
        ),
      )) as Array<{ id: string }>;
      expect(destroyed.map((environment) => environment.id)).toEqual([gone.id]);
    });
  });

  it("records a deleted environment as destroyed and hides it from the list", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-del" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-delete",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(200);
      const after = getEnvironment(harness.db, environment.id);
      expect(after?.status).toBe("destroyed");
      expect(after?.path).toBeNull();

      const listed = (await readJson(
        await harness.app.request(
          `/api/v1/environments?projectId=${project.id}`,
        ),
      )) as Array<{ id: string }>;
      expect(listed).toEqual([]);
    });
  });

  it("returns the declared 404 response when deleting a missing environment", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/environments/env_missing",
        { method: "DELETE" },
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_found",
      });
    });
  });

  it("requests provider teardown without a machine round trip", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-env-release",
      });
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-release",
        environmentProviderId: "git-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "ready",
        path: environment.path,
        teardownStatus: "running",
        teardownAttempt: 0,
      });
    });
  });

  it("refuses to delete an environment with live threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-env-live" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-delete-live",
      });
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(409);
      expect(getEnvironment(harness.db, environment.id)?.status).not.toBe(
        "destroyed",
      );
    });
  });
});
