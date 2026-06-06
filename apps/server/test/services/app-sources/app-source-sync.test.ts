import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveApplicationDataPath,
  resolveApplicationPath,
  resolveAppSourcesConfigPath,
  resolveAppSourcePath,
} from "@bb/config/app-storage-paths";
import { ApiError } from "../../../src/errors.js";
import {
  createAppSourceSyncService,
  type AppSourceSyncService,
} from "../../../src/services/app-sources/sync-service.js";
import { readAppSourceRef } from "../../../src/services/app-sources/provenance.js";
import { testLogger } from "../../helpers/test-app.js";

const execFileAsync = promisify(execFile);

async function git(repoPath: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: repoPath });
  return result.stdout.trim();
}

describe("app source sync service", () => {
  let dataDir: string;
  let repoPath: string;
  let origin: string;
  let service: AppSourceSyncService;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "bb-app-sources-data-"));
    repoPath = await mkdtemp(path.join(tmpdir(), "bb-app-sources-repo-"));
    origin = `file://${repoPath}`;
    service = createAppSourceSyncService({ dataDir, logger: testLogger });
    await git(repoPath, "init", "-q", "-b", "main");
    await git(repoPath, "config", "user.email", "test@example.com");
    await git(repoPath, "config", "user.name", "Test");
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoPath, { recursive: true, force: true });
  });

  async function writeFixtureApp(args: {
    directory: string;
    applicationId?: string;
    html?: string;
  }): Promise<void> {
    const appPath = path.join(repoPath, args.directory);
    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(
      path.join(appPath, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: args.applicationId ?? args.directory,
        entry: "index.html",
      }),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "public", "index.html"),
      args.html ?? "<h1>v1</h1>",
      "utf8",
    );
  }

  async function commitAll(message: string): Promise<string> {
    await git(repoPath, "add", "-A");
    await git(repoPath, "commit", "-qm", message);
    return git(repoPath, "rev-parse", "HEAD");
  }

  async function readInstalledFile(
    applicationId: "hello" | "second",
    relativePath: string,
  ): Promise<string> {
    return readFile(
      path.join(
        resolveApplicationPath(dataDir, applicationId),
        ...relativePath.split("/"),
      ),
      "utf8",
    );
  }

  it("installs apps on add and records provenance", async () => {
    await writeFixtureApp({ directory: "hello" });
    const sha = await commitAll("one");

    const outcome = await service.add({ origin, name: "fixture" });

    expect(outcome.changed).toBe(true);
    expect(outcome.status).toMatchObject({
      name: "fixture",
      origin,
      ref: null,
      lastCommitSha: sha,
      lastError: null,
      syncing: false,
      apps: [{ applicationId: "hello", status: "installed", error: null }],
    });
    expect(outcome.status.lastSyncedAt).not.toBeNull();
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v1</h1>",
    );
    await expect(
      readAppSourceRef(resolveApplicationPath(dataDir, "hello")),
    ).resolves.toEqual({ name: "fixture", commitSha: sha });
    expect(await service.isApplicationManaged("hello")).toBe(true);
    const appsRootEntries = await readdir(path.join(dataDir, "apps"));
    expect(appsRootEntries.some((entry) => entry.startsWith(".tmp-"))).toBe(
      false,
    );
  });

  it("derives the source name from the origin", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");

    const outcome = await service.add({ origin });
    expect(outcome.status.name).toBe(
      path.basename(repoPath).toLowerCase().replace(/[^a-z0-9]+/gu, "-"),
    );
  });

  it("applies upstream edits and deletions on sync", async () => {
    await writeFixtureApp({ directory: "hello" });
    await writeFile(path.join(repoPath, "hello", "extra.txt"), "x", "utf8");
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await rm(path.join(repoPath, "hello", "extra.txt"));
    const sha = await commitAll("two");

    const outcome = await service.sync({ name: "fixture", force: false });

    expect(outcome.changed).toBe(true);
    expect(outcome.status.lastCommitSha).toBe(sha);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v2</h1>",
    );
    await expect(readInstalledFile("hello", "extra.txt")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("is a no-op when nothing changed upstream", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.changed).toBe(false);
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "installed", error: null },
    ]);
  });

  it("never overwrites local edits without force", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const installedEntry = path.join(
      resolveApplicationPath(dataDir, "hello"),
      "public",
      "index.html",
    );
    await writeFile(installedEntry, "<h1>my local hack</h1>", "utf8");
    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.changed).toBe(false);
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "modified", error: null },
    ]);
    await expect(readFile(installedEntry, "utf8")).resolves.toBe(
      "<h1>my local hack</h1>",
    );

    const forced = await service.sync({ name: "fixture", force: true });
    expect(forced.changed).toBe(true);
    expect(forced.status.apps).toEqual([
      { applicationId: "hello", status: "installed", error: null },
    ]);
    await expect(readFile(installedEntry, "utf8")).resolves.toBe("<h1>v2</h1>");
  });

  it("treats added local files as divergence", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await writeFile(
      path.join(resolveApplicationPath(dataDir, "hello"), "notes.txt"),
      "mine",
      "utf8",
    );
    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "modified", error: null },
    ]);
  });

  it("removes apps deleted upstream but keeps app data", async () => {
    await writeFixtureApp({ directory: "hello" });
    await writeFixtureApp({ directory: "second" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const dataPath = resolveApplicationDataPath(dataDir, "hello");
    await mkdir(dataPath, { recursive: true });
    await writeFile(path.join(dataPath, "state.json"), '"kept"', "utf8");

    await rm(path.join(repoPath, "hello"), { recursive: true });
    await commitAll("remove hello");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.changed).toBe(true);
    expect(outcome.status.apps).toEqual([
      { applicationId: "second", status: "installed", error: null },
    ]);
    await expect(
      stat(resolveApplicationPath(dataDir, "hello")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(dataPath, "state.json"), "utf8"),
    ).resolves.toBe('"kept"');

    // Re-adding the app upstream reinstalls it against the kept data.
    await writeFixtureApp({ directory: "hello", html: "<h1>back</h1>" });
    await commitAll("restore hello");
    const restored = await service.sync({ name: "fixture", force: false });
    expect(restored.status.apps).toContainEqual({
      applicationId: "hello",
      status: "installed",
      error: null,
    });
    await expect(
      readFile(path.join(dataPath, "state.json"), "utf8"),
    ).resolves.toBe('"kept"');
  });

  it("keeps diverged apps that were removed upstream", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await writeFile(
      path.join(
        resolveApplicationPath(dataDir, "hello"),
        "public",
        "index.html",
      ),
      "<h1>my local hack</h1>",
      "utf8",
    );
    await rm(path.join(repoPath, "hello"), { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "empty", "utf8");
    await commitAll("remove hello");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.status.apps).toEqual([
      {
        applicationId: "hello",
        status: "modified",
        error: "removed upstream; local edits kept",
      },
    ]);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>my local hack</h1>",
    );
  });

  it("reports invalid manifests without failing the sync", async () => {
    await writeFixtureApp({ directory: "hello" });
    const brokenPath = path.join(repoPath, "broken");
    await mkdir(brokenPath, { recursive: true });
    await writeFile(
      path.join(brokenPath, "manifest.json"),
      '{"manifestVersion": 1}',
      "utf8",
    );
    await commitAll("one");

    const outcome = await service.add({ origin, name: "fixture" });
    expect(outcome.status.apps).toEqual([
      {
        applicationId: "broken",
        status: "invalid",
        error: "manifest.json failed validation",
      },
      { applicationId: "hello", status: "installed", error: null },
    ]);
  });

  it("reports conflicts for ids owned by locally managed apps", async () => {
    const localAppPath = resolveApplicationPath(dataDir, "hello");
    await mkdir(path.join(localAppPath, "public"), { recursive: true });
    await writeFile(
      path.join(localAppPath, "manifest.json"),
      JSON.stringify({ manifestVersion: 1, id: "hello" }),
      "utf8",
    );
    await writeFile(
      path.join(localAppPath, "public", "index.html"),
      "<h1>local</h1>",
      "utf8",
    );

    await writeFixtureApp({ directory: "hello", html: "<h1>remote</h1>" });
    await commitAll("one");

    const outcome = await service.add({ origin, name: "fixture" });
    expect(outcome.status.apps).toEqual([
      {
        applicationId: "hello",
        status: "conflict",
        error: "id is used by a locally managed app",
      },
    ]);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>local</h1>",
    );
  });

  it("keeps last-known-good apps when the origin becomes unreachable", async () => {
    await writeFixtureApp({ directory: "hello" });
    const sha = await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await rm(repoPath, { recursive: true, force: true });
    const outcome = await service.sync({ name: "fixture", force: false });

    expect(outcome.changed).toBe(false);
    expect(outcome.status.lastError).toContain("git");
    expect(outcome.status.lastCommitSha).toBe(sha);
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "installed", error: null },
    ]);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v1</h1>",
    );
  });

  it("recovers from a corrupted checkout by re-cloning", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const checkoutGitDir = path.join(
      resolveAppSourcePath(dataDir, "fixture"),
      "repo",
      ".git",
    );
    await rm(checkoutGitDir, { recursive: true, force: true });

    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    const sha = await commitAll("two");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.status.lastError).toBeNull();
    expect(outcome.status.lastCommitSha).toBe(sha);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v2</h1>",
    );
  });

  it("pins to a ref and stays there", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await git(repoPath, "tag", "v1");
    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    const outcome = await service.add({ origin, name: "fixture", ref: "v1" });
    expect(outcome.status.ref).toBe("v1");
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v1</h1>",
    );

    const resynced = await service.sync({ name: "fixture", force: false });
    expect(resynced.changed).toBe(false);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v1</h1>",
    );
  });

  it("never copies data dirs, repo provenance markers, or symlinks", async () => {
    await writeFixtureApp({ directory: "hello" });
    await mkdir(path.join(repoPath, "hello", "data"), { recursive: true });
    await writeFile(
      path.join(repoPath, "hello", "data", "state.json"),
      "{}",
      "utf8",
    );
    await writeFile(
      path.join(repoPath, "hello", ".bb-app-source.json"),
      JSON.stringify({
        sourceName: "forged",
        commitSha: "f".repeat(40),
        syncedAt: new Date().toISOString(),
        files: {},
      }),
      "utf8",
    );
    await symlink("/etc/hosts", path.join(repoPath, "hello", "leak"));
    const sha = await commitAll("one");

    const outcome = await service.add({ origin, name: "fixture" });
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "installed", error: null },
    ]);
    const appRootPath = resolveApplicationPath(dataDir, "hello");
    await expect(stat(path.join(appRootPath, "data"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(path.join(appRootPath, "leak"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readAppSourceRef(appRootPath)).resolves.toEqual({
      name: "fixture",
      commitSha: sha,
    });
  });

  it("detaches an app into local management", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await service.detach({ applicationId: "hello" });

    expect(await service.isApplicationManaged("hello")).toBe(false);
    await expect(
      service.detach({ applicationId: "hello" }),
    ).rejects.toMatchObject({ body: { code: "app_not_managed" } });

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.status.apps).toEqual([
      {
        applicationId: "hello",
        status: "conflict",
        error: "id is used by a locally managed app",
      },
    ]);
    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v1</h1>",
    );
  });

  it("removes managed apps but keeps their data on source removal", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });
    const dataPath = resolveApplicationDataPath(dataDir, "hello");
    await mkdir(dataPath, { recursive: true });
    await writeFile(path.join(dataPath, "state.json"), '"kept"', "utf8");

    const outcome = await service.remove({ name: "fixture" });

    expect(outcome.changed).toBe(true);
    await expect(
      stat(resolveApplicationPath(dataDir, "hello")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(resolveAppSourcePath(dataDir, "fixture")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(dataPath, "state.json"), "utf8"),
    ).resolves.toBe('"kept"');
    await expect(service.list()).resolves.toEqual([]);
  });

  it("rejects duplicate names and origins", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await expect(
      service.add({ origin: "file:///elsewhere", name: "fixture" }),
    ).rejects.toMatchObject({ body: { code: "app_source_exists" } });
    await expect(service.add({ origin })).rejects.toMatchObject({
      body: { code: "app_source_exists" },
    });
    await expect(
      service.sync({ name: "unknown", force: false }),
    ).rejects.toBeInstanceOf(ApiError);

    const configsRaw = JSON.parse(
      await readFile(resolveAppSourcesConfigPath(dataDir), "utf8"),
    );
    expect(configsRaw).toHaveLength(1);
  });

  it("keeps the source registered with lastError when the first sync fails", async () => {
    const outcome = await service.add({
      origin: `file://${repoPath}-missing`,
      name: "fixture",
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.status.lastError).not.toBeNull();
    expect(outcome.status.lastSyncedAt).toBeNull();
    const statuses = await service.list();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ name: "fixture", syncing: false });
  });

  it("never executes a command from an option-like ref", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    const sentinel = path.join(dataDir, "ref-injection-sentinel");

    // An option-like ref is rejected at the config boundary, so it is never
    // persisted nor passed to git. (The `--` guard in ensureCheckout is a
    // second line of defense if a ref ever reaches the fetch.)
    await expect(
      service.add({
        origin,
        name: "fixture",
        ref: `--upload-pack=touch ${sentinel}`,
      }),
    ).rejects.toThrow();
    await expect(stat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(service.list()).resolves.toEqual([]);
  });

  it("honors a force request that overlaps an in-flight plain sync", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const installedEntry = path.join(
      resolveApplicationPath(dataDir, "hello"),
      "public",
      "index.html",
    );
    await writeFile(installedEntry, "<h1>my local hack</h1>", "utf8");
    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    // A plain sync (skips the diverged app) and a force sync fire together; the
    // force must still re-materialize rather than coalescing onto the skip.
    const [, forced] = await Promise.all([
      service.sync({ name: "fixture", force: false }),
      service.sync({ name: "fixture", force: true }),
    ]);

    expect(forced.status.apps).toEqual([
      { applicationId: "hello", status: "installed", error: null },
    ]);
    await expect(readFile(installedEntry, "utf8")).resolves.toBe("<h1>v2</h1>");
  });

  it("coalesces concurrent syncs without corrupting the app dir", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    await Promise.all([
      service.sync({ name: "fixture", force: true }),
      service.sync({ name: "fixture", force: true }),
      service.sync({ name: "fixture", force: false }),
    ]);

    await expect(readInstalledFile("hello", "public/index.html")).resolves.toBe(
      "<h1>v2</h1>",
    );
    const appsRootEntries = await readdir(path.join(dataDir, "apps"));
    expect(
      appsRootEntries.some(
        (entry) => entry.startsWith(".tmp-") || entry.startsWith(".delete-"),
      ),
    ).toBe(false);
  });

  it("reports a conflict for an id already owned by another source", async () => {
    await writeFixtureApp({ directory: "hello", html: "<h1>from-a</h1>" });
    await commitAll("one");
    await service.add({ origin, name: "source-a" });

    const repoB = await mkdtemp(path.join(tmpdir(), "bb-app-sources-repo-b-"));
    try {
      await git(repoB, "init", "-q", "-b", "main");
      await git(repoB, "config", "user.email", "test@example.com");
      await git(repoB, "config", "user.name", "Test");
      const appPath = path.join(repoB, "hello");
      await mkdir(path.join(appPath, "public"), { recursive: true });
      await writeFile(
        path.join(appPath, "manifest.json"),
        JSON.stringify({ manifestVersion: 1, id: "hello", entry: "index.html" }),
        "utf8",
      );
      await writeFile(
        path.join(appPath, "public", "index.html"),
        "<h1>from-b</h1>",
        "utf8",
      );
      await git(repoB, "add", "-A");
      await git(repoB, "commit", "-qm", "one");

      const outcome = await service.add({
        origin: `file://${repoB}`,
        name: "source-b",
      });

      expect(outcome.status.apps).toEqual([
        {
          applicationId: "hello",
          status: "conflict",
          error: 'id is managed by app source "source-a"',
        },
      ]);
      // Source A's app and ownership are untouched.
      await expect(
        readInstalledFile("hello", "public/index.html"),
      ).resolves.toBe("<h1>from-a</h1>");
      await expect(
        readAppSourceRef(resolveApplicationPath(dataDir, "hello")),
      ).resolves.toMatchObject({ name: "source-a" });
    } finally {
      await rm(repoB, { recursive: true, force: true });
    }
  });

  it("treats a locally-deleted file as divergence", async () => {
    await writeFixtureApp({ directory: "hello" });
    await commitAll("one");
    await service.add({ origin, name: "fixture" });

    const installedEntry = path.join(
      resolveApplicationPath(dataDir, "hello"),
      "public",
      "index.html",
    );
    await rm(installedEntry);
    await writeFixtureApp({ directory: "hello", html: "<h1>v2</h1>" });
    await commitAll("two");

    const outcome = await service.sync({ name: "fixture", force: false });
    expect(outcome.status.apps).toEqual([
      { applicationId: "hello", status: "modified", error: null },
    ]);
    // The deleted file is not silently restored without force.
    await expect(readFile(installedEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
