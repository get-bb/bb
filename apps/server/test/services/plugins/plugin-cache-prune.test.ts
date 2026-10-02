import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createPluginArtifact,
  createPluginStateSnapshot,
  getInstalledPluginRegistration,
  listPluginArtifacts,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import {
  garbageCollectPluginArtifacts,
  prunePluginCache,
  removeUnusedPluginArtifacts,
} from "../../../src/services/plugins/plugin-artifact-gc.js";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);
const MIB = 1024 * 1024;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function fill(path: string, bytes = 1024): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "payload"), Buffer.alloc(bytes, 1));
}

function installGitRow(
  db: DbConnection,
  args: {
    id: string;
    rootDir: string;
    commit: string;
    activeArtifactId: string | null;
  },
): void {
  upsertInstalledPlugin(db, {
    id: args.id,
    source: "git:https://example.test/plugin.git@main",
    provenance: { kind: "direct" },
    sourceIntent: {
      kind: "git",
      url: "https://example.test/plugin.git",
      subdirectory: null,
      selector: { kind: "ref", ref: "main", refKind: "branch" },
    },
    exactResolution: { kind: "git", commit: args.commit },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: args.activeArtifactId,
    rootDir: args.rootDir,
    version: "1.0.0",
    enabled: true,
    enabledFollowsDefault: false,
  });
}

describe("plugin cache pruning", () => {
  let db: DbConnection;
  let dataDir: string;
  let gitRepoCache: string;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    dataDir = await mkdtemp(join(tmpdir(), "bb-plugin-prune-"));
    gitRepoCache = join(
      dataDir,
      "plugins",
      "cache",
      "git",
      "example.test",
      "owner",
      "plugin",
    );
  });

  afterEach(async () => {
    db.$client.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  function gitArtifact(id: string, commit: string, path: string): void {
    createPluginArtifact(db, {
      id,
      pluginId: "pruned",
      sourceKind: "git",
      npmResolvedVersion: null,
      gitResolvedCommit: commit,
      gitCheckoutRoot: join(gitRepoCache, commit),
      path,
      integrity: null,
      contentHash: "hash",
      validationResult: "valid",
      validatedAt: 1,
    });
  }

  function snapshot(
    id: string,
    fromArtifactId: string,
    status: "ready" | "rollback-pending",
  ): void {
    const snapshotPath = join(dataDir, "plugins", "snapshots", id);
    createPluginStateSnapshot(db, {
      id,
      pluginId: "pruned",
      fromArtifactId,
      toArtifactId: "active",
      snapshotPath,
      databasePath: null,
      statePath: join(snapshotPath, "state.json"),
      secretsPath: null,
      registrationPath: null,
      status,
      rollbackCandidateVersion: status === "ready" ? null : "candidate",
      rollbackSourceFingerprint: status === "ready" ? null : "source",
      rollbackBbVersion: status === "ready" ? null : "1.0.0",
      rollbackSdkVersion: status === "ready" ? null : "0.6.0",
      rollbackDetail: status === "ready" ? null : "failed",
      createdAt: Date.now(),
      retainedUntil: Date.now() + 7 * 24 * 60 * 60_000,
      updatedAt: Date.now(),
    });
  }

  it("deletes unused versions inside their retention window and keeps everything in use", async () => {
    const commit = (letter: string) => letter.repeat(40);
    for (const letter of ["a", "b", "c", "d", "e"]) {
      await fill(join(gitRepoCache, commit(letter)));
    }
    const temporary = join(gitRepoCache, `${commit("b")}.staging`);
    await fill(temporary);
    const npmOrphan = join(
      dataDir,
      "plugins",
      "cache",
      "npm",
      "@scope",
      "pkg",
      "1.0.0",
    );
    const npmStaging = join(
      dataDir,
      "plugins",
      "cache",
      "npm",
      "other",
      "2.0.0.staging",
    );
    await fill(npmOrphan);
    await fill(npmStaging);
    gitArtifact("active", commit("a"), join(gitRepoCache, commit("a")));
    gitArtifact("replaced", commit("b"), join(gitRepoCache, commit("b")));
    gitArtifact("pending", commit("c"), join(gitRepoCache, commit("c")));
    installGitRow(db, {
      id: "pruned",
      rootDir: join(gitRepoCache, commit("a")),
      commit: commit("a"),
      activeArtifactId: "active",
    });
    installGitRow(db, {
      id: "legacy",
      rootDir: join(gitRepoCache, commit("d")),
      commit: commit("d"),
      activeArtifactId: null,
    });
    snapshot("ready", "replaced", "ready");
    snapshot("pending", "pending", "rollback-pending");
    const warnings: string[] = [];
    const prune = (dryRun: boolean) =>
      prunePluginCache({
        db,
        dataDir,
        dryRun,
        warn: (message) => warnings.push(message),
      });

    const preview = await prune(true);
    expect(
      preview.removed.map(({ pluginId, version }) => ({ pluginId, version })),
    ).toEqual([
      { pluginId: "pruned", version: commit("b") },
      { pluginId: null, version: commit("e") },
      { pluginId: null, version: "1.0.0" },
    ]);
    expect(preview.removed.every(({ bytes }) => bytes > 0)).toBe(true);
    expect(await exists(join(gitRepoCache, commit("b")))).toBe(true);
    expect(listPluginArtifacts(db, "pruned")).toHaveLength(3);

    const pruned = await prune(false);
    expect(pruned).toEqual({ ...preview, dryRun: false });
    for (const removed of [commit("b"), commit("e")]) {
      expect(await exists(join(gitRepoCache, removed))).toBe(false);
    }
    expect(
      await exists(join(dataDir, "plugins", "cache", "npm", "@scope")),
    ).toBe(false);
    for (const kept of [
      join(gitRepoCache, commit("a")),
      join(gitRepoCache, commit("c")),
      join(gitRepoCache, commit("d")),
      temporary,
      npmStaging,
    ]) {
      expect(await exists(join(kept, "payload"))).toBe(true);
    }
    expect(
      listPluginArtifacts(db, "pruned")
        .map((artifact) => artifact.id)
        .sort(),
    ).toEqual(["active", "pending"]);
    expect(warnings).toEqual([]);
    expect((await prune(false)).removed).toEqual([]);
  });

  it.each(["prune", "update/remove", "gc"])(
    "%s preserves installed path plugins inside recorded cache directories",
    async (operation) => {
      const protectedRoots: string[] = [];
      for (const { letter, subdirectory } of [
        { letter: "a", subdirectory: "" },
        { letter: "b", subdirectory: "plugins/unused" },
      ]) {
        const commit = letter.repeat(40);
        const checkout = join(gitRepoCache, commit);
        const artifactRoot = join(checkout, subdirectory);
        const rootDir = join(checkout, "plugins", "local");
        await fill(artifactRoot);
        await fill(rootDir);
        gitArtifact(letter, commit, artifactRoot);
        upsertInstalledPlugin(db, {
          id: `local-${letter}`,
          source: `path:${rootDir}`,
          provenance: { kind: "direct" },
          sourceIntent: { kind: "path", canonicalPath: rootDir },
          exactResolution: { kind: "path" },
          updateState: {
            lastCheckAt: null,
            availableCompatibleVersion: null,
            newestIncompatibleVersion: null,
            statusDetail: null,
          },
          activeArtifactId: null,
          rootDir,
          version: "1.0.0",
          enabled: true,
          enabledFollowsDefault: false,
        });
        protectedRoots.push(rootDir);
      }
      const unusedCommit = "c".repeat(40);
      const unusedRoot = join(gitRepoCache, unusedCommit);
      await fill(unusedRoot);
      gitArtifact("unused", unusedCommit, unusedRoot);
      const args = { db, dataDir, warn: () => {} };

      if (operation === "prune") {
        const preview = await prunePluginCache({ ...args, dryRun: true });
        expect(preview.removed.map(({ path }) => path)).toEqual([unusedRoot]);
        expect(await exists(unusedRoot)).toBe(true);
        const result = await prunePluginCache({ ...args, dryRun: false });
        expect(result).toEqual({ ...preview, dryRun: false });
      } else if (operation === "update/remove") {
        await removeUnusedPluginArtifacts({ ...args, pluginId: "pruned" });
      } else {
        await garbageCollectPluginArtifacts({
          ...args,
          now: Date.now() + 1,
          retentionMs: 0,
        });
      }

      for (const root of protectedRoots) {
        expect(await exists(join(root, "payload"))).toBe(true);
      }
      expect(await exists(unusedRoot)).toBe(false);
      expect(listPluginArtifacts(db, "pruned").map(({ id }) => id)).toEqual([
        "a",
        "b",
      ]);
    },
  );

  it("counts a shared checkout once when its last two plugins are pruned", async () => {
    const commit = "f".repeat(40);
    const checkout = join(gitRepoCache, commit);
    await fill(checkout, MIB);
    await fill(join(checkout, "plugins", "one"), MIB);
    await fill(join(checkout, "plugins", "two"), MIB);
    gitArtifact("one", commit, join(checkout, "plugins", "one"));
    gitArtifact("two", commit, join(checkout, "plugins", "two"));

    const result = await prunePluginCache({
      db,
      dataDir,
      dryRun: false,
      warn: () => {},
    });

    expect(result.removed.map(({ path }) => path)).toEqual([
      join(checkout, "plugins", "one"),
      checkout,
    ]);
    expect(result.bytes).toBeGreaterThanOrEqual(3 * MIB);
    expect(result.bytes).toBeLessThan(4 * MIB);
    expect(await exists(checkout)).toBe(false);
  });
});

describe("git plugin cache lifecycle", () => {
  let db: DbConnection;
  let workDir: string;
  let repo: string;
  let service: PluginService;

  async function git(args: string[]): Promise<string> {
    return (await run("git", args, { cwd: repo })).stdout.trim();
  }

  async function commitPlugin(version: string): Promise<string> {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "bb-plugin-cached",
        version,
        type: "module",
        bb: {
          name: "Cached fixture",
          description: "Plugin cache fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(repo, "server.ts"),
      `export default function plugin(bb: any) { bb.log.info(${JSON.stringify(version)}); }`,
    );
    await git(["add", "-A"]);
    await git(["commit", "-qm", version]);
    return git(["rev-parse", "HEAD"]);
  }

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-cache-"));
    repo = join(workDir, "repo");
    await mkdir(repo, { recursive: true });
    await git(["init", "-q", "-b", "main"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);
    await commitPlugin("1.0.0");
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
    });
    await service.install(`git:${repo}@main`, { kind: "root" });
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  function activeRoot(): string {
    const registration = getInstalledPluginRegistration(db, "cached");
    const artifact = listPluginArtifacts(db, "cached").find(
      (candidate) => candidate.id === registration?.activeArtifactId,
    );
    if (artifact === undefined) throw new Error("missing active artifact");
    return artifact.path;
  }

  it("keeps no clone history and deletes the version an update replaced", async () => {
    const firstRoot = activeRoot();
    expect(await exists(join(firstRoot, "package.json"))).toBe(true);
    expect(await exists(join(firstRoot, ".git"))).toBe(false);

    await commitPlugin("1.1.0");
    await expect(service.applyUpdate("cached")).resolves.toMatchObject({
      ok: true,
      result: { applied: true },
    });
    const secondRoot = activeRoot();
    expect(secondRoot).not.toBe(firstRoot);
    expect(await exists(join(secondRoot, ".git"))).toBe(false);
    expect(await exists(firstRoot)).toBe(false);
    expect(await exists(join(secondRoot, "package.json"))).toBe(true);
    expect(listPluginArtifacts(db, "cached")).toHaveLength(1);
    await expect(service.pruneCache({ dryRun: false })).resolves.toMatchObject({
      removed: [],
    });
    await expect(service.reload("cached")).resolves.toMatchObject({
      ok: true,
    });
    expect(service.list()).toMatchObject([
      { id: "cached", version: "1.1.0", status: "running" },
    ]);
  });

  it("deletes the cached clone when the plugin is removed", async () => {
    const root = activeRoot();
    const repoCache = join(root, "..");

    await expect(service.remove("cached")).resolves.toBe(true);

    expect(await exists(root)).toBe(false);
    expect(listPluginArtifacts(db, "cached")).toEqual([]);
    expect(await readdir(join(workDir, "data", "plugins", "cache"))).toEqual(
      [],
    );
    expect(await exists(repoCache)).toBe(false);
  });
});
