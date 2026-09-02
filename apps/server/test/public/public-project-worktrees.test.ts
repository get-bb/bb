import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createProjectSource, getEnvironment, getThread } from "@bb/db";
import { WORKTREE_COMPARISON_PATHS_MAX } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { HostRpcHandlerResult } from "../helpers/host-rpc.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { listQueuedCommands } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initRepoWithUserWorktree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-wt-lifecycle-"));
  tempDirs.push(root);
  const repoPath = path.join(root, "repo");
  await fs.mkdir(repoPath);
  await runGit(["init", "-b", "main"], repoPath);
  await runGit(["config", "user.name", "BB Tests"], repoPath);
  await runGit(["config", "user.email", "bb@example.com"], repoPath);
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], repoPath);
  await runGit(["commit", "-m", "Initial commit"], repoPath);
  const worktreePath = path.join(root, "user-worktree");
  await runGit(
    ["worktree", "add", "-b", "user/branch", worktreePath],
    repoPath,
  );
  return { repoPath, worktreePath };
}

interface WorktreeEntryArgs {
  path: string;
  canonicalPath?: string | null;
  branch?: string;
  detachedSha?: string;
  lock?: { reason: string | null } | null;
  prunable?: { reason: string | null } | null;
}

function worktreeEntry(args: WorktreeEntryArgs) {
  return {
    path: args.path,
    canonicalPath:
      args.canonicalPath === undefined ? args.path : args.canonicalPath,
    checkout: args.detachedSha
      ? { kind: "detached" as const, headSha: args.detachedSha }
      : { kind: "branch" as const, branchName: args.branch ?? "main" },
    lock: args.lock ?? null,
    prunable: args.prunable ?? null,
  };
}

function respondWith(result: {
  worktrees: ReturnType<typeof worktreeEntry>[];
  resolvedPaths: { path: string; canonicalPath: string | null }[];
}): HostRpcHandlerResult {
  return { ok: true, result };
}

describe("GET /projects/:id/worktrees", () => {
  it("merges discovery with environments by canonical identity and excludes the source", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-wt-merge",
      });
      // Stored paths are /tmp aliases; git reports /private/tmp. Canonical
      // identity must collapse the two spellings.
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/wtproj/main",
      });
      const envReady = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/wtproj/feature-env",
        status: "ready",
        managed: false,
        branchName: "feature-env",
      });
      const envManagedProvisioning = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/wtproj/bb-managed",
        status: "provisioning",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/managed",
      });
      const envRetiring = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/wtproj/retiring",
        status: "retiring",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/retiring",
      });
      // A provisioning direct-unmanaged environment has no path yet and must
      // not reach the daemon's comparison list at all.
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: null,
        status: "provisioning",
        managed: false,
      });
      const envOffRegistry = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/other/off-registry",
        status: "ready",
        managed: false,
        branchName: "off-branch",
      });

      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () =>
          respondWith({
            worktrees: [
              worktreeEntry({
                path: "/private/tmp/wtproj/main",
                branch: "main",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/feature-env",
                branch: "feature-env",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/bb-managed",
                branch: "bb/managed",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/retiring",
                branch: "bb/retiring",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/user-plain",
                branch: "user/plain",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/user-detached",
                detachedSha: "abc1234def567890",
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/user-locked",
                branch: "user/locked",
                lock: { reason: "on removable drive" },
              }),
              worktreeEntry({
                path: "/private/tmp/wtproj/user-stale",
                canonicalPath: null,
                branch: "user/stale",
                prunable: { reason: "gitdir points nowhere" },
              }),
            ],
            resolvedPaths: [
              {
                path: "/tmp/wtproj/main",
                canonicalPath: "/private/tmp/wtproj/main",
              },
              {
                path: "/tmp/wtproj/feature-env",
                canonicalPath: "/private/tmp/wtproj/feature-env",
              },
              {
                path: "/tmp/wtproj/bb-managed",
                canonicalPath: "/private/tmp/wtproj/bb-managed",
              },
              {
                path: "/tmp/wtproj/retiring",
                canonicalPath: "/private/tmp/wtproj/retiring",
              },
              {
                path: "/tmp/other/off-registry",
                canonicalPath: "/private/tmp/other/off-registry",
              },
            ],
          }),
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        worktrees: Array<Record<string, unknown>>;
        failures: unknown[];
      };

      expect(body.failures).toEqual([]);
      const request = responder.requests[0];
      if (request?.command.type !== "host.list_worktrees") {
        throw new Error("Expected a host.list_worktrees request");
      }
      expect(request.command.path).toBe("/tmp/wtproj/main");
      expect([...request.command.comparisonPaths].sort()).toEqual(
        [
          "/tmp/wtproj/main",
          "/tmp/wtproj/feature-env",
          "/tmp/wtproj/bb-managed",
          "/tmp/wtproj/retiring",
          "/tmp/other/off-registry",
        ].sort(),
      );

      const byPath = new Map(
        body.worktrees.map((worktree) => [worktree.path, worktree]),
      );
      // Source checkout and mid-lifecycle managed environment do not appear.
      expect(byPath.has("/private/tmp/wtproj/main")).toBe(false);
      expect(byPath.has("/private/tmp/wtproj/bb-managed")).toBe(false);

      expect(byPath.get("/private/tmp/wtproj/feature-env")).toMatchObject({
        environmentId: envReady.id,
        ownership: "user-managed",
        availability: {
          kind: "selectable",
          canonicalPath: "/private/tmp/wtproj/feature-env",
        },
        checkout: { kind: "branch", branchName: "feature-env" },
      });
      expect(byPath.get("/private/tmp/wtproj/retiring")).toMatchObject({
        environmentId: envRetiring.id,
        ownership: "bb-managed",
        availability: { kind: "selectable" },
      });
      expect(byPath.get("/tmp/other/off-registry")).toMatchObject({
        environmentId: envOffRegistry.id,
        ownership: "user-managed",
        availability: {
          kind: "selectable",
          canonicalPath: "/private/tmp/other/off-registry",
        },
        checkout: { kind: "branch", branchName: "off-branch" },
      });
      expect(byPath.get("/private/tmp/wtproj/user-plain")).toMatchObject({
        environmentId: null,
        ownership: "user-managed",
        availability: { kind: "selectable" },
      });
      expect(byPath.get("/private/tmp/wtproj/user-detached")).toMatchObject({
        checkout: { kind: "detached", headSha: "abc1234def567890" },
        availability: { kind: "selectable" },
      });
      expect(byPath.get("/private/tmp/wtproj/user-locked")).toMatchObject({
        lock: { reason: "on removable drive" },
        availability: { kind: "selectable" },
      });
      expect(byPath.get("/private/tmp/wtproj/user-stale")).toMatchObject({
        environmentId: null,
        availability: { kind: "unavailable", reason: "missing" },
      });

      // Server order: environment-backed rows precede unmatched discoveries.
      const environmentRankSwitch = body.worktrees.map(
        (worktree) => worktree.environmentId !== null,
      );
      expect(environmentRankSwitch.slice(0, 3)).toEqual([true, true, true]);
      expect(environmentRankSwitch.slice(3)).toEqual([
        false,
        false,
        false,
        false,
      ]);
      expect(
        [...envManagedProvisioning.id].length > 0 &&
          body.worktrees.every(
            (worktree) => worktree.environmentId !== envManagedProvisioning.id,
          ),
      ).toBe(true);
    });
  });

  it("fast-fails an offline host while a healthy host returns rows", async () => {
    await withTestHarness(async (harness) => {
      const { host: healthyHost, session } = seedHostSession(harness.deps, {
        id: "host-wt-healthy",
      });
      const offlineHost = seedHost(harness.deps, {
        id: "host-wt-offline",
        name: "Offline Host",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: healthyHost.id,
        path: "/work/project",
      });
      createProjectSource(harness.db, harness.deps.hub, {
        projectId: project.id,
        hostId: offlineHost.id,
        path: "/work/project",
        type: "local_path",
      });
      registerHostRpcResponder(harness, {
        hostId: healthyHost.id,
        sessionId: session.id,
        handle: () =>
          respondWith({
            worktrees: [
              worktreeEntry({ path: "/work/project", branch: "main" }),
              worktreeEntry({ path: "/work/feature", branch: "feature" }),
            ],
            resolvedPaths: [
              { path: "/work/project", canonicalPath: "/work/project" },
            ],
          }),
      });

      const startedAt = Date.now();
      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      const elapsedMs = Date.now() - startedAt;
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        worktrees: Array<{ hostId: string; path: string }>;
        failures: Array<{ hostId: string; code: string }>;
      };

      expect(body.worktrees).toHaveLength(1);
      expect(body.worktrees[0]).toMatchObject({
        hostId: healthyHost.id,
        path: "/work/feature",
      });
      expect(body.failures).toEqual([
        {
          hostId: offlineHost.id,
          code: "host_offline",
          message: "Machine is offline",
        },
      ]);
      // Fast-fail: the offline host must not consume a reconnect budget.
      expect(elapsedMs).toBeLessThan(2_000);
    });
  });

  it("never deduplicates the same path across different hosts", async () => {
    await withTestHarness(async (harness) => {
      const first = seedHostSession(harness.deps, { id: "host-wt-a" });
      const second = seedHostSession(harness.deps, { id: "host-wt-b" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: first.host.id,
        path: "/work/project",
      });
      createProjectSource(harness.db, harness.deps.hub, {
        projectId: project.id,
        hostId: second.host.id,
        path: "/work/project",
        type: "local_path",
      });
      const answer = () =>
        respondWith({
          worktrees: [
            worktreeEntry({ path: "/work/project", branch: "main" }),
            worktreeEntry({ path: "/work/shared", branch: "shared" }),
          ],
          resolvedPaths: [
            { path: "/work/project", canonicalPath: "/work/project" },
          ],
        });
      registerHostRpcResponder(harness, {
        hostId: first.host.id,
        sessionId: first.session.id,
        handle: answer,
      });
      registerHostRpcResponder(harness, {
        hostId: second.host.id,
        sessionId: second.session.id,
        handle: answer,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      const body = (await readJson(response)) as {
        worktrees: Array<{ hostId: string; path: string }>;
      };

      expect(body.worktrees.map((worktree) => worktree.hostId).sort()).toEqual(
        [first.host.id, second.host.id].sort(),
      );
      expect(
        body.worktrees.every((worktree) => worktree.path === "/work/shared"),
      ).toBe(true);
    });
  });

  it("keeps a prunable registration unavailable even when a reusable environment matches", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-wt-prunable-env",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/work/prunable-env",
        status: "ready",
        managed: false,
        branchName: "user/prunable",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () =>
          respondWith({
            worktrees: [
              worktreeEntry({ path: "/work/project", branch: "main" }),
              worktreeEntry({
                path: "/work/prunable-env",
                branch: "user/prunable",
                prunable: { reason: "gitdir points nowhere" },
              }),
            ],
            resolvedPaths: [
              { path: "/work/project", canonicalPath: "/work/project" },
              {
                path: "/work/prunable-env",
                canonicalPath: "/work/prunable-env",
              },
            ],
          }),
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      const body = (await readJson(response)) as {
        worktrees: Array<Record<string, unknown>>;
      };

      expect(body.worktrees).toHaveLength(1);
      expect(body.worktrees[0]).toMatchObject({
        environmentId: environment.id,
        environmentName: environment.name,
        ownership: "user-managed",
        availability: { kind: "unavailable", reason: "prunable" },
      });
    });
  });

  it("fails a host clearly when comparison paths exceed the wire bound", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-wt-overflow",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/project",
      });
      // Source path + N environment paths must exceed the bound.
      for (let index = 0; index < WORKTREE_COMPARISON_PATHS_MAX; index += 1) {
        seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/work/env-${index}`,
          status: "ready",
          managed: false,
          branchName: `branch-${index}`,
        });
      }
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => respondWith({ worktrees: [], resolvedPaths: [] }),
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        worktrees: unknown[];
        failures: Array<{ hostId: string; code: string; message: string }>;
      };

      // Truncation would silently misclassify ownership; the host fails
      // instead, and no RPC is ever sent.
      expect(responder.requests).toEqual([]);
      expect(body.worktrees).toEqual([]);
      expect(body.failures).toEqual([
        {
          hostId: host.id,
          code: "discovery_failed",
          message:
            "Too many environment paths on this machine to discover safely",
        },
      ]);
    });
  });

  it("normalizes daemon failures without leaking internals", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-wt-fail",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/work/project",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: false,
          errorCode: "not_git_repo",
          errorMessage: "raw internal detail that must not surface",
        }),
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/worktrees`,
      );
      expect(response.status).toBe(200);
      const body = (await readJson(response)) as {
        worktrees: unknown[];
        failures: Array<{ hostId: string; code: string; message: string }>;
      };

      expect(body.worktrees).toEqual([]);
      expect(body.failures).toEqual([
        {
          hostId: host.id,
          code: "discovery_failed",
          message: "Project source is not a git repository",
        },
      ]);
    });
  });
});

describe("user-managed worktree lifecycle", () => {
  it("archiving then deleting the last thread leaves a real user worktree and branch intact", async () => {
    const { repoPath, worktreePath } = await initRepoWithUserWorktree();
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-wt-lifecycle",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: repoPath,
      });
      // The environment a discovered-worktree selection produces: unmanaged,
      // attached at the user's own path.
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: worktreePath,
        status: "ready",
        managed: false,
        branchName: "user/branch",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const assertWorktreeUntouched = async () => {
        // No retirement, no destroy dispatch: bb does not own this directory.
        expect(getEnvironment(harness.db, environment.id)).toMatchObject({
          status: "ready",
          retireRequestedAt: null,
          path: worktreePath,
          branchName: "user/branch",
        });
        expect(listQueuedCommands(harness, "environment.destroy")).toEqual([]);
        await expect(
          fs.readFile(path.join(worktreePath, "README.md"), "utf8"),
        ).resolves.toBe("hello\n");
        const branches = await execFileAsync(
          "git",
          ["branch", "--list", "user/branch"],
          { cwd: repoPath },
        );
        expect(branches.stdout).toContain("user/branch");
        const registrations = await execFileAsync(
          "git",
          ["worktree", "list", "--porcelain"],
          { cwd: repoPath },
        );
        expect(registrations.stdout).toContain(await fs.realpath(worktreePath));
      };

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      await assertWorktreeUntouched();

      const deleteResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childThreadsConfirmed: true }),
        },
      );
      expect(deleteResponse.status).toBe(200);
      await assertWorktreeUntouched();
    });
  });
});
